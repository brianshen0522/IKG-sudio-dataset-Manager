import { initI18n, t } from '@/lib/i18n';

import { DEFAULT_SHORTCUTS } from '@/lib/shortcuts-defaults';

const API_BASE = typeof window !== 'undefined' ? window.location.origin : '';

// User's shortcut overrides — loaded once at init
let _shortcuts = null;

function shortcutMatch(e, actionId) {
  const binding = (_shortcuts && _shortcuts[actionId] !== undefined)
    ? _shortcuts[actionId]
    : DEFAULT_SHORTCUTS[actionId];
  if (!binding || typeof e.key !== 'string') return false;
  return e.key.toLowerCase() === binding.toLowerCase();
}

// Class colors (cycling palette)
const CLASS_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F8C471', '#82E0AA', '#F1948A', '#7FB3D3', '#A9DFBF',
  '#FAD7A0', '#A8D8EA', '#D2B4DE', '#A3E4D7', '#F9E79F'
];

function classColor(classId) {
  return CLASS_COLORS[classId % CLASS_COLORS.length];
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── State ────────────────────────────────────────────────────────────────────
let basePath = '';
let folder = '';
let instanceName = '';
let currentDatasetId = '';
let currentJobId = '';
let currentView = '';
let currentClassFile = '';
let allowDelete = true; // set from server; false when user is not assigned to the job
let obbMode = 'rectangle';
let classNames = [];
let allImageList = [];
let imageList = [];
let imageMetaByPath = {};
let labelCache = {};      // imgPath -> { classes: number[], count: number }
let labelRaw = {};        // imgPath -> raw label string
let thumbCache = {};      // imgPath -> blob URL
let selectedImages = new Set();
let requestedImages = null;
let editedOnly = false;
let filterState = {
  name: '',
  classMode: 'any',
  classLogic: 'any',
  selectedClasses: new Set(),
  minLabels: 0,
  maxLabels: null,
  overlayFilteredOnly: true
};
let thumbObserver = null;
let initialized = false;
let lastStatusMessage = '';
let lastStatusIsError = false;
let viewerImageLoadingBatchCount = 200;
let loadProgressState = {
  visible: false,
  text: '',
  current: 0,
  total: 0,
  indeterminate: false
};
let gridRenderToken = 0;
let thumbnailProgressTotal = 0;
let thumbnailProgressDone = new Set();
let lightboxIndex = -1;
let navSearchQuery = '';
let navMatchList = [];  // imgPath values matching nav search
let navMatchPos = -1;   // current index in navMatchList
let viewerSortMode = 'name-asc'; // synced with label editor previewSortMode when in job mode
let _viewerSyncChannel = null;

// ── Entry Point ───────────────────────────────────────────────────────────────
export async function initViewer() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  await initI18n();

  // Load user's custom shortcuts (best-effort; falls back to defaults on failure)
  try {
    const sRes = await fetch('/api/profile/shortcuts');
    if (sRes.ok) {
      const sData = await sRes.json();
      _shortcuts = sData.shortcuts;
    }
  } catch { /* use defaults */ }

  const params = new URLSearchParams(window.location.search);
  instanceName = params.get('instance') || '';
  currentDatasetId = params.get('datasetId') || '';
  currentJobId = params.get('jobId') || '';
  currentView = params.get('view') || '';
  basePath = params.get('base') || '';
  folder = params.get('folder') || 'images';
  currentClassFile = params.get('classFile') || '';
  const requestedImagesParam = params.get('images') || '';
  requestedImages = requestedImagesParam
    ? requestedImagesParam.split(',').map((img) => img.trim()).filter(Boolean)
    : null;
  editedOnly = params.get('edited') === '1';

  buildShell();
  await loadViewerRuntimeConfig();

  try {
    if (currentJobId) {
      await resolveJob(currentJobId);
    } else if (currentDatasetId) {
      await resolveDataset(currentDatasetId);
    } else if (instanceName) {
      await resolveInstance(instanceName);
    } else if (!basePath) {
      setLoadProgress(false);
      showStatus(t('viewer.errors.noInstanceOrPath'), true);
      return;
    } else {
      await loadViewerClasses();
    }
    await loadData();
  } catch (err) {
    setLoadProgress(false);
    showStatus(`Error: ${err.message}`, true);
  }
}

async function loadViewerClasses(fallbackInstanceName = '') {
  try {
    let clsUrl = '';
    if (currentJobId) {
      clsUrl = `${API_BASE}/api/label-editor/classes?jobId=${encodeURIComponent(currentJobId)}`;
    } else if (currentDatasetId) {
      clsUrl = `${API_BASE}/api/label-editor/classes?datasetId=${encodeURIComponent(currentDatasetId)}`;
    } else if (fallbackInstanceName) {
      clsUrl = `${API_BASE}/api/label-editor/classes?instanceName=${encodeURIComponent(fallbackInstanceName)}`;
    } else if (basePath) {
      clsUrl = `${API_BASE}/api/label-editor/classes?basePath=${encodeURIComponent(basePath)}`;
    }

    if (!clsUrl) return;

    const clsRes = await fetch(clsUrl);
    if (!clsRes.ok) return;
    const clsData = await clsRes.json();
    classNames = clsData.classes || [];
  } catch {
    // Keep defaults when class loading fails.
  }
}

async function resolveJob(jobId) {
  const url = new URL(`${API_BASE}/api/label-editor/instance-config`);
  url.searchParams.set('jobId', jobId);
  if (currentView) url.searchParams.set('view', currentView);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error((await res.json()).error || 'Job config load failed');
  const cfg = await res.json();
  currentDatasetId = cfg.datasetId ? String(cfg.datasetId) : currentDatasetId;
  currentJobId = String(cfg.jobId || jobId);
  currentView = cfg.view || currentView;
  obbMode = cfg.obbMode || 'rectangle';
  allImageList = cfg.images || [];
  imageMetaByPath = cfg.imageMeta || {};
  allowDelete = cfg.canDelete !== false;

  if (Number.isFinite(cfg.viewerImageLoadingBatchCount)) {
    viewerImageLoadingBatchCount = Math.max(1, parseInt(cfg.viewerImageLoadingBatchCount, 10) || 200);
  }

  await loadViewerClasses();
  setupViewerSyncChannel();
  buildShell();
  loadJobsList();
}

async function resolveDataset(datasetId) {
  const url = new URL(`${API_BASE}/api/label-editor/instance-config`);
  url.searchParams.set('datasetId', datasetId);
  if (currentView) url.searchParams.set('view', currentView);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error((await res.json()).error || 'Dataset config load failed');
  const cfg = await res.json();
  currentDatasetId = String(cfg.datasetId || datasetId);
  currentView = cfg.view || currentView;
  basePath = cfg.basePath || '';
  folder = cfg.folder || 'images';
  currentClassFile = cfg.classFile || '';
  obbMode = cfg.obbMode || 'rectangle';
  allowDelete = cfg.canDelete !== false;

  if (Number.isFinite(cfg.viewerImageLoadingBatchCount)) {
    viewerImageLoadingBatchCount = Math.max(1, parseInt(cfg.viewerImageLoadingBatchCount, 10) || 200);
  }

  await loadViewerClasses();
  buildShell();
  loadJobsList();
}

export function refreshViewerLocale() {
  if (!initialized || typeof window === 'undefined') return;
  const prevGridHtml = document.getElementById('vGrid')?.innerHTML || '';
  const hadGridContent = prevGridHtml.trim().length > 0;
  if (thumbObserver) {
    thumbObserver.disconnect();
    thumbObserver = null;
  }
  document.removeEventListener('keydown', onLightboxKey);
  lightboxIndex = -1;
  buildShell();
  syncFilterControls();
  syncSortControl();
  buildFilterPanel();
  if (hadGridContent && imageList.length > 0) {
    const grid = document.getElementById('vGrid');
    if (grid) {
      grid.innerHTML = prevGridHtml;
    }
  } else {
    renderGrid();
  }
  updateHeaderCount(allImageList.length);
  updateFilterStats();
  updateDelBtn();
  updateToolbarInfo();
  applyLoadProgressState();
  showStatus(lastStatusMessage, lastStatusIsError);
}

async function resolveInstance(name) {
  const res = await fetch(`${API_BASE}/api/label-editor/instance-config?name=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error((await res.json()).error || 'Config load failed');
  const cfg = await res.json();
  basePath = cfg.basePath;
  folder = cfg.folder || 'images';
  obbMode = cfg.obbMode || 'rectangle';
  if (Number.isFinite(cfg.viewerImageLoadingBatchCount)) {
    viewerImageLoadingBatchCount = Math.max(1, parseInt(cfg.viewerImageLoadingBatchCount, 10) || 200);
  }

  // Load class names
  await loadViewerClasses(name);
}

async function loadViewerRuntimeConfig() {
  try {
    const res = await fetch(`${API_BASE}/api/config`);
    if (!res.ok) return;
    const cfg = await res.json();
    if (Number.isFinite(cfg.viewerImageLoadingBatchCount)) {
      viewerImageLoadingBatchCount = Math.max(1, parseInt(cfg.viewerImageLoadingBatchCount, 10) || 200);
    }
  } catch {
    // Keep default batch size when config endpoint is unavailable
  }
}

async function loadData() {
  showStatus(t('viewer.status.loadingImages'));
  setLoadProgress(true, t('viewer.status.loadingImages'), 0, 0, true);

  if (!currentJobId) {
    const listRes = await fetch(`${API_BASE}/api/label-editor/list-folder?basePath=${encodeURIComponent(basePath)}&folder=${encodeURIComponent(folder)}`);
    if (!listRes.ok) throw new Error((await listRes.json()).error || 'List failed');
    const listData = await listRes.json();
    allImageList = listData.images || [];
    imageMetaByPath = listData.imageMeta || {};
  }
  if (editedOnly && currentJobId) {
    try {
      const res = await fetch(`${API_BASE}/api/datasets/${encodeURIComponent(currentDatasetId)}/jobs/${encodeURIComponent(currentJobId)}/edited-images`);
      if (res.ok) {
        const data = await res.json();
        const editedSet = new Set((data.images || []).map((item) => item.imageName).filter(Boolean));
        allImageList = allImageList.filter((p) => editedSet.has(p) || editedSet.has(p.split('/').pop()));
        imageMetaByPath = Object.fromEntries(
          Object.entries(imageMetaByPath).filter(([p]) => editedSet.has(p) || editedSet.has(p.split('/').pop()))
        );
      }
    } catch {}
  }
  if (editedOnly && !currentJobId && currentDatasetId) {
    try {
      const res = await fetch(`${API_BASE}/api/datasets/${encodeURIComponent(currentDatasetId)}/edited-images`);
      if (res.ok) {
        const data = await res.json();
        const editedSet = new Set((data.images || []).map((item) => item.imageName).filter(Boolean));
        allImageList = allImageList.filter((p) => editedSet.has(p) || editedSet.has(p.split('/').pop()));
        imageMetaByPath = Object.fromEntries(
          Object.entries(imageMetaByPath).filter(([p]) => editedSet.has(p) || editedSet.has(p.split('/').pop()))
        );
      }
    } catch {}
  }
  if (requestedImages && requestedImages.length > 0) {
    const requestedSet = new Set(requestedImages);
    allImageList = allImageList.filter((p) => requestedSet.has(p) || requestedSet.has(p.split('/').pop()));
    imageMetaByPath = Object.fromEntries(
      Object.entries(imageMetaByPath).filter(([p]) => requestedSet.has(p) || requestedSet.has(p.split('/').pop()))
    );
  }
  updateHeaderCount(allImageList.length);

  // Load labels
  showStatus(`${t('viewer.status.loadingLabels')} (0/${allImageList.length})`);
  setLoadProgress(true, t('viewer.status.loadingLabels'), 0, allImageList.length, false);
  const BATCH = viewerImageLoadingBatchCount;
  for (let i = 0; i < allImageList.length; i += BATCH) {
    const batch = allImageList.slice(i, i + BATCH);
    try {
      const imageNames = currentJobId ? batch.map(p => p.split('/').pop()) : null;
      const res = await fetch(`${API_BASE}/api/label-editor/load-labels-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentJobId
          ? { jobId: Number(currentJobId), imageNames, view: currentView || undefined }
          : { basePath, imagePaths: batch, view: currentView || undefined }
        )
      });
      if (res.ok) {
        const data = await res.json();
        for (const [key, content] of Object.entries(data.labels || {})) {
          labelRaw[key] = content || '';
          labelCache[key] = parseLabel(content);
        }
      }
    } catch {}
    const loaded = Math.min(i + BATCH, allImageList.length);
    setLoadProgress(true, t('viewer.status.loadingLabels'), loaded, allImageList.length, false);
    if (i + BATCH < allImageList.length) {
      showStatus(`${t('viewer.status.loadingLabels')} (${loaded}/${allImageList.length})`);
    }
  }

  const filterRestored = await restoreFilterState();
  if (filterRestored) {
    imageList = allImageList.filter(p => matchesFilter(p));
  } else {
    imageList = [...allImageList];
  }
  sortViewerImages();
  buildFilterPanel();
  syncFilterControls();
  syncSortControl();
  renderGrid();
  updateFilterStats();
  setLoadProgress(false);
  showStatus('');
}

function parseLabel(content) {
  if (!content || !content.trim()) return { classes: [], count: 0 };
  const lines = content.trim().split('\n').filter(l => l.trim());
  const classes = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 5) {
      const cls = parseInt(parts[0], 10);
      if (!isNaN(cls)) classes.push(cls);
    }
  }
  return { classes, count: lines.length };
}

// ── Shell ─────────────────────────────────────────────────────────────────────
function buildShell() {
  const root = document.getElementById('viewerRoot');
  if (!root) return;

  const label = currentJobId
    ? `Job #${currentJobId}${currentView === 'duplicates' ? ' Duplicates' : ''} Viewer`
    : instanceName || folder.split('/').filter(Boolean).pop() || 'Viewer';
  const canDelete = allowDelete && currentView !== 'duplicates';
  const canOpenEditor = canDelete; // only assigned user can open editor; duplicates view also disallowed

  root.innerHTML = `
<style>
  #viewerRoot,
  #viewerRoot * { box-sizing: border-box; margin: 0; padding: 0; }

  #viewerRoot {
    --v-bg: #1a1a1a;
    --v-panel: #2a2a2a;
    --v-panel-soft: #333;
    --v-border: #3a3a3a;
    --v-border-input: #444;
    --v-text: #ffffff;
    --v-text-muted: #aaa;
    --v-accent: #007bff;
    --v-accent-strong: #0056b3;
    --v-danger: #dc3545;
    --v-danger-strong: #c82333;
    --v-card-bg: #1f1f1f;
    --v-card-bg-hover: #272727;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    background: var(--v-bg);
    color: var(--v-text);
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  #viewerRoot * {
    scrollbar-width: thin;
    scrollbar-color: #555 #2a2a2a;
  }

  #viewerRoot *::-webkit-scrollbar { width: 6px; height: 6px; }
  #viewerRoot *::-webkit-scrollbar-track { background: #2a2a2a; border-radius: 3px; }
  #viewerRoot *::-webkit-scrollbar-thumb { background: #555; border-radius: 3px; }
  #viewerRoot *::-webkit-scrollbar-thumb:hover { background: #777; }

  .v-hdr {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 15px 20px;
    background: var(--v-panel);
    border-bottom: 1px solid var(--v-border);
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .v-title {
    font-size: 20px;
    font-weight: 600;
    color: var(--v-text);
    max-width: 45vw;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .v-count {
    font-size: 13px;
    color: var(--v-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .v-hdr-acts { display: flex; gap: 10px; margin-left: auto; }

  .vbtn {
    padding: 8px 16px;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.2s;
  }

  .vbtn:disabled,
  .vbtn[disabled] {
    background: #3b3f45;
    color: #9aa0a6;
    opacity: 0.7;
    cursor: not-allowed;
  }

  .vbtn-pri { background: #007bff; color: #fff; }
  .vbtn-pri:hover:not(:disabled) { background: #0056b3; }

  .vbtn-sec { background: #6c757d; color: #fff; }
  .vbtn-sec:hover:not(:disabled) { background: #545b62; }

  .vbtn-dan { background: #dc3545; color: #fff; }
  .vbtn-dan:hover:not(:disabled) { background: #c82333; }

  .v-body { display: flex; flex: 1; min-height: 0; }

  .v-sidebar {
    width: 300px;
    flex-shrink: 0;
    background: var(--v-panel);
    border-right: 1px solid var(--v-border);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .v-section {
    padding: 20px;
    border-bottom: 1px solid var(--v-border);
  }

  .v-flabel {
    font-size: 13px;
    color: var(--v-text-muted);
    margin-bottom: 5px;
    display: block;
  }

  .v-finput,
  .v-fselect,
  .v-frow input[type=number] {
    width: 100%;
    padding: 8px 12px;
    background: var(--v-panel-soft);
    border: 1px solid var(--v-border-input);
    border-radius: 4px;
    color: var(--v-text);
    font-size: 13px;
  }

  .v-finput:focus,
  .v-fselect:focus,
  .v-frow input[type=number]:focus {
    outline: none;
    border-color: var(--v-accent);
  }

  .v-cls-list {
    max-height: 200px;
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
    margin-top: 8px;
    padding-right: 4px;
  }

  .v-cls-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    cursor: pointer;
    font-size: 12px;
    color: #ddd;
    background: #252525;
    border-radius: 3px;
  }

  .v-cls-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .v-frow { display: flex; gap: 8px; align-items: center; }

  .v-fstats {
    font-size: 12px;
    color: var(--v-text-muted);
    margin-top: 10px;
    padding: 8px;
    background: #252525;
    border-radius: 4px;
  }

  .v-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

  .v-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    background: var(--v-panel);
    border-bottom: 1px solid var(--v-border);
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .v-load-wrap {
    display: none;
    padding: 10px 20px;
    background: var(--v-panel);
    border-bottom: 1px solid var(--v-border);
  }

  .v-load-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
  }

  .v-load-text {
    font-size: 13px;
    color: #d0d0d0;
    font-weight: 500;
  }

  .v-load-meta {
    font-size: 12px;
    color: var(--v-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .v-load-bar {
    height: 6px;
    background: #1f1f1f;
    border: 1px solid #333;
    border-radius: 999px;
    overflow: hidden;
  }

  .v-load-fill {
    height: 100%;
    width: 0%;
    background: linear-gradient(90deg, #28a745, #2ecc71);
    transition: width 0.2s ease;
  }

  .v-load-fill.ind {
    width: 35%;
    animation: v-load-ind 1.2s infinite ease-in-out;
  }

  @keyframes v-load-ind {
    0% { transform: translateX(-120%); }
    100% { transform: translateX(320%); }
  }

  .v-grid {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
    gap: 10px;
    align-content: start;
    background: #111;
  }

  .v-card {
    position: relative;
    width: 100%;
    border-radius: 4px;
    border: 3px solid #444;
    overflow: hidden;
    background: var(--v-card-bg);
    cursor: pointer;
    transition: border-color .2s, transform .2s;
    min-width: 0;
    min-height: 170px;
  }

  .v-card:hover {
    border-color: var(--v-accent);
    transform: scale(1.02);
  }

  .v-card.sel {
    border-color: var(--v-accent);
    box-shadow: 0 0 8px rgba(0, 123, 255, 0.5);
  }

  .v-card-cb {
    position: absolute;
    top: 4px;
    left: 4px;
    z-index: 5;
    opacity: 0;
    transition: opacity .15s;
    width: 20px;
    height: 20px;
    cursor: pointer;
    accent-color: var(--v-accent);
  }
  .v-card:hover .v-card-cb, .v-card.sel .v-card-cb { opacity: 1; }

  .v-img-wrap {
    position: relative;
    width: 100%;
    height: 140px;
    background: #0a0a0a;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .v-img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .v-svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }

  .v-name {
    font-size: 10px;
    color: #fff;
    padding: 2px 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    background: rgba(0, 0, 0, 0.8);
    text-align: center;
  }

  .v-lcount {
    position: absolute;
    bottom: 22px;
    right: 4px;
    background: rgba(0, 0, 0, 0.7);
    color: #88b6ff;
    font-size: 10px;
    padding: 2px 5px;
    border-radius: 999px;
    font-weight: 600;
  }

  .v-card.nav-match { border-color: #f0a500; }
  .v-card.nav-cur { border-color: #f0a500; box-shadow: 0 0 0 3px rgba(240,165,0,0.45); }

  .v-size-slider {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #888;
    font-size: 13px;
  }
  .v-size-slider input[type=range] {
    width: 90px;
    accent-color: var(--v-accent);
    cursor: pointer;
  }

  .v-nav-search {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
  }

  .v-nav-input {
    width: 170px;
    padding: 6px 10px;
    background: var(--v-panel-soft);
    border: 1px solid var(--v-border-input);
    border-radius: 4px;
    color: var(--v-text);
    font-size: 12px;
  }
  .v-nav-input:focus { outline: none; border-color: #f0a500; }

  .v-nav-counter {
    font-size: 11px;
    color: var(--v-text-muted);
    min-width: 44px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .v-nav-btn {
    padding: 5px 9px;
    border-radius: 4px;
    border: 1px solid var(--v-border-input);
    background: var(--v-panel-soft);
    color: var(--v-text-muted);
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
  }
  .v-nav-btn:hover { color: var(--v-text); border-color: #f0a500; }
  .v-nav-btn:disabled { opacity: 0.3; cursor: default; }

  .v-tbar-info {
    font-size: 13px;
    color: var(--v-text-muted);
    font-variant-numeric: tabular-nums;
    padding-left: 12px;
    border-left: 1px solid var(--v-border);
  }

  .v-card-refresh {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 5;
    width: 22px;
    height: 22px;
    background: rgba(0, 0, 0, 0.55);
    border: none;
    border-radius: 50%;
    color: #bbb;
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity .15s, color .15s;
    padding: 0;
    line-height: 1;
  }
  .v-card:hover .v-card-refresh { opacity: 1; }
  .v-card-refresh:hover { color: #fff; }
  .v-card-refresh.spinning { opacity: 1; animation: v-spin 0.7s linear infinite; }
  @keyframes v-spin { to { transform: rotate(360deg); } }

  .v-placeholder { color: #4d4d4d; font-size: 12px; }
  .v-empty { width: 100%; padding: 52px 30px; text-align: center; color: #6f6f6f; }

  .v-status {
    padding: 10px 20px;
    font-size: 13px;
    color: var(--v-text-muted);
    background: var(--v-panel);
    border-top: 1px solid var(--v-border);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  }
  .v-status.err { color: #dc3545; }

  .v-jobs-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;
    max-height: 320px;
    overflow-y: auto;
    padding-right: 2px;
  }

  .v-job-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 4px;
    background: #252525;
    cursor: pointer;
    text-decoration: none;
    border: 1px solid transparent;
    transition: background 0.15s, border-color 0.15s;
    min-width: 0;
  }

  .v-job-item:hover { background: #2e2e2e; border-color: var(--v-border-input); }

  .v-job-item.active {
    background: #1a2a3a;
    border-color: var(--v-accent);
  }

  .v-job-item-num {
    font-size: 12px;
    font-weight: 600;
    color: var(--v-text);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .v-job-item-user {
    font-size: 11px;
    color: var(--v-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .v-job-badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 999px;
    font-weight: 600;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .v-job-badge.unassigned { background: #333; color: #888; }
  .v-job-badge.unlabelled { background: #1e3a5f; color: #6ab0f5; }
  .v-job-badge.labeling   { background: #3a2e00; color: #f0c040; }
  .v-job-badge.labelled   { background: #1a3a1a; color: #5dbb5d; }

  @media (max-width: 980px) {
    .v-body { flex-direction: column; }
    .v-sidebar {
      width: 100%;
      border-right: none;
      border-bottom: 1px solid var(--v-border);
      max-height: 42vh;
    }
    .v-title { max-width: 100%; }
  }

  /* ── Lightbox ─────────────────────────────────────────────── */
  .v-lb {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.92);
    display: flex;
    flex-direction: column;
  }

  .v-lb-hdr {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 20px;
    background: #2a2a2a;
    border-bottom: 1px solid #3a3a3a;
    flex-shrink: 0;
  }

  .v-lb-name {
    font-size: 14px;
    color: #fff;
    font-weight: 500;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: default;
  }

  .v-lb-counter {
    font-size: 13px;
    color: #aaa;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .v-lb-close {
    background: none;
    border: none;
    color: #aaa;
    font-size: 22px;
    cursor: pointer;
    padding: 2px 8px;
    border-radius: 4px;
    line-height: 1;
    flex-shrink: 0;
  }
  .v-lb-close:hover { color: #fff; background: rgba(255,255,255,0.1); }

  .v-lb-body {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
    min-height: 0;
  }

  .v-lb-img-wrap {
    position: relative;
    width: calc(100vw - 130px);
    height: calc(100vh - 62px);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .v-lb-img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  .v-lb-svg {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    pointer-events: none;
    overflow: visible;
  }

  .v-lb-nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 52px;
    height: 80px;
    background: rgba(0, 0, 0, 0.45);
    border: none;
    color: #fff;
    font-size: 36px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: background 0.2s;
    z-index: 2;
    line-height: 1;
  }
  .v-lb-nav:hover:not(:disabled) { background: rgba(0, 0, 0, 0.75); }
  .v-lb-nav:disabled { opacity: 0.15; cursor: default; }
  .v-lb-prev { left: 10px; }
  .v-lb-next { right: 10px; }

  .v-lb-spin {
    color: #555;
    font-size: 28px;
    animation: v-lb-spin 1s linear infinite;
  }
  @keyframes v-lb-spin { to { transform: rotate(360deg); } }
</style>
<div class="v-hdr">
  <div class="v-title">${escHtml(label)}</div>
  <div class="v-count" id="vCount"></div>
  <div class="v-hdr-acts">
    ${(instanceName || currentJobId || currentDatasetId) ? `
    ${canOpenEditor ? `<button class="vbtn vbtn-pri" onclick="vOpenEditor()">${t('viewer.openEditor')}</button>` : ''}
    ${instanceName ? `<button class="vbtn vbtn-sec" onclick="vFindDuplicates()">${t('viewer.findDuplicates')}</button>` : ''}
    ` : ''}
  </div>
</div>
<div class="v-body">
  <div class="v-sidebar">
    <div class="v-section">
      <div class="v-flabel">${t('editor.filter.imageName')}</div>
      <input class="v-finput" id="vFName" type="text" placeholder="${t('editor.filter.searchByFilename')}" oninput="vApply()">
    </div>
    <div class="v-section">
      <div class="v-flabel">${t('editor.filter.hasClasses')}</div>
      <div class="v-frow" style="margin-bottom:8px">
        <select class="v-fselect" id="vFMode" onchange="vApply()">
          <option value="any">${t('editor.filter.any')}</option>
          <option value="none">${t('editor.filter.none')}</option>
          <option value="only">${t('editor.filter.onlySelected')}</option>
        </select>
        <select class="v-fselect" id="vFLogic" onchange="vApply()">
          <option value="any">${t('editor.filter.matchAny')}</option>
          <option value="all">${t('editor.filter.matchAll')}</option>
        </select>
      </div>
      <div class="v-cls-list" id="vClsList"></div>
      <label class="v-cls-item" style="margin-top:8px;padding:4px 0">
        <input type="checkbox" id="vFOverlayFilter" onchange="vApply()">
        <span style="font-size:12px;color:#ccc">${t('viewer.overlayFilteredOnly')}</span>
      </label>
    </div>
    <div class="v-section">
      <div class="v-flabel">${t('editor.filter.labelCount')}</div>
      <div class="v-frow">
        <input type="number" class="v-finput" id="vFMin" placeholder="${t('editor.filter.min')}" min="0" oninput="vApply()">
        <span style="color:#666">–</span>
        <input type="number" class="v-finput" id="vFMax" placeholder="${t('editor.filter.max')}" min="0" oninput="vApply()">
      </div>
    </div>
    <div class="v-section">
      <button class="vbtn vbtn-sec" onclick="vClear()" style="width:100%;font-size:12px;padding:8px">${t('editor.filter.clearAll')}</button>
      <div class="v-fstats" id="vFStats"></div>
    </div>
    ${currentDatasetId ? `
    <div class="v-section">
      <div class="v-flabel" style="margin-bottom:8px">${t('viewer.jobsList') || 'Jobs in Dataset'}</div>
      <div class="v-jobs-list" id="vJobsList"><div style="color:#555;font-size:12px">${t('viewer.loadingJobs') || 'Loading…'}</div></div>
    </div>
    ` : ''}
  </div>
  <div class="v-main">
    <div class="v-toolbar">
      <button class="vbtn vbtn-sec" onclick="vSelAll()">${t('editor.selectMode.selectAll')}</button>
      <button class="vbtn vbtn-sec" onclick="vDeselAll()">${t('editor.selectMode.deselectAll')}</button>
      ${canOpenEditor ? `<button class="vbtn vbtn-pri" id="vEditSelBtn" onclick="vOpenEditorSel()" disabled>${t('editor.selectMode.openEditorSelected', { count: '0' })}</button>` : ''}
      ${canDelete ? `<button class="vbtn vbtn-dan" id="vDelBtn" onclick="vDelete()" disabled>${t('editor.selectMode.deleteSelected', { count: '0' })}</button>` : ''}
      <div class="v-size-slider" title="Thumbnail size">
        <span>⊞</span>
        <input type="range" id="vSizeSlider" min="80" max="400" step="8" value="176" oninput="vSetSize(this.value)">
      </div>
      <select id="vSortMode" onchange="vSetSort(this.value)" title="Sort order" style="background:#333;color:#ccc;border:1px solid #444;border-radius:4px;padding:4px 6px;font-size:12px;cursor:pointer">
        <option value="name-asc">${t('viewer.sort.nameAsc') || 'Name A→Z'}</option>
        <option value="name-desc">${t('viewer.sort.nameDesc') || 'Name Z→A'}</option>
        <option value="created-desc">${t('viewer.sort.createdDesc') || 'Newest first'}</option>
        <option value="created-asc">${t('viewer.sort.createdAsc') || 'Oldest first'}</option>
      </select>
      <div class="v-nav-search">
        <input class="v-nav-input" id="vNavSearch" type="text" placeholder="${t('viewer.navSearch') || 'Jump to image…'}"
          oninput="vNavApply()" onkeydown="if(event.key==='Enter'){event.shiftKey?vNavPrev():vNavNext();event.preventDefault()}">
        <span class="v-nav-counter" id="vNavCounter"></span>
        <button class="v-nav-btn" id="vNavPrevBtn" onclick="vNavPrev()" disabled title="Previous match">↑</button>
        <button class="v-nav-btn" id="vNavNextBtn" onclick="vNavNext()" disabled title="Next match">↓</button>
        <div class="v-tbar-info" id="vTbarInfo"></div>
      </div>
    </div>
    <div class="v-load-wrap" id="vLoadWrap">
      <div class="v-load-top">
        <div class="v-load-text" id="vLoadText"></div>
        <div class="v-load-meta" id="vLoadMeta"></div>
      </div>
      <div class="v-load-bar">
        <div class="v-load-fill" id="vLoadFill"></div>
      </div>
    </div>
    <div class="v-grid" id="vGrid"></div>
  </div>
</div>
<div class="v-status" id="vStatus"></div>
<div class="v-lb" id="vLightbox" style="display:none">
  <div class="v-lb-hdr">
    <div class="v-lb-name" id="vLbName"></div>
    <div class="v-lb-counter" id="vLbCounter"></div>
    ${(instanceName || currentJobId || currentDatasetId) && canOpenEditor ? `<button class="vbtn vbtn-pri" style="font-size:12px;padding:6px 12px;flex-shrink:0" onclick="vLbEdit()">${t('viewer.openEditor')}</button>` : ''}
    <button class="v-lb-close" onclick="vLbClose()" title="${t('common.close') || 'Close'}">✕</button>
  </div>
  <div class="v-lb-body">
    <button class="v-lb-nav v-lb-prev" id="vLbPrev" onclick="vLbNav(-1)">‹</button>
    <div class="v-lb-img-wrap" id="vLbImgWrap">
      <div class="v-lb-spin">⟳</div>
    </div>
    <button class="v-lb-nav v-lb-next" id="vLbNext" onclick="vLbNav(1)">›</button>
  </div>
</div>
<style id="vDynStyle"></style>
  `;

  // Expose handlers
  window.vApply = applyFilters;
  window.vClear = clearFilters;
  window.vSelAll = selectAll;
  window.vDeselAll = deselectAll;
  if (canDelete) window.vDelete = deleteSelected;
  if (canOpenEditor) window.vOpenEditorSel = openEditorSelected;
  if (canOpenEditor) window.vOpenEditor = openEditor;
  window.vFindDuplicates = triggerFindDuplicates;
  window.vToggleSel = toggleSel;
  window.vOpen = canOpenEditor ? openImage : openLightbox;
  window.vToggleCls = toggleClass;
  window.vRefreshLabel = refreshCardLabel;
  window.vNavApply = applyNavSearch;
  window.vNavNext = navSearchNext;
  window.vNavPrev = navSearchPrev;
  window.vSetSize = setCardSize;
  window.vSetSort = setSortMode;

  // Restore saved card size
  const savedSize = localStorage.getItem('viewer_card_size');
  if (savedSize) {
    const slider = document.getElementById('vSizeSlider');
    if (slider) slider.value = savedSize;
    applyCardSize(parseInt(savedSize, 10));
  }
  window.vLbClose = closeLightbox;
  window.vLbNav = lightboxNav;
  if (canOpenEditor) window.vLbEdit = () => openImage(imageList[lightboxIndex]);
  window.vLbBboxDraw = drawLightboxBboxes;
}

// ── Jobs List Panel ───────────────────────────────────────────────────────────
async function loadJobsList() {
  const listEl = document.getElementById('vJobsList');
  if (!listEl || !currentDatasetId) return;

  try {
    const res = await fetch(`${API_BASE}/api/datasets/${encodeURIComponent(currentDatasetId)}/jobs`);
    if (!res.ok) {
      listEl.innerHTML = `<div style="color:#555;font-size:12px">${t('viewer.jobsLoadError') || 'Failed to load jobs'}</div>`;
      return;
    }
    const data = await res.json();
    const jobs = data.jobs || [];
    if (!jobs.length) {
      listEl.innerHTML = `<div style="color:#555;font-size:12px">${t('viewer.noJobs') || 'No jobs'}</div>`;
      return;
    }

    listEl.innerHTML = jobs.map(job => {
      const isActive = String(job.id) === String(currentJobId);
      const url = `/viewer?jobId=${encodeURIComponent(job.id)}`;
      const userText = job.assignedToUsername ? escHtml(job.assignedToUsername) : '';
      const badgeClass = `v-job-badge ${job.status}`;
      const statusLabel = t(`viewer.jobStatus.${job.status}`) || job.status;
      return `<a class="v-job-item${isActive ? ' active' : ''}" href="${url}">
        <span class="v-job-item-num">Job #${job.jobIndex}</span>
        <span class="v-job-item-user">${userText}</span>
        <span class="${badgeClass}">${escHtml(statusLabel)}</span>
      </a>`;
    }).join('');
  } catch {
    listEl.innerHTML = `<div style="color:#555;font-size:12px">${t('viewer.jobsLoadError') || 'Failed to load jobs'}</div>`;
  }
}

// ── Filter Panel ─────────────────────────────────────────────────────────────
function buildFilterPanel() {
  const listEl = document.getElementById('vClsList');
  if (!listEl) return;

  const counts = new Map();
  for (const p of allImageList) {
    const entry = labelCache[p];
    if (!entry) continue;
    for (const cls of entry.classes) counts.set(cls, (counts.get(cls) || 0) + 1);
  }

  const sorted = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  if (!sorted.length) {
    listEl.innerHTML = `<div style="color:#555;font-size:12px;grid-column:1/-1">${t('viewer.noClasses')}</div>`;
    return;
  }

  listEl.innerHTML = sorted.map(([cls, n]) => {
    const label = classNames[cls] !== undefined ? `${classNames[cls]} (${n})` : `cls ${cls} (${n})`;
    const chk = filterState.selectedClasses.has(cls) ? 'checked' : '';
    return `<label class="v-cls-item">
      <input type="checkbox" value="${cls}" ${chk} onchange="vToggleCls(${cls},this.checked)">
      <span class="v-cls-dot" style="background:${classColor(cls)}"></span>
      <span>${escHtml(label)}</span>
    </label>`;
  }).join('');
}

function toggleClass(cls, checked) {
  if (checked) filterState.selectedClasses.add(cls);
  else filterState.selectedClasses.delete(cls);
  applyFilters();
}

// ── Filtering ─────────────────────────────────────────────────────────────────
function applyFilters() {
  filterState.name = (document.getElementById('vFName')?.value || '').toLowerCase().trim();
  filterState.classMode = document.getElementById('vFMode')?.value || 'any';
  filterState.classLogic = document.getElementById('vFLogic')?.value || 'any';
  const minV = document.getElementById('vFMin')?.value;
  const maxV = document.getElementById('vFMax')?.value;
  filterState.minLabels = minV ? (parseInt(minV, 10) || 0) : 0;
  filterState.maxLabels = maxV !== '' && maxV !== undefined ? (parseInt(maxV, 10) ?? null) : null;
  const overlayChk = document.getElementById('vFOverlayFilter');
  const prevOverlay = filterState.overlayFilteredOnly;
  if (overlayChk) filterState.overlayFilteredOnly = overlayChk.checked;

  const prevList = imageList;
  imageList = allImageList.filter(p => matchesFilter(p));
  sortViewerImages();

  const listChanged = imageList.length !== prevList.length || imageList.some((p, i) => p !== prevList[i]);
  if (listChanged) {
    renderGrid();
  } else {
    redrawAllOverlays();
  }
  updateFilterStats();
  saveFilterState();
}

function matchesFilter(imgPath) {
  const { name, classMode, classLogic, selectedClasses, minLabels, maxLabels } = filterState;
  const entry = labelCache[imgPath] || { classes: [], count: 0 };

  if (name) {
    const fname = imgPath.split('/').pop().toLowerCase();
    if (!fname.includes(name)) return false;
  }

  if (minLabels > 0 && entry.count < minLabels) return false;
  if (maxLabels !== null && entry.count > maxLabels) return false;

  if (classMode === 'none') {
    if (entry.count > 0) return false;
  } else if (classMode === 'any' || classMode === 'only') {
    if (selectedClasses.size > 0) {
      const imgSet = new Set(entry.classes);
      if (classLogic === 'all') {
        for (const c of selectedClasses) { if (!imgSet.has(c)) return false; }
      } else {
        let any = false;
        for (const c of selectedClasses) { if (imgSet.has(c)) { any = true; break; } }
        if (!any) return false;
      }
      if (classMode === 'only') {
        for (const c of imgSet) { if (!selectedClasses.has(c)) return false; }
      }
    }
  }
  return true;
}

function clearFilters() {
  filterState = { name: '', classMode: 'any', classLogic: 'any', selectedClasses: new Set(), minLabels: 0, maxLabels: null, overlayFilteredOnly: true };
  const ids = ['vFName', 'vFMin', 'vFMax'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const mode = document.getElementById('vFMode'); if (mode) mode.value = 'any';
  const logic = document.getElementById('vFLogic'); if (logic) logic.value = 'any';
  buildFilterPanel();
  imageList = [...allImageList];
  sortViewerImages();
  renderGrid();
  updateFilterStats();
  saveFilterState();
}

// ── Filter persistence ────────────────────────────────────────────────────────
function filterStorageKey() {
  return `viewer_filter_${instanceName || basePath}_${folder}`;
}

function viewerFilterToServerFormat(fs) {
  return {
    nameFilter: fs.name || '',
    classMode: fs.classMode || 'any',
    classLogic: fs.classLogic === 'any' ? 'or' : (fs.classLogic || 'or'),
    selectedClasses: [...(fs.selectedClasses || [])],
    minLabels: fs.minLabels || 0,
    maxLabels: fs.maxLabels ?? null,
  };
}

function serverFilterToViewerFormat(sf) {
  const hasContent = sf.nameFilter || (sf.selectedClasses && sf.selectedClasses.length > 0)
    || sf.minLabels > 0 || sf.maxLabels !== null || sf.classMode !== 'any';
  if (!hasContent) return null;
  return {
    name: sf.nameFilter || '',
    classMode: sf.classMode || 'any',
    classLogic: sf.classLogic === 'or' ? 'any' : (sf.classLogic || 'any'),
    selectedClasses: new Set(sf.selectedClasses || []),
    minLabels: sf.minLabels || 0,
    maxLabels: sf.maxLabels ?? null,
    overlayFilteredOnly: true,
  };
}

function saveFilterState() {
  try {
    const { name, classMode, classLogic, selectedClasses, minLabels, maxLabels, overlayFilteredOnly } = filterState;
    localStorage.setItem(filterStorageKey(), JSON.stringify({
      name, classMode, classLogic,
      selectedClasses: [...selectedClasses],
      minLabels, maxLabels, overlayFilteredOnly
    }));
  } catch {}

  // In job mode, sync filter + sort to server and broadcast to other tabs
  if (currentJobId) {
    const hasFilter = filterState.name || filterState.selectedClasses.size > 0
      || filterState.minLabels > 0 || filterState.maxLabels !== null || filterState.classMode !== 'any';
    fetch('/api/label-editor/filter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId: Number(currentJobId),
        filter: hasFilter ? viewerFilterToServerFormat(filterState) : null,
        previewSortMode: viewerSortMode,
      }),
    }).catch(() => {});
    broadcastViewerFilterSync();
  }
}

async function restoreFilterState() {
  // In job mode, load filter + sort from server (shared with label editor)
  if (currentJobId) {
    try {
      const res = await fetch(`/api/label-editor/filter?jobId=${encodeURIComponent(currentJobId)}`);
      if (!res.ok) return false;
      const data = await res.json();
      if (!data) return false;
      if (data.previewSortMode) {
        viewerSortMode = data.previewSortMode;
      }
      if (data.filter) {
        const vf = serverFilterToViewerFormat(data.filter);
        if (vf) {
          filterState = vf;
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  // Non-job mode: use localStorage
  try {
    const raw = localStorage.getItem(filterStorageKey());
    if (!raw) return false;
    const saved = JSON.parse(raw);
    filterState = {
      name: saved.name || '',
      classMode: saved.classMode || 'any',
      classLogic: saved.classLogic || 'any',
      selectedClasses: new Set(saved.selectedClasses || []),
      minLabels: saved.minLabels || 0,
      maxLabels: saved.maxLabels ?? null,
      overlayFilteredOnly: saved.overlayFilteredOnly !== false
    };
    return true;
  } catch {
    return false;
  }
}

function metaFor(imgPath) {
  return imageMetaByPath[imgPath] || imageMetaByPath[imgPath.split('/').pop()] || {};
}

function sortViewerImages() {
  if (viewerSortMode === 'name-desc') {
    imageList.sort((a, b) => {
      const fa = a.split('/').pop(), fb = b.split('/').pop();
      return fb.localeCompare(fa);
    });
  } else if (viewerSortMode === 'created-desc') {
    imageList.sort((a, b) => {
      return (metaFor(b).ctimeMs || 0) - (metaFor(a).ctimeMs || 0);
    });
  } else if (viewerSortMode === 'created-asc') {
    imageList.sort((a, b) => {
      return (metaFor(a).ctimeMs || 0) - (metaFor(b).ctimeMs || 0);
    });
  }
  // 'name-asc' is default/natural order from server — no sort needed
}

function syncSortControl() {
  const el = document.getElementById('vSortMode');
  if (el) el.value = viewerSortMode;
}

function broadcastViewerFilterSync(sortOnly = false) {
  if (!_viewerSyncChannel || !currentJobId) return;
  const hasFilter = filterState.name || filterState.selectedClasses.size > 0
    || filterState.minLabels > 0 || filterState.maxLabels !== null || filterState.classMode !== 'any';
  try {
    _viewerSyncChannel.postMessage({
      type: 'filter-sync',
      jobId: String(currentJobId),
      filter: hasFilter ? viewerFilterToServerFormat(filterState) : null,
      previewSortMode: viewerSortMode,
      sortOnly,
    });
  } catch { /* ignore */ }
}

function setupViewerSyncChannel() {
  if (!currentJobId) return;
  try {
    _viewerSyncChannel = new BroadcastChannel('ikg-filter-sync');
    _viewerSyncChannel.onmessage = (e) => {
      const msg = e.data;
      if (msg?.type !== 'filter-sync') return;
      if (String(msg.jobId) !== String(currentJobId)) return;

      // Update sort
      if (msg.previewSortMode && msg.previewSortMode !== viewerSortMode) {
        viewerSortMode = msg.previewSortMode;
        syncSortControl();
      }
      // Update filter (skip if sort-only change)
      if (!msg.sortOnly) {
        const newFilter = msg.filter ? serverFilterToViewerFormat(msg.filter) : null;
        filterState = newFilter || {
          name: '', classMode: 'any', classLogic: 'any',
          selectedClasses: new Set(), minLabels: 0, maxLabels: null, overlayFilteredOnly: true
        };
        syncFilterControls();
        buildFilterPanel();
      }
      imageList = allImageList.filter(p => matchesFilter(p));
      sortViewerImages();
      renderGrid();
      updateFilterStats();
    };
  } catch { /* BroadcastChannel not supported */ }
}

function setSortMode(mode) {
  viewerSortMode = mode;
  imageList = allImageList.filter(p => matchesFilter(p));
  sortViewerImages();
  renderGrid();
  updateFilterStats();
  // Save sort+filter to server (fire-and-forget) and broadcast sort-only change
  if (currentJobId) {
    fetch('/api/label-editor/filter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: Number(currentJobId), previewSortMode: viewerSortMode }),
    }).catch(() => {});
    broadcastViewerFilterSync(true);
  } else {
    saveFilterState();
  }
}

function syncFilterControls() {
  const nameEl = document.getElementById('vFName');
  if (nameEl) nameEl.value = filterState.name || '';

  const modeEl = document.getElementById('vFMode');
  if (modeEl) modeEl.value = filterState.classMode || 'any';

  const logicEl = document.getElementById('vFLogic');
  if (logicEl) logicEl.value = filterState.classLogic || 'any';

  const minEl = document.getElementById('vFMin');
  if (minEl) minEl.value = filterState.minLabels > 0 ? String(filterState.minLabels) : '';

  const maxEl = document.getElementById('vFMax');
  if (maxEl) maxEl.value = filterState.maxLabels !== null ? String(filterState.maxLabels) : '';

  const overlayChk = document.getElementById('vFOverlayFilter');
  if (overlayChk) overlayChk.checked = filterState.overlayFilteredOnly !== false;
}

function updateFilterStats() {
  const el = document.getElementById('vFStats');
  if (!el) return;
  el.textContent = imageList.length === allImageList.length
    ? t('editor.filter.showingAll')
    : t('editor.filter.showingFiltered', { shown: imageList.length, total: allImageList.length });
}

// ── Grid ──────────────────────────────────────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById('vGrid');
  if (!grid) return;

  if (thumbObserver) { thumbObserver.disconnect(); thumbObserver = null; }
  const renderToken = ++gridRenderToken;
  thumbnailProgressTotal = imageList.length;
  // Pre-populate with already-cached images so progress reflects reality
  thumbnailProgressDone = new Set(imageList.filter(p => thumbCache[p]));

  if (!imageList.length) {
    grid.innerHTML = `<div class="v-empty">${t('editor.filter.noImagesMatchFilter')}</div>`;
    setLoadProgress(false);
    updateToolbarInfo();
    return;
  }

  const initialDone = thumbnailProgressDone.size;
  if (initialDone >= thumbnailProgressTotal) {
    setLoadProgress(false);
  } else {
    setLoadProgress(true, t('viewer.status.loadingThumbnails'), initialDone, thumbnailProgressTotal, false);
  }

  grid.innerHTML = imageList.map((p, i) => {
    const name = p.split('/').pop();
    const entry = labelCache[p] || { count: 0 };
    const sel = selectedImages.has(p) ? ' sel' : '';
    const esc = escHtml(p).replace(/'/g, "\\'");
    const cachedUrl = thumbCache[p];
    const imgWrapContent = cachedUrl
      ? `<img class="v-img" src="${cachedUrl}" alt="" onload="vBboxDraw(this,'${esc}',${i})"><svg class="v-svg" id="vs${i}" viewBox="0 0 1 1"></svg>`
      : `<div class="v-placeholder">···</div>`;
    return `<div class="v-card${sel}" id="vc${i}" data-path="${escHtml(p)}" onclick="vOpen('${esc}')">
  <input class="v-card-cb" type="checkbox" ${sel ? 'checked' : ''} onclick="event.stopPropagation()" onchange="vToggleSel('${esc}',this.checked)">
  <button class="v-card-refresh" id="vrf${i}" title="Refresh label" onclick="event.stopPropagation();vRefreshLabel('${esc}',${i})">↺</button>
  <div class="v-img-wrap" id="viw${i}">${imgWrapContent}</div>
  <div class="v-name" title="${escHtml(p)}">${escHtml(name)}</div>
  ${entry.count > 0 ? `<div class="v-lcount" id="vlc${i}">${entry.count}</div>` : `<div class="v-lcount" id="vlc${i}" style="display:none"></div>`}
</div>`;
  }).join('');

  updateToolbarInfo();
  reapplyNavHighlights();
  preloadThumbnailsInBackground(renderToken);
}

// Thumbnail loading: batch multiple images per request, limit concurrent requests.
// This keeps HTTP connections free for other API calls (nav, auth, etc.).
const THUMB_BATCH_SIZE = 20; // images per request
const THUMB_CONCURRENCY = 4; // simultaneous requests

async function preloadThumbnailsInBackground(renderToken) {
  const total = imageList.length;
  if (!total) return;

  // Skip already-cached images
  const items = [];
  for (let idx = 0; idx < total; idx++) {
    const p = imageList[idx];
    if (!thumbCache[p]) items.push({ p, idx });
  }
  if (!items.length) { setLoadProgress(false); return; }

  // Split into batches of THUMB_BATCH_SIZE
  const batches = [];
  for (let i = 0; i < items.length; i += THUMB_BATCH_SIZE) {
    batches.push(items.slice(i, i + THUMB_BATCH_SIZE));
  }

  let cursor = 0;
  async function worker() {
    while (renderToken === gridRenderToken) {
      const bi = cursor++;
      if (bi >= batches.length) return;
      await loadThumbsBatch(batches[bi], renderToken);
    }
  }

  await Promise.all(Array.from({ length: Math.min(THUMB_CONCURRENCY, batches.length) }, () => worker()));
}

async function loadThumbsBatch(items, renderToken) {
  if (renderToken !== gridRenderToken) return;

  // Build name→item map for matching responses back to items
  const byBasename = new Map(); // basename → item (fallback for jobId mode)
  const byPath = new Map();     // relative path → item (basePath mode)
  for (const item of items) {
    byBasename.set(item.p.split('/').pop(), item);
    byPath.set(item.p, item);
  }

  try {
    const res = await fetch(`${API_BASE}/api/label-editor/load-thumbnails-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentJobId
        ? { jobId: Number(currentJobId), imageNames: items.map(({ p }) => p.split('/').pop()), maxSize: 176, view: currentView || undefined }
        : { basePath, imagePaths: items.map(({ p }) => p), maxSize: 176, view: currentView || undefined }
      )
    });

    if (renderToken !== gridRenderToken) return;

    if (!res.ok) {
      for (const { p, idx } of items) {
        const wrap = document.getElementById(`viw${idx}`);
        if (wrap) wrap.innerHTML = '';
        markThumbnailProgressDone(p, renderToken);
      }
      return;
    }

    const ct = res.headers.get('content-type') || '';
    const boundary = (ct.split('boundary=')[1] || '').trim();
    if (!boundary) {
      for (const { p, idx } of items) {
        const wrap = document.getElementById(`viw${idx}`);
        if (wrap) wrap.innerHTML = '';
        markThumbnailProgressDone(p, renderToken);
      }
      return;
    }

    const buf = await res.arrayBuffer();
    if (renderToken !== gridRenderToken) return;

    const parts = extractAllParts(buf, boundary);
    const matched = new Set();

    for (const { name, blob } of parts) {
      let decodedName = name;
      try { decodedName = decodeURIComponent(name); } catch {}

      // Try exact path match first, then basename fallback
      const item = byPath.get(decodedName) || byBasename.get(decodedName.split('/').pop());
      if (!item || matched.has(item.p)) continue;
      matched.add(item.p);

      const { p, idx } = item;
      const url = URL.createObjectURL(blob);
      thumbCache[p] = url;
      const wrap = document.getElementById(`viw${idx}`);
      if (wrap) {
        const esc = escHtml(p).replace(/'/g, "\\'");
        wrap.innerHTML = `<img class="v-img" src="${url}" alt="" onload="vBboxDraw(this,'${esc}',${idx})"><svg class="v-svg" id="vs${idx}" viewBox="0 0 1 1"></svg>`;
        window.vBboxDraw = drawBboxes;
      }
      markThumbnailProgressDone(p, renderToken);
    }

    // Mark any items the server didn't return (missing/unreadable images)
    for (const { p, idx } of items) {
      if (!matched.has(p)) {
        const wrap = document.getElementById(`viw${idx}`);
        if (wrap && !thumbCache[p]) wrap.innerHTML = '';
        markThumbnailProgressDone(p, renderToken);
      }
    }
  } catch {
    if (renderToken !== gridRenderToken) return;
    for (const { p, idx } of items) {
      const wrap = document.getElementById(`viw${idx}`);
      if (wrap) wrap.innerHTML = '';
      markThumbnailProgressDone(p, renderToken);
    }
  }
}

// Single-image thumbnail load (used for per-card refresh)
async function loadThumb(imgPath, idx, renderToken) {
  await loadThumbsBatch([{ p: imgPath, idx }], renderToken);
}

function markThumbnailProgressDone(imgPath, renderToken) {
  if (renderToken !== gridRenderToken) return;
  if (thumbnailProgressDone.has(imgPath)) return;
  thumbnailProgressDone.add(imgPath);
  const done = thumbnailProgressDone.size;
  setLoadProgress(true, t('viewer.status.loadingThumbnails'), done, thumbnailProgressTotal, false);
  if (done >= thumbnailProgressTotal) {
    setLoadProgress(false);
  }
}

function getClassDisplayName(cls) {
  return classNames[cls] ?? `cls ${cls}`;
}

// Parse all parts from a multipart response.
// Returns [{ name: string, blob: Blob }, ...] where name is the raw Content-Disposition name value.
function extractAllParts(buf, boundary) {
  const bytes = new Uint8Array(buf);
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const sep = enc.encode(`--${boundary}`);
  const results = [];

  // Find all boundary positions
  const positions = [];
  outer: for (let i = 0; i <= bytes.length - sep.length; i++) {
    for (let j = 0; j < sep.length; j++) {
      if (bytes[i + j] !== sep[j]) continue outer;
    }
    positions.push(i);
  }

  for (let pi = 0; pi < positions.length; pi++) {
    let pos = positions[pi] + sep.length;
    // End boundary: --boundary--
    if (bytes[pos] === 45 && bytes[pos + 1] === 45) break;
    // Skip \r\n after boundary line
    if (bytes[pos] === 13 && bytes[pos + 1] === 10) pos += 2;

    // Find header end (\r\n\r\n)
    let headerEnd = -1;
    for (let i = pos; i <= bytes.length - 4; i++) {
      if (bytes[i] === 13 && bytes[i+1] === 10 && bytes[i+2] === 13 && bytes[i+3] === 10) {
        headerEnd = i + 4;
        break;
      }
    }
    if (headerEnd === -1) continue;

    const headerText = dec.decode(bytes.slice(pos, headerEnd));
    const ctMatch = headerText.match(/Content-Type:\s*([^\r\n]+)/i);
    const mimeType = ctMatch ? ctMatch[1].trim() : 'image/jpeg';
    const nameMatch = headerText.match(/name="([^"]+)"/i);
    const name = nameMatch ? nameMatch[1] : '';

    // Body ends just before the next boundary (strip trailing \r\n)
    const bodyEnd = pi + 1 < positions.length
      ? positions[pi + 1] - 2
      : bytes.length;

    results.push({ name, blob: new Blob([bytes.slice(headerEnd, Math.max(headerEnd, bodyEnd))], { type: mimeType }) });
  }

  return results;
}

function extractFirstPart(buf, boundary) {
  const search = new TextEncoder().encode(`\r\n\r\n`);
  const bytes = new Uint8Array(buf);
  const endMark = new TextEncoder().encode(`\r\n--${boundary}`);

  // Find header end (\r\n\r\n)
  let headerEnd = -1;
  for (let i = 0; i < bytes.length - 3; i++) {
    if (bytes[i] === 13 && bytes[i+1] === 10 && bytes[i+2] === 13 && bytes[i+3] === 10) {
      headerEnd = i + 4;
      break;
    }
  }
  if (headerEnd === -1) return null;

  // Extract Content-Type from header
  const headerText = new TextDecoder().decode(bytes.slice(0, headerEnd));
  const ctMatch = headerText.match(/Content-Type:\s*([^\r\n]+)/i);
  const mimeType = ctMatch ? ctMatch[1].trim() : 'image/jpeg';

  // Find body end
  let bodyEnd = bytes.length;
  for (let i = headerEnd; i <= bytes.length - endMark.length; i++) {
    let match = true;
    for (let j = 0; j < endMark.length; j++) {
      if (bytes[i + j] !== endMark[j]) { match = false; break; }
    }
    if (match) { bodyEnd = i; break; }
  }

  return new Blob([bytes.slice(headerEnd, bodyEnd)], { type: mimeType });
}

function redrawAllOverlays() {
  imageList.forEach((imgPath, i) => {
    const wrap = document.getElementById(`viw${i}`);
    if (!wrap) return;
    const imgEl = wrap.querySelector('.v-img');
    if (imgEl && imgEl.naturalWidth) drawBboxes(imgEl, imgPath, i);
  });
}

function getDrawRaw(raw) {
  if (!filterState.overlayFilteredOnly || filterState.selectedClasses.size === 0) return raw;
  return raw.trim().split('\n').filter(line => {
    const cls = parseInt(line.trim().split(/\s+/)[0], 10);
    return !isNaN(cls) && filterState.selectedClasses.has(cls);
  }).join('\n');
}

function tagDims(rawName, fontSize) {
  const pad = Math.max(1, fontSize * 0.22);
  return { w: rawName.length * fontSize * 0.58 + pad * 2, h: fontSize + pad * 2, pad };
}

function pickTagPos(bLeft, bRight, bTop, bBottom, rawName, fontSize, allBoxes, selfIdx, placedTags, imgW, imgH) {
  const { w: tw, h: th } = tagDims(rawName, fontSize);
  const candidates = [
    { rx: bLeft,      ry: bBottom },       // below
    { rx: bLeft,      ry: bTop - th },     // above
    { rx: bRight,     ry: bTop },          // right outside
    { rx: bLeft - tw, ry: bTop },          // left outside
    { rx: bLeft + 2,  ry: bTop + 2 },      // inside top-left (fallback)
    { rx: bRight - tw - 2, ry: bTop + 2 }, // inside top-right (fallback)
  ];
  function score(pos) {
    let n = 0;
    // heavy penalty for going outside image bounds
    if (imgW && imgH) {
      if (pos.rx < 0 || pos.rx + tw > imgW || pos.ry < 0 || pos.ry + th > imgH) n += 50;
    }
    for (let i = 0; i < allBoxes.length; i++) {
      if (i === selfIdx) continue;
      const b = allBoxes[i];
      if (!b) continue;
      if (pos.rx < b.x + b.w && pos.rx + tw > b.x && pos.ry < b.y + b.h && pos.ry + th > b.y) n++;
    }
    for (const t of placedTags) {
      if (pos.rx < t.x + t.w && pos.rx + tw > t.x && pos.ry < t.y + t.h && pos.ry + th > t.y) n++;
    }
    return n;
  }
  return candidates.reduce((best, c) => score(c) < score(best) ? c : best, candidates[0]);
}

function makeLabelTag(rx, ry, color, rawName, fontSize) {
  const { w, h, pad } = tagDims(rawName, fontSize);
  return `<rect x="${rx.toFixed(1)}" y="${ry.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" fill-opacity="0.85" rx="${(pad*0.8).toFixed(1)}" vector-effect="non-scaling-stroke"/>` +
    `<text x="${(rx+pad).toFixed(1)}" y="${(ry+pad).toFixed(1)}" dominant-baseline="hanging" fill="#fff" font-size="${fontSize}" font-weight="700" vector-effect="non-scaling-stroke">${escHtml(rawName)}</text>`;
}

function drawBboxes(imgEl, imgPath, idx) {
  const svgEl = document.getElementById(`vs${idx}`);
  if (!svgEl || !imgEl.naturalWidth) return;

  const raw = getDrawRaw(labelRaw[imgPath] || '');
  if (!raw.trim()) return;

  const W = imgEl.naturalWidth;
  const H = imgEl.naturalHeight;
  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const fontSize = Math.max(8, Math.round(Math.min(W, H) * 0.04));
  const lines = raw.trim().split('\n');
  const allBoxes = lines.map(line => {
    const p = line.trim().split(/\s+/).map(Number);
    if (p.length === 5) return { x: (p[1]-p[3]/2)*W, y: (p[2]-p[4]/2)*H, w: p[3]*W, h: p[4]*H };
    if (p.length === 9) {
      let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
      for (let i=1;i<9;i+=2){const px=p[i]*W,py=p[i+1]*H;if(px<x0)x0=px;if(px>x1)x1=px;if(py<y0)y0=py;if(py>y1)y1=py;}
      return { x: x0, y: y0, w: x1-x0, h: y1-y0 };
    }
    return null;
  });

  let html = '';
  const placedTags = [];
  for (let li = 0; li < lines.length; li++) {
    const parts = lines[li].trim().split(/\s+/).map(Number);
    if (parts.length < 5 || isNaN(parts[0])) continue;
    const cls = parts[0];
    const color = classColor(cls);
    const rawName = getClassDisplayName(cls);

    if (parts.length === 5) {
      // YOLO bbox
      const [, cx, cy, bw, bh] = parts;
      const x = (cx - bw / 2) * W, y = (cy - bh / 2) * H;
      html += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw*W).toFixed(1)}" height="${(bh*H).toFixed(1)}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
      const pos = pickTagPos(x, x+bw*W, y, y+bh*H, rawName, fontSize, allBoxes, li, placedTags, W, H);
      const { w: tw, h: th } = tagDims(rawName, fontSize);
      placedTags.push({ x: pos.rx, y: pos.ry, w: tw, h: th });
      html += makeLabelTag(pos.rx, pos.ry, color, rawName, fontSize);
    } else if (parts.length === 9) {
      // OBB
      const pts = [];
      let minX=Infinity,maxX=-Infinity,maxY=-Infinity,minY=Infinity;
      for (let i=1;i<9;i+=2){const px=parts[i]*W,py=parts[i+1]*H;if(px<minX)minX=px;if(px>maxX)maxX=px;if(py>maxY)maxY=py;if(py<minY)minY=py;pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);}
      html += `<polygon points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
      const pos = pickTagPos(minX, maxX, minY, maxY, rawName, fontSize, allBoxes, li, placedTags, W, H);
      const { w: tw, h: th } = tagDims(rawName, fontSize);
      placedTags.push({ x: pos.rx, y: pos.ry, w: tw, h: th });
      html += makeLabelTag(pos.rx, pos.ry, color, rawName, fontSize);
    }
  }
  svgEl.innerHTML = html;
}

// ── Selection ─────────────────────────────────────────────────────────────────
function toggleSel(imgPath, checked) {
  if (checked) selectedImages.add(imgPath);
  else selectedImages.delete(imgPath);
  const idx = imageList.indexOf(imgPath);
  if (idx >= 0) {
    const card = document.getElementById(`vc${idx}`);
    if (card) card.classList.toggle('sel', checked);
  }
  updateDelBtn();
  updateToolbarInfo();
}

function selectAll() {
  imageList.forEach(p => selectedImages.add(p));
  document.querySelectorAll('.v-card-cb').forEach(cb => { cb.checked = true; });
  document.querySelectorAll('.v-card').forEach(el => el.classList.add('sel'));
  updateDelBtn();
  updateToolbarInfo();
}

function deselectAll() {
  imageList.forEach(p => selectedImages.delete(p));
  document.querySelectorAll('.v-card-cb').forEach(cb => { cb.checked = false; });
  document.querySelectorAll('.v-card').forEach(el => el.classList.remove('sel'));
  updateDelBtn();
  updateToolbarInfo();
}

function updateDelBtn() {
  const n = selectedImages.size;
  const delBtn = document.getElementById('vDelBtn');
  if (delBtn) {
    delBtn.disabled = n === 0;
    delBtn.textContent = t('editor.selectMode.deleteSelected', { count: String(n) });
  }
  const editBtn = document.getElementById('vEditSelBtn');
  if (editBtn) {
    editBtn.disabled = n === 0;
    editBtn.textContent = t('editor.selectMode.openEditorSelected', { count: String(n) });
  }
}

function openEditorSelected() {
  if (!selectedImages.size) return;
  const url = new URL(`${window.location.origin}/label-editor`);
  if (currentJobId) {
    url.searchParams.set('jobId', currentJobId);
  } else if (currentDatasetId) {
    url.searchParams.set('datasetId', currentDatasetId);
  } else {
    url.searchParams.set('base', basePath);
  }
  url.searchParams.set('images', [...selectedImages].join(','));
  if (currentClassFile) url.searchParams.set('classFile', currentClassFile);
  if (instanceName) url.searchParams.set('instance', instanceName);
  if (obbMode && obbMode !== 'rectangle') url.searchParams.set('obbMode', obbMode);
  window.open(url.toString(), '_blank', 'noopener,noreferrer');
}

function updateToolbarInfo() {
  const el = document.getElementById('vTbarInfo');
  if (el) el.textContent = `${imageList.length} ${t('editor.preview.images')}`;
}

// ── Card Size ─────────────────────────────────────────────────────────────────
function applyCardSize(size) {
  const dyn = document.getElementById('vDynStyle');
  if (!dyn) return;
  const imgH = Math.round(size * 0.8);
  dyn.textContent = `
    .v-grid { grid-template-columns: repeat(auto-fill, minmax(${size}px, 1fr)) !important; }
    .v-img-wrap { height: ${imgH}px !important; }
    .v-card { min-height: ${imgH + 28}px !important; }
  `;
}

function setCardSize(value) {
  const size = parseInt(value, 10);
  applyCardSize(size);
  localStorage.setItem('viewer_card_size', size);
}

// ── Nav Search ────────────────────────────────────────────────────────────────
function applyNavSearch() {
  navSearchQuery = (document.getElementById('vNavSearch')?.value || '').toLowerCase().trim();
  navMatchList = [];
  navMatchPos = -1;
  document.querySelectorAll('.v-card.nav-match, .v-card.nav-cur').forEach(el => {
    el.classList.remove('nav-match', 'nav-cur');
  });
  const counter = document.getElementById('vNavCounter');
  const prevBtn = document.getElementById('vNavPrevBtn');
  const nextBtn = document.getElementById('vNavNextBtn');
  if (!navSearchQuery) {
    if (counter) counter.textContent = '';
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }
  navMatchList = imageList.filter(p => p.split('/').pop().toLowerCase().includes(navSearchQuery));
  navMatchList.forEach(p => {
    const idx = imageList.indexOf(p);
    const card = document.getElementById(`vc${idx}`);
    if (card) card.classList.add('nav-match');
  });
  const has = navMatchList.length > 0;
  if (counter) counter.textContent = has ? `1 / ${navMatchList.length}` : '0';
  if (prevBtn) prevBtn.disabled = !has;
  if (nextBtn) nextBtn.disabled = !has;
  if (has) { navMatchPos = 0; scrollToNavMatch(); }
}

function scrollToNavMatch() {
  document.querySelectorAll('.v-card.nav-cur').forEach(el => el.classList.remove('nav-cur'));
  if (navMatchPos < 0 || navMatchPos >= navMatchList.length) return;
  const idx = imageList.indexOf(navMatchList[navMatchPos]);
  const card = document.getElementById(`vc${idx}`);
  if (card) { card.classList.add('nav-cur'); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  const counter = document.getElementById('vNavCounter');
  if (counter) counter.textContent = `${navMatchPos + 1} / ${navMatchList.length}`;
}

function navSearchNext() {
  if (!navMatchList.length) return;
  navMatchPos = (navMatchPos + 1) % navMatchList.length;
  scrollToNavMatch();
}

function navSearchPrev() {
  if (!navMatchList.length) return;
  navMatchPos = (navMatchPos - 1 + navMatchList.length) % navMatchList.length;
  scrollToNavMatch();
}

function reapplyNavHighlights() {
  if (!navSearchQuery) return;
  navMatchList = imageList.filter(p => p.split('/').pop().toLowerCase().includes(navSearchQuery));
  navMatchPos = Math.max(0, Math.min(navMatchPos, navMatchList.length - 1));
  navMatchList.forEach(p => {
    const idx = imageList.indexOf(p);
    const card = document.getElementById(`vc${idx}`);
    if (card) card.classList.add('nav-match');
  });
  if (navMatchList.length > 0) scrollToNavMatch();
}

// ── Delete ────────────────────────────────────────────────────────────────────
async function deleteSelected() {
  const n = selectedImages.size;
  if (!n) return;
  if (!confirm(t('editor.selectMode.confirmDelete', { count: n }))) return;

  showStatus(t('editor.selectMode.deleting', { count: n }));
  try {
    const res = await fetch(`${API_BASE}/api/label-editor/delete-images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentJobId
        ? { jobId: Number(currentJobId), imageNames: [...selectedImages].map(p => p.split('/').pop()), view: currentView || undefined }
        : { basePath, images: [...selectedImages], view: currentView || undefined }
      )
    });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);

    const gone = new Set(selectedImages);
    selectedImages.clear();
    allImageList = allImageList.filter(p => !gone.has(p));
    for (const p of gone) {
      delete labelCache[p];
      delete labelRaw[p];
      if (thumbCache[p]) { URL.revokeObjectURL(thumbCache[p]); delete thumbCache[p]; }
    }

    imageList = allImageList.filter(p => matchesFilter(p));
    buildFilterPanel();
    renderGrid();
    updateHeaderCount(allImageList.length);
    showStatus(t('editor.selectMode.deleted', { count: n }));
  } catch (err) {
    showStatus(t('editor.selectMode.deleteFailed', { error: err.message }), true);
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────
function openImage(imgPath) {
  const url = new URL(`${window.location.origin}/label-editor`);
  if (currentJobId) {
    url.searchParams.set('jobId', currentJobId);
    if (currentView) url.searchParams.set('view', currentView);
    // In job mode, use 'start' (bare filename) so the label editor finds it in jobScopedImages
    url.searchParams.set('start', imgPath.split('/').pop());
  } else if (currentDatasetId) {
    url.searchParams.set('datasetId', currentDatasetId);
    url.searchParams.set('img', imgPath);
  } else {
    url.searchParams.set('base', basePath);
    url.searchParams.set('img', imgPath);
  }
  if (instanceName) url.searchParams.set('instance', instanceName);
  if (obbMode && obbMode !== 'rectangle') url.searchParams.set('obbMode', obbMode);
  window.open(url.toString(), '_blank', 'noopener,noreferrer');
}

function openEditor() {
  if (currentJobId) {
    const url = new URL(`${window.location.origin}/label-editor`);
    url.searchParams.set('jobId', currentJobId);
    if (currentView) url.searchParams.set('view', currentView);
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
    return;
  }
  if (!instanceName && !currentDatasetId && !basePath) return;
  const url = new URL(`${window.location.origin}/label-editor`);
  if (currentDatasetId) {
    url.searchParams.set('datasetId', currentDatasetId);
  } else if (instanceName) {
    url.searchParams.set('instance', instanceName);
  } else {
    url.searchParams.set('base', basePath);
  }
  if (currentClassFile) url.searchParams.set('classFile', currentClassFile);
  if (obbMode && obbMode !== 'rectangle') url.searchParams.set('obbMode', obbMode);
  window.open(url.toString(), '_blank', 'noopener,noreferrer');
}

// ── Refresh label ─────────────────────────────────────────────────────────────
async function refreshCardLabel(imgPath, idx) {
  const btn = document.getElementById(`vrf${idx}`);
  if (btn) btn.classList.add('spinning');

  try {
    const imageName = imgPath.split('/').pop();
    const res = await fetch(`${API_BASE}/api/label-editor/load-labels-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentJobId
        ? { jobId: Number(currentJobId), imageNames: [imageName], view: currentView || undefined }
        : { basePath, imagePaths: [imgPath], view: currentView || undefined }
      )
    });
    if (!res.ok) return;
    const data = await res.json();
    const content = data.labels?.[currentJobId ? imageName : imgPath] ?? '';
    labelRaw[imgPath] = content;
    labelCache[imgPath] = parseLabel(content);

    // Redraw bbox overlay on existing thumbnail
    const imgEl = document.querySelector(`#viw${idx} .v-img`);
    if (imgEl && imgEl.naturalWidth) {
      const svgEl = document.getElementById(`vs${idx}`);
      if (svgEl) {
        svgEl.setAttribute('viewBox', `0 0 ${imgEl.naturalWidth} ${imgEl.naturalHeight}`);
        const W2 = imgEl.naturalWidth, H2 = imgEl.naturalHeight;
        const fontSize = Math.max(8, Math.round(Math.min(W2, H2) * 0.04));
        const lines2 = getDrawRaw(content || '').trim().split('\n');
        const allBoxes2 = lines2.map(line => {
          const p = line.trim().split(/\s+/).map(Number);
          if (p.length === 5) return { x:(p[1]-p[3]/2)*W2, y:(p[2]-p[4]/2)*H2, w:p[3]*W2, h:p[4]*H2 };
          if (p.length === 9) {let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;for(let i=1;i<9;i+=2){const px=p[i]*W2,py=p[i+1]*H2;if(px<x0)x0=px;if(px>x1)x1=px;if(py<y0)y0=py;if(py>y1)y1=py;}return{x:x0,y:y0,w:x1-x0,h:y1-y0};}
          return null;
        });
        let html = '';
        const placedTags2 = [];
        for (let li = 0; li < lines2.length; li++) {
          const parts = lines2[li].trim().split(/\s+/).map(Number);
          if (parts.length < 5 || isNaN(parts[0])) continue;
          const cls = parts[0];
          const color = classColor(cls);
          const rawName = getClassDisplayName(cls);
          if (parts.length === 5) {
            const [, cx, cy, bw, bh] = parts;
            const x = (cx-bw/2)*W2, y = (cy-bh/2)*H2;
            html += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw*W2).toFixed(1)}" height="${(bh*H2).toFixed(1)}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
            const pos = pickTagPos(x, x+bw*W2, y, y+bh*H2, rawName, fontSize, allBoxes2, li, placedTags2, W2, H2);
            const { w: tw, h: th } = tagDims(rawName, fontSize);
            placedTags2.push({ x: pos.rx, y: pos.ry, w: tw, h: th });
            html += makeLabelTag(pos.rx, pos.ry, color, rawName, fontSize);
          } else if (parts.length === 9) {
            const pts = [];
            let minX=Infinity,maxX=-Infinity,maxY=-Infinity,minY=Infinity;
            for(let i=1;i<9;i+=2){const px=parts[i]*W2,py=parts[i+1]*H2;if(px<minX)minX=px;if(px>maxX)maxX=px;if(py>maxY)maxY=py;if(py<minY)minY=py;pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);}
            html += `<polygon points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
            const pos = pickTagPos(minX, maxX, minY, maxY, rawName, fontSize, allBoxes2, li, placedTags2, W2, H2);
            const { w: tw, h: th } = tagDims(rawName, fontSize);
            placedTags2.push({ x: pos.rx, y: pos.ry, w: tw, h: th });
            html += makeLabelTag(pos.rx, pos.ry, color, rawName, fontSize);
          }
        }
        svgEl.innerHTML = html;
      }
    }

    // Update count badge
    const badge = document.getElementById(`vlc${idx}`);
    const count = labelCache[imgPath]?.count ?? 0;
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? '' : 'none';
    }
  } catch {
    // silently ignore
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

// ── Lightbox ──────────────────────────────────────────────────────────────────
function openLightbox(imgPath) {
  const idx = imageList.indexOf(imgPath);
  if (idx < 0) return;
  lightboxIndex = idx;
  const el = document.getElementById('vLightbox');
  if (el) el.style.display = 'flex';
  renderLightboxFrame();
  document.addEventListener('keydown', onLightboxKey);
}

function closeLightbox() {
  const el = document.getElementById('vLightbox');
  if (el) el.style.display = 'none';
  document.removeEventListener('keydown', onLightboxKey);
  lightboxIndex = -1;
}

function lightboxNav(dir) {
  const next = lightboxIndex + dir;
  if (next < 0 || next >= imageList.length) return;
  lightboxIndex = next;
  renderLightboxFrame();
}

function onLightboxKey(e) {
  if (shortcutMatch(e, 'viewer.lightboxClose')) closeLightbox();
  else if (shortcutMatch(e, 'viewer.lightboxPrev')) lightboxNav(-1);
  else if (shortcutMatch(e, 'viewer.lightboxNext')) lightboxNav(1);
}

function renderLightboxFrame() {
  const imgPath = imageList[lightboxIndex];
  const name = imgPath.split('/').pop();

  const nameEl = document.getElementById('vLbName');
  const counterEl = document.getElementById('vLbCounter');
  const prevBtn = document.getElementById('vLbPrev');
  const nextBtn = document.getElementById('vLbNext');
  const wrap = document.getElementById('vLbImgWrap');

  if (nameEl) { nameEl.textContent = name; nameEl.title = imgPath; }
  if (counterEl) counterEl.textContent = `${lightboxIndex + 1} / ${imageList.length}`;
  if (prevBtn) prevBtn.disabled = lightboxIndex === 0;
  if (nextBtn) nextBtn.disabled = lightboxIndex === imageList.length - 1;
  if (!wrap) return;

  const cachedUrl = thumbCache[imgPath];
  if (cachedUrl) {
    const esc = escHtml(imgPath).replace(/'/g, "\\'");
    wrap.innerHTML = `<img id="vLbImg" class="v-lb-img" src="${cachedUrl}" alt=""
      onload="if(window.vLbBboxDraw)vLbBboxDraw(this,'${esc}')">
<svg id="vLbSvg" class="v-lb-svg" viewBox="0 0 1 1"></svg>`;
  } else {
    wrap.innerHTML = `<div class="v-lb-spin">⟳</div>`;
    loadLightboxThumb(imgPath, wrap, lightboxIndex);
  }
}

async function loadLightboxThumb(imgPath, wrap, captureIdx) {
  try {
    const res = await fetch(`${API_BASE}/api/label-editor/load-thumbnails-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentJobId
        ? { jobId: Number(currentJobId), imageNames: [imgPath.split('/').pop()], maxSize: 1600, view: currentView || undefined }
        : { basePath, imagePaths: [imgPath], maxSize: 1600, view: currentView || undefined }
      )
    });

    if (captureIdx !== lightboxIndex) return;
    if (!res.ok) { wrap.innerHTML = `<div style="color:#dc3545">Failed to load</div>`; return; }

    const ct = res.headers.get('content-type') || '';
    const boundary = (ct.split('boundary=')[1] || '').trim();
    if (!boundary) return;

    const buf = await res.arrayBuffer();
    if (captureIdx !== lightboxIndex) return;

    const imgBlob = extractFirstPart(buf, boundary);
    if (!imgBlob) return;

    const url = URL.createObjectURL(imgBlob);
    wrap.innerHTML = `<img id="vLbImg" class="v-lb-img" src="${url}" alt=""
      onload="if(window.vLbBboxDraw)vLbBboxDraw(this,'${escHtml(imgPath).replace(/'/g, "\\'")}')">
<svg id="vLbSvg" class="v-lb-svg" viewBox="0 0 1 1"></svg>`;
  } catch {
    if (captureIdx === lightboxIndex && wrap) wrap.innerHTML = `<div style="color:#dc3545">Error loading image</div>`;
  }
}

function drawLightboxBboxes(imgEl, imgPath) {
  const svgEl = document.getElementById('vLbSvg');
  if (!svgEl || !imgEl.naturalWidth) return;

  const raw = getDrawRaw(labelRaw[imgPath] || '');
  if (!raw.trim()) { svgEl.innerHTML = ''; return; }

  const W = imgEl.naturalWidth;
  const H = imgEl.naturalHeight;
  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const fontSize = Math.max(10, Math.round(Math.min(W, H) * 0.025));
  const linesLb = raw.trim().split('\n');
  const allBoxesLb = linesLb.map(line => {
    const p = line.trim().split(/\s+/).map(Number);
    if (p.length === 5) return { x:(p[1]-p[3]/2)*W, y:(p[2]-p[4]/2)*H, w:p[3]*W, h:p[4]*H };
    if (p.length === 9) {let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;for(let i=1;i<9;i+=2){const px=p[i]*W,py=p[i+1]*H;if(px<x0)x0=px;if(px>x1)x1=px;if(py<y0)y0=py;if(py>y1)y1=py;}return{x:x0,y:y0,w:x1-x0,h:y1-y0};}
    return null;
  });

  let html = '';
  const placedTagsLb = [];
  for (let li = 0; li < linesLb.length; li++) {
    const parts = linesLb[li].trim().split(/\s+/).map(Number);
    if (parts.length < 5 || isNaN(parts[0])) continue;
    const cls = parts[0];
    const color = classColor(cls);
    const rawName = getClassDisplayName(cls);

    if (parts.length === 5) {
      const [, cx, cy, bw, bh] = parts;
      const x = (cx - bw / 2) * W, y = (cy - bh / 2) * H;
      html += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw*W).toFixed(1)}" height="${(bh*H).toFixed(1)}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
      const pos = pickTagPos(x, x+bw*W, y, y+bh*H, rawName, fontSize, allBoxesLb, li, placedTagsLb, W, H);
      const { w: tw, h: th } = tagDims(rawName, fontSize);
      placedTagsLb.push({ x: pos.rx, y: pos.ry, w: tw, h: th });
      html += makeLabelTag(pos.rx, pos.ry, color, rawName, fontSize);
    } else if (parts.length === 9) {
      const pts = [];
      let minX=Infinity,maxX=-Infinity,maxY=-Infinity,minY=Infinity;
      for(let i=1;i<9;i+=2){const px=parts[i]*W,py=parts[i+1]*H;if(px<minX)minX=px;if(px>maxX)maxX=px;if(py>maxY)maxY=py;if(py<minY)minY=py;pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);}
      html += `<polygon points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
      const pos = pickTagPos(minX, maxX, minY, maxY, rawName, fontSize, allBoxesLb, li, placedTagsLb, W, H);
      const { w: tw, h: th } = tagDims(rawName, fontSize);
      placedTagsLb.push({ x: pos.rx, y: pos.ry, w: tw, h: th });
      html += makeLabelTag(pos.rx, pos.ry, color, rawName, fontSize);
    }
  }
  svgEl.innerHTML = html;
}

async function triggerFindDuplicates() {
  if (!instanceName) return;
  if (!confirm(t('viewer.findDuplicatesConfirm', { name: instanceName }))) return;
  showStatus(t('manager.processing.findingDuplicates', { name: instanceName }));
  try {
    const res = await fetch(`${API_BASE}/api/instances/${instanceName}/find-duplicates`, { method: 'POST' });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || res.statusText);
    const msg = result.duplicateCount === 0
      ? t('manager.duplicates.noneFound')
      : t('manager.duplicates.found', { count: result.duplicateCount, action: result.action });
    alert(msg);
    if (result.duplicateCount > 0) await loadData();
    else showStatus('');
  } catch (err) {
    showStatus(`${t('manager.errors.failedToFindDuplicates')}: ${err.message}`, true);
  }
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function updateHeaderCount(n) {
  const el = document.getElementById('vCount');
  if (el) el.textContent = `${n} ${t('editor.preview.images')}`;
}

function showStatus(msg, isError = false) {
  lastStatusMessage = msg || '';
  lastStatusIsError = isError;
  const el = document.getElementById('vStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = isError ? 'v-status err' : 'v-status';
}

function setLoadProgress(visible, text = '', current = 0, total = 0, indeterminate = false) {
  loadProgressState = { visible, text, current, total, indeterminate };
  applyLoadProgressState();
}

function applyLoadProgressState() {
  const wrap = document.getElementById('vLoadWrap');
  const textEl = document.getElementById('vLoadText');
  const metaEl = document.getElementById('vLoadMeta');
  const fillEl = document.getElementById('vLoadFill');
  if (!wrap || !textEl || !metaEl || !fillEl) return;

  const { visible, text, current, total, indeterminate } = loadProgressState;
  wrap.style.display = visible ? 'block' : 'none';
  if (!visible) return;

  textEl.textContent = text || t('common.loading');

  if (indeterminate) {
    metaEl.textContent = t('common.loading');
    fillEl.classList.add('ind');
    return;
  }

  const safeTotal = Math.max(0, total || 0);
  const safeCurrent = Math.min(Math.max(0, current || 0), safeTotal || 0);
  const pct = safeTotal > 0 ? Math.round((safeCurrent / safeTotal) * 100) : 0;
  metaEl.textContent = safeTotal > 0 ? `${safeCurrent}/${safeTotal} (${pct}%)` : '';
  fillEl.classList.remove('ind');
  fillEl.style.width = `${pct}%`;
}
