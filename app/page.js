'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from './_components/AppHeader';
import { useCurrentUser } from './_components/useCurrentUser';
import FileBrowser from './_components/FileBrowser';
import DatasetBrowser from './_components/DatasetBrowser';
import { subscribeSSE } from '@/lib/shared-sse';

const STATUS_COLOR = {
  unassigned: '#9ba9c3',
  unlabelled: '#f1b11a',
  labeling: '#2f7ff5',
  labelled: '#20c25a',
};

const MOVE_STATUS_COLOR = {
  pending:   '#9ba9c3',
  moving:    '#2f7ff5',
  verifying: '#f1b11a',
  done:      '#20c25a',
  failed:    '#d24343',
};
const MOVE_STATUS_LABEL = {
  pending:   'Move Pending',
  moving:    'Moving…',
  verifying: 'Verifying…',
  done:      'Moved',
  failed:    'Move Failed',
};

const STATUS_LABEL = {
  unassigned: 'Unassigned',
  unlabelled: 'Unlabelled',
  labeling: 'In Progress',
  labelled: 'Done',
};

function ProgressBar({ jobs }) {
  if (!jobs || jobs.length === 0) return <div style={styles.progressEmpty}>No jobs</div>;
  const total = jobs.length;
  const counts = { unassigned: 0, unlabelled: 0, labeling: 0, labelled: 0 };
  for (const j of jobs) counts[j.status] = (counts[j.status] || 0) + 1;
  const labelled = counts.labelled;
  return (
    <div>
      <div style={styles.progressBar}>
        {['labelled', 'labeling', 'unlabelled', 'unassigned'].map((s) => {
          const pct = (counts[s] / total) * 100;
          return pct > 0 ? (
            <div
              key={s}
              style={{ ...styles.progressSegment, width: `${pct}%`, background: STATUS_COLOR[s] }}
              title={`${STATUS_LABEL[s]}: ${counts[s]}`}
            />
          ) : null;
        })}
      </div>
      <div style={styles.progressStats}>
        {Object.entries(counts).filter(([, v]) => v > 0).map(([s, v]) => (
          <span key={s} style={{ ...styles.progressStat, color: STATUS_COLOR[s] }}>
            {STATUS_LABEL[s]}: {v}
          </span>
        ))}
        <span style={styles.progressStat}>Total: {total} jobs</span>
        <span style={{ ...styles.progressStat, color: labelled === total ? '#20c25a' : '#9ba9c3' }}>
          {Math.round((labelled / total) * 100)}%
        </span>
      </div>
    </div>
  );
}

function AddDatasetModal({ onClose, onCreated }) {
  const [datasetPath, setDatasetPath] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [classFile, setClassFile] = useState('');
  const [classFilePreview, setClassFilePreview] = useState('');
  const [classFilePreviewError, setClassFilePreviewError] = useState('');
  const [classFilePreviewTruncated, setClassFilePreviewTruncated] = useState(false);
  const [obbFormat, setObbFormat] = useState(false);
  const [obbMode, setObbMode] = useState('rectangle');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPathBrowser, setShowPathBrowser] = useState(false);
  const [showClassFileBrowser, setShowClassFileBrowser] = useState(false);

  // Dataset type selection
  const [datasetTypes, setDatasetTypes] = useState([]);
  const [typesLoading, setTypesLoading] = useState(true);
  const [selectedTypeId, setSelectedTypeId] = useState('');       // '' = manual / no type
  const [availableSubdirs, setAvailableSubdirs] = useState([]);
  const [subdirsLoading, setSubdirsLoading] = useState(false);
  const [selectedSubdir, setSelectedSubdir] = useState('');

  // Duplicate detection config
  const [dupRule, setDupRule] = useState(null);         // auto-resolved from server
  const [dupAction, setDupAction] = useState('');       // '' = use auto
  const [dupLabels, setDupLabels] = useState('');       // '' = use auto
  const [dupThreshold, setDupThreshold] = useState('');  // '' = use auto
  const [dupDebug, setDupDebug] = useState(null);       // null = use auto

  // Load dataset types on mount
  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings/dataset-types')
      .then((r) => r.ok ? r.json() : { types: [] })
      .then((data) => { if (!cancelled) { setDatasetTypes(data.types || []); setTypesLoading(false); } })
      .catch(() => { if (!cancelled) setTypesLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Load available subdirs when type is selected
  useEffect(() => {
    if (!selectedTypeId) {
      setAvailableSubdirs([]);
      setSelectedSubdir('');
      return;
    }
    let cancelled = false;
    setSubdirsLoading(true);
    setSelectedSubdir('');
    fetch(`/api/settings/dataset-types/${selectedTypeId}/available-datasets`)
      .then((r) => r.ok ? r.json() : { available: [] })
      .then((data) => {
        if (!cancelled) {
          setAvailableSubdirs(data.available || []);
          setSubdirsLoading(false);
        }
      })
      .catch(() => { if (!cancelled) setSubdirsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedTypeId]);

  // When subdir is selected, auto-fill path, display name, and class file
  useEffect(() => {
    if (!selectedSubdir) return;
    const found = availableSubdirs.find((s) => s.name === selectedSubdir);
    if (!found) return;
    setDatasetPath(found.path);
    setDisplayName(found.name);
    // Auto-detect class file (same as DatasetBrowser)
    fetch(`/api/auto-find-classes?path=${encodeURIComponent(found.path)}`)
      .then((r) => r.ok ? r.json() : {})
      .then((data) => { setClassFile(data.classFile || ''); })
      .catch(() => {});
  }, [selectedSubdir, availableSubdirs]);

  useEffect(() => {
    let cancelled = false;

    async function loadClassFilePreview() {
      const trimmed = classFile.trim();
      if (!trimmed) {
        setClassFilePreview('');
        setClassFilePreviewError('');
        setClassFilePreviewTruncated(false);
        return;
      }

      if (!trimmed.toLowerCase().endsWith('.txt')) {
        setClassFilePreview('');
        setClassFilePreviewError('Preview is available for .txt files only.');
        setClassFilePreviewTruncated(false);
        return;
      }

      try {
        const res = await fetch(`/api/class-file?path=${encodeURIComponent(trimmed)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setClassFilePreview('');
          setClassFilePreviewError(data.error || 'Failed to load preview');
          setClassFilePreviewTruncated(false);
          return;
        }
        setClassFilePreview(data.content || '');
        setClassFilePreviewError('');
        setClassFilePreviewTruncated(Boolean(data.truncated));
      } catch {
        if (cancelled) return;
        setClassFilePreview('');
        setClassFilePreviewError('Failed to load preview');
        setClassFilePreviewTruncated(false);
      }
    }

    loadClassFilePreview();
    return () => {
      cancelled = true;
    };
  }, [classFile]);

  // Fetch matching duplicate rule whenever path changes
  useEffect(() => {
    const trimmed = datasetPath.trim();
    if (!trimmed) { setDupRule(null); return; }
    let cancelled = false;
    fetch(`/api/duplicate-rule?path=${encodeURIComponent(trimmed)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (!cancelled && data) setDupRule(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [datasetPath]);

  function resetDupOverrides() {
    setDupAction('');
    setDupLabels('');
    setDupThreshold('');
    setDupDebug(null);
  }

  const effectiveAction    = dupAction    || dupRule?.action    || 'move';
  const effectiveLabels    = dupLabels    !== '' ? Number(dupLabels)    : (dupRule?.labels    ?? 0);
  const effectiveThreshold = dupThreshold !== '' ? Number(dupThreshold) : (dupRule?.iouThreshold ?? 0.8);
  const effectiveDebug     = dupDebug     !== null ? dupDebug            : (dupRule?.debug      ?? false);

  const isTypeMode = !!selectedTypeId;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/datasets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasetPath: datasetPath.trim(),
          displayName: displayName.trim() || undefined,
          classFile: classFile.trim() || null,
          pentagonFormat: obbFormat,
          obbMode: obbFormat ? obbMode : 'rectangle',
          duplicateMode: effectiveAction,
          duplicateLabels: effectiveLabels,
          threshold: effectiveThreshold,
          debug: effectiveDebug,
          typeId: selectedTypeId ? Number(selectedTypeId) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to create dataset'); return; }
      onCreated(data.dataset);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
    <div style={styles.modalOverlay}>
      <div style={{ ...styles.modal, maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>Add Dataset</h2>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={styles.form}>

          {/* Dataset Type selector — only shown when types exist */}
          {!typesLoading && datasetTypes.length > 0 && (
            <div style={styles.field}>
              <label style={styles.label}>Dataset Type</label>
              <select
                style={styles.select}
                value={selectedTypeId}
                onChange={(e) => {
                  setSelectedTypeId(e.target.value);
                  if (!e.target.value) {
                    setDatasetPath('');
                    setDisplayName('');
                  }
                }}
              >
                <option value="">None / Manual path</option>
                {datasetTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Subdir picker when type is selected */}
          {isTypeMode && (
            <div style={styles.field}>
              <label style={styles.label}>Dataset Subdirectory *</label>
              {subdirsLoading ? (
                <p style={{ color: '#9ba9c3', fontSize: '12px' }}>Loading available datasets…</p>
              ) : availableSubdirs.length === 0 ? (
                <p style={{ color: '#f1b11a', fontSize: '12px' }}>No available datasets found in uncheck path.</p>
              ) : (
                <select
                  style={styles.select}
                  value={selectedSubdir}
                  onChange={(e) => setSelectedSubdir(e.target.value)}
                  required
                >
                  <option value="">Select a dataset…</option>
                  {availableSubdirs.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}{s.imageCount != null ? ` — ${s.imageCount} images` : ''}
                    </option>
                  ))}
                </select>
              )}
              {selectedSubdir && (
                <small style={styles.hint}>Path: {datasetPath}</small>
              )}
            </div>
          )}

          <div style={styles.field}>
            <label style={styles.label}>Display Name</label>
            <input
              style={styles.input}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Dataset name"
              autoFocus={!isTypeMode}
            />
          </div>

          {/* Manual path input — only shown when no type selected */}
          {!isTypeMode && (
            <div style={styles.field}>
              <label style={styles.label}>Dataset Path *</label>
              <div style={styles.inputRow}>
                <input
                  style={{ ...styles.input, flex: 1 }}
                  value={datasetPath}
                  onChange={(e) => setDatasetPath(e.target.value)}
                  placeholder="/data/my-dataset"
                  required
                />
                <button type="button" style={styles.browseBtn} onClick={() => setShowPathBrowser(true)}>Browse</button>
              </div>
              <small style={styles.hint}>Absolute path to the directory containing an images/ folder</small>
            </div>
          )}

          <div style={styles.field}>
            <label style={styles.label}>Class Names File</label>
            <div style={styles.inputRow}>
              <input
                style={{ ...styles.input, flex: 1 }}
                value={classFile}
                onChange={(e) => setClassFile(e.target.value)}
                placeholder="/data/my-dataset/classes.txt"
              />
              <button type="button" style={styles.browseBtn} onClick={() => setShowClassFileBrowser(true)}>Browse</button>
            </div>
            <small style={styles.hint}>Path to a .txt file with one class name per line</small>
            {(classFilePreview || classFilePreviewError) && (
              <div style={styles.previewBox}>
                <div style={styles.previewHeader}>
                  <span style={styles.previewTitle}>Preview</span>
                  {classFilePreviewTruncated && <span style={styles.previewMeta}>Truncated</span>}
                </div>
                {classFilePreviewError ? (
                  <p style={styles.previewError}>{classFilePreviewError}</p>
                ) : (
                  <pre style={styles.previewContent}>{classFilePreview}</pre>
                )}
              </div>
            )}
          </div>

          <div style={styles.sectionDivider} />

          <div style={styles.field}>
            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={obbFormat}
                onChange={(e) => setObbFormat(e.target.checked)}
                style={styles.checkbox}
              />
              <span style={styles.checkboxLabel}>OBB Format (Polygon)</span>
            </label>
            <small style={styles.hint}>
              Convert YOLO bounding boxes to OBB format (4 points, clockwise from top-left)
            </small>
          </div>

          {obbFormat && (
            <div style={styles.field}>
              <label style={styles.label}>OBB Creation Mode</label>
              <select style={styles.select} value={obbMode} onChange={(e) => setObbMode(e.target.value)}>
                <option value="rectangle">Rectangle (axis-aligned → 4-point)</option>
                <option value="4point">4-Point (free polygon)</option>
              </select>
            </div>
          )}

          <div style={styles.sectionDivider} />

          {/* Duplicate Detection Config */}
          <div style={styles.field}>
            <div style={styles.dupHeader}>
              <span style={styles.label}>Duplicate Detection</span>
              {dupRule && (
                <span style={styles.dupBadge}>
                  {dupRule.matchedPattern
                    ? <>matched: <code style={styles.dupCode}>{dupRule.matchedPattern}</code></>
                    : 'default'}
                </span>
              )}
              {(dupAction || dupLabels !== '' || dupThreshold !== '' || dupDebug !== null) && (
                <button type="button" style={styles.dupResetBtn} onClick={resetDupOverrides}>
                  Reset to auto
                </button>
              )}
            </div>

            <div style={styles.dupGrid}>
              <div style={styles.dupField}>
                <label style={styles.dupLabel}>Action</label>
                <select
                  style={styles.select}
                  value={dupAction || effectiveAction}
                  onChange={(e) => setDupAction(e.target.value)}
                >
                  <option value="move">Move to duplicate/</option>
                  <option value="delete">Delete</option>
                  <option value="skip">Skip (no detection)</option>
                </select>
              </div>

              <div style={styles.dupField}>
                <label style={styles.dupLabel}>IoU Threshold</label>
                <input
                  style={styles.input}
                  type="number"
                  min="0" max="1" step="0.05"
                  value={dupThreshold !== '' ? dupThreshold : effectiveThreshold}
                  onChange={(e) => setDupThreshold(e.target.value)}
                />
              </div>

              <div style={styles.dupField}>
                <label style={styles.dupLabel}>Labels Limit <small style={styles.dupMeta}>(0 = all)</small></label>
                <input
                  style={styles.input}
                  type="number"
                  min="0" step="1"
                  value={dupLabels !== '' ? dupLabels : effectiveLabels}
                  onChange={(e) => setDupLabels(e.target.value)}
                />
              </div>

              <div style={styles.dupField}>
                <label style={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    style={styles.checkbox}
                    checked={effectiveDebug}
                    onChange={(e) => setDupDebug(e.target.checked)}
                  />
                  <span style={styles.dupLabel}>Debug mode</span>
                </label>
              </div>
            </div>

            {effectiveAction === 'skip' && (
              <p style={styles.dupSkipNote}>Duplicate detection will be skipped for this dataset.</p>
            )}
          </div>

          {error && <p style={styles.errorMsg}>{error}</p>}
          <button type="submit" style={styles.submitBtn} disabled={loading || (isTypeMode && !selectedSubdir)}>
            {loading ? 'Creating…' : 'Create Dataset'}
          </button>
        </form>
      </div>
    </div>

      {showPathBrowser && (
        <DatasetBrowser
          value={datasetPath}
          onChange={(p) => {
            setDatasetPath(p);
            const folderName = p.split('/').filter(Boolean).pop() || '';
            setDisplayName(folderName);
          }}
          onClassFileFound={(cf) => { if (cf) setClassFile(cf); }}
          onClose={() => setShowPathBrowser(false)}
        />
      )}
      {showClassFileBrowser && (
        <FileBrowser
          mode="file"
          fileFilter={(f) => f.endsWith('.txt') || f.endsWith('.names') || f.endsWith('.yaml') || f.endsWith('.yml')}
          value={classFile}
          onChange={setClassFile}
          onClose={() => setShowClassFileBrowser(false)}
        />
      )}
    </>
  );
}

function MarkDoneConfirmModal({ onConfirm, onClose }) {
  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>Mark Job as Done?</h2>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <p style={{ color: '#9ba9c3', fontSize: '14px', marginBottom: '20px' }}>
          This will mark the job as completed. You will no longer be able to edit it unless a manager reopens it.
        </p>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={styles.confirmDoneBtn} onClick={onConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useCurrentUser();
  const [datasets, setDatasets] = useState([]);
  const [jobs, setJobs] = useState({}); // datasetId → jobs[]
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('datasets');

  const isAdmin = user?.role === 'admin';
  const isDM = user?.role === 'data-manager';
  const isAdminOrDM = isAdmin || isDM;

  function openInNewTab(path) {
    if (typeof window === 'undefined') return;
    window.open(path, '_blank', 'noopener,noreferrer');
  }

  function openDatasetViewer(datasetId) {
    openInNewTab(`/viewer?datasetId=${encodeURIComponent(datasetId)}`);
  }

  function openDatasetEditor(datasetId) {
    openInNewTab(`/label-editor?datasetId=${encodeURIComponent(datasetId)}`);
  }

  const loadDatasets = useCallback(async () => {
    try {
      const res = await fetch('/api/datasets');
      const data = await res.json();
      if (res.ok) setDatasets(data.datasets || []);
      else setError(data.error || 'Failed to load datasets');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadJobs = useCallback(async (datasetId) => {
    try {
      const res = await fetch(`/api/datasets/${datasetId}/jobs`);
      const data = await res.json();
      if (res.ok) {
        setJobs((prev) => ({ ...prev, [datasetId]: data.jobs || [] }));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!authLoading) loadDatasets();
  }, [authLoading, loadDatasets]);

  useEffect(() => {
    if (isAdminOrDM && datasets.length > 0) {
      datasets.forEach((d) => loadJobs(d.id));
    }
  }, [isAdminOrDM, datasets, loadJobs]);

  useEffect(() => {
    if (authLoading || !isAdminOrDM) return undefined;

    return subscribeSSE('/api/datasets/stream', {
      datasets: (e) => {
        try {
          const data = JSON.parse(e.data);
          setDatasets(Array.isArray(data.datasets) ? data.datasets : []);
          setJobs(data.jobsByDataset && typeof data.jobsByDataset === 'object' ? data.jobsByDataset : {});
          setLoading(false);
        } catch {
          // Ignore malformed SSE payloads.
        }
      },
      error: () => setLoading(false),
    });
  }, [authLoading, isAdminOrDM]);

  // For regular users: show their assigned jobs grouped by dataset
  const myJobs = !isAdminOrDM && datasets.length > 0
    ? datasets.flatMap((d) => (jobs[d.id] || []).map((j) => ({ ...j, dataset: d })))
    : [];

  if (authLoading || loading) {
    return (
      <div style={styles.page}>
        <AppHeader />
        <div style={styles.loading}>Loading…</div>
      </div>
    );
  }

  if (isAdminOrDM) {
    return (
      <div style={styles.page}>
        <AppHeader />
        <main style={styles.main}>
          {isDM && (
            <div style={styles.tabBar}>
              <button
                style={{ ...styles.tab, ...(activeTab === 'datasets' ? styles.tabActive : {}) }}
                onClick={() => setActiveTab('datasets')}
              >
                Datasets
              </button>
              <button
                style={{ ...styles.tab, ...(activeTab === 'my-jobs' ? styles.tabActive : {}) }}
                onClick={() => setActiveTab('my-jobs')}
              >
                My Jobs
              </button>
            </div>
          )}

          {activeTab === 'my-jobs' ? (
            <MyJobsTab />
          ) : (
            <>
              <div style={styles.topBar}>
                <div>
                  <h1 style={styles.h1}>Datasets</h1>
                  <p style={styles.subtitle}>{datasets.length} dataset{datasets.length !== 1 ? 's' : ''}</p>
                </div>
                <button style={styles.addBtn} onClick={() => setShowAdd(true)}>+ Add Dataset</button>
              </div>

              {error && <p style={styles.errorMsg}>{error}</p>}

              {datasets.length === 0 ? (
                <div style={styles.empty}>
                  <p style={styles.emptyText}>No datasets yet.</p>
                  <button style={styles.addBtn} onClick={() => setShowAdd(true)}>Add your first dataset</button>
                </div>
              ) : (
                <div style={styles.grid}>
                  {datasets.map((d) => {
                    const dsJobs = jobs[d.id];
                    const scanning = !!d.hasRunningTask;
                    const moveColor = MOVE_STATUS_COLOR[d.moveStatus];
                    return (
                      <div
                        key={d.id}
                        style={{ ...styles.card, ...(scanning ? styles.cardScanning : {}) }}
                        onClick={() => router.push(`/datasets/${d.id}`)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && router.push(`/datasets/${d.id}`)}
                      >
                        <div style={styles.cardHeader}>
                          <span style={styles.cardName}>{d.displayName || d.datasetPath.split('/').pop()}</span>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            {moveColor && (
                              <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: moveColor + '22', color: moveColor, border: `1px solid ${moveColor}44` }}>
                                {MOVE_STATUS_LABEL[d.moveStatus] || d.moveStatus}
                              </span>
                            )}
                            {scanning
                              ? <span style={styles.scanningBadge}>⟳ Scanning…</span>
                              : <span style={styles.cardImages}>{d.totalImages} images</span>
                            }
                          </div>
                        </div>
                        <p style={styles.cardPath}>{d.datasetPath}</p>
                        <div style={styles.cardActions}>
                          <button
                            type="button"
                            style={styles.secondaryBtn}
                            onClick={(e) => { e.stopPropagation(); openDatasetViewer(d.id); }}
                          >
                            Open Viewer
                          </button>
                        </div>
                        {dsJobs ? (
                          <ProgressBar jobs={dsJobs} />
                        ) : (
                          <div style={styles.progressEmpty}>Loading jobs…</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </main>

        {showAdd && (
          <AddDatasetModal
            onClose={() => setShowAdd(false)}
            onCreated={(ds) => {
              setShowAdd(false);
              setDatasets((prev) => [ds, ...prev]);
              loadJobs(ds.id);
            }}
          />
        )}
      </div>
    );
  }

  // Regular user view: load my assigned jobs
  return (
    <UserDashboard user={user} />
  );
}

function MyJobsTab() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [markDoneConfirm, setMarkDoneConfirm] = useState(null); // jobId

  function openInNewTab(path) {
    if (typeof window === 'undefined') return;
    window.open(path, '_blank', 'noopener,noreferrer');
  }

  async function handleMarkDone(jobId) {
    try {
      const job = jobs.find((j) => j.id === jobId);
      const res = await fetch(`/api/datasets/${job?.datasetId}/jobs/${jobId}/complete`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, status: data.job?.status ?? 'labelled' } : j));
      }
    } catch { /* ignore */ }
    setMarkDoneConfirm(null);
  }

  useEffect(() => {
    let cancelled = false;

    fetch('/api/my-jobs')
      .then((r) => r.ok ? r.json() : { jobs: [] })
      .then((data) => { if (!cancelled) { setJobs(data.jobs || []); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });

    const unsub = subscribeSSE('/api/my-jobs/stream', {
      jobs: (e) => {
        try {
          const data = JSON.parse(e.data);
          if (!cancelled) { setJobs(Array.isArray(data.jobs) ? data.jobs : []); setLoading(false); }
        } catch {}
      },
      error: () => { if (!cancelled) setLoading(false); },
    });

    return () => { cancelled = true; unsub(); };
  }, []);

  if (loading) return <div style={styles.loading}>Loading…</div>;

  if (jobs.length === 0) {
    return (
      <div style={styles.empty}>
        <p style={styles.emptyText}>No jobs assigned to you yet.</p>
        <p style={{ color: '#9ba9c3', fontSize: '13px' }}>Ask your data manager to assign jobs.</p>
      </div>
    );
  }

  return (
    <>
      <div>
        <div style={styles.topBar}>
          <div>
            <h1 style={styles.h1}>My Jobs</h1>
            <p style={styles.subtitle}>{jobs.length} assigned job{jobs.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <div style={styles.jobList}>
          {jobs.map((j) => (
            <div key={j.id} style={styles.jobCard}>
              <div style={styles.jobCardLeft}>
                <span style={styles.jobCardDataset}>{j.datasetName || j.datasetPath?.split('/').pop() || `Dataset ${j.datasetId}`}</span>
                <span style={styles.jobCardTitle}>Job #{j.jobIndex}</span>
                <span style={styles.jobCardRange}>Images {j.imageStart}–{j.imageEnd}</span>
              </div>
              <div style={styles.jobCardRight}>
                <span style={{ ...styles.statusBadge, background: STATUS_COLOR[j.status] + '22', color: STATUS_COLOR[j.status] }}>
                  {STATUS_LABEL[j.status]}
                </span>
                {(j.status === 'unlabelled' || j.status === 'labeling') && (
                  <>
                    <button style={styles.secondaryBtn} onClick={() => openInNewTab(`/viewer?jobId=${j.id}`)}>
                      Open Viewer
                    </button>
                    <button style={styles.openBtn} onClick={() => openInNewTab(`/label-editor?jobId=${j.id}`)}>
                      Open Editor
                    </button>
                    <button style={styles.doneBtn} onClick={() => setMarkDoneConfirm(j.id)}>
                      Mark Done
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      {markDoneConfirm !== null && (
        <MarkDoneConfirmModal
          onConfirm={() => handleMarkDone(markDoneConfirm)}
          onClose={() => setMarkDoneConfirm(null)}
        />
      )}
    </>
  );
}

function UserDashboard({ user }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [markDoneConfirm, setMarkDoneConfirm] = useState(null); // jobId

  function openInNewTab(path) {
    if (typeof window === 'undefined') return;
    window.open(path, '_blank', 'noopener,noreferrer');
  }

  async function handleMarkDone(jobId) {
    try {
      const job = jobs.find((j) => j.id === jobId);
      const res = await fetch(`/api/datasets/${job?.datasetId}/jobs/${jobId}/complete`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, status: data.job?.status ?? 'labelled' } : j));
      }
    } catch { /* ignore */ }
    setMarkDoneConfirm(null);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/my-jobs');
        const data = await res.json();
        if (!cancelled && res.ok) setJobs(data.jobs || []);
      } catch { /* ignore */ } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    const unsub = subscribeSSE('/api/my-jobs/stream', {
      jobs: (e) => {
        try {
          const data = JSON.parse(e.data);
          if (!cancelled) {
            setJobs(Array.isArray(data.jobs) ? data.jobs : []);
            setLoading(false);
          }
        } catch {
          // Ignore malformed SSE payloads.
        }
      },
      error: () => { if (!cancelled) setLoading(false); },
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  if (loading) {
    return (
      <div style={styles.page}>
        <AppHeader />
        <div style={styles.loading}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <AppHeader />
      <main style={styles.main}>
        <div style={styles.topBar}>
          <div>
            <h1 style={styles.h1}>My Jobs</h1>
            <p style={styles.subtitle}>{jobs.length} assigned job{jobs.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        {jobs.length === 0 ? (
          <div style={styles.empty}>
            <p style={styles.emptyText}>No jobs assigned to you yet.</p>
            <p style={{ color: '#9ba9c3', fontSize: '13px' }}>Ask your data manager to assign jobs.</p>
          </div>
        ) : (
          <div style={styles.jobList}>
            {jobs.map((j) => (
              <div key={j.id} style={styles.jobCard}>
                <div style={styles.jobCardLeft}>
                  <span style={styles.jobCardDataset}>{j.datasetName || j.datasetPath?.split('/').pop() || `Dataset ${j.datasetId}`}</span>
                  <span style={styles.jobCardTitle}>Job #{j.jobIndex}</span>
                  <span style={styles.jobCardRange}>Images {j.imageStart}–{j.imageEnd}</span>
                </div>
                <div style={styles.jobCardRight}>
                  <span style={{ ...styles.statusBadge, background: STATUS_COLOR[j.status] + '22', color: STATUS_COLOR[j.status] }}>
                    {STATUS_LABEL[j.status]}
                  </span>
                  {(j.status === 'unlabelled' || j.status === 'labeling') && (
                    <>
                      <button style={styles.secondaryBtn} onClick={() => openInNewTab(`/viewer?jobId=${j.id}`)}>
                        Open Viewer
                      </button>
                      <button style={styles.openBtn} onClick={() => openInNewTab(`/label-editor?jobId=${j.id}`)}>
                        Open Editor
                      </button>
                      <button style={styles.doneBtn} onClick={() => setMarkDoneConfirm(j.id)}>
                        Mark Done
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      {markDoneConfirm !== null && (
        <MarkDoneConfirmModal
          onConfirm={() => handleMarkDone(markDoneConfirm)}
          onClose={() => setMarkDoneConfirm(null)}
        />
      )}
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: 'radial-gradient(circle at 20% 20%, #15233a, #0a111f 50%), radial-gradient(circle at 80% 0%, #12213a, #0a111f 40%), #0d1626',
    color: '#e6edf7',
    fontFamily: '"Nunito Sans", "Segoe UI", system-ui, -apple-system, sans-serif',
    display: 'flex',
    flexDirection: 'column',
  },
  loading: {
    padding: '60px',
    textAlign: 'center',
    color: '#9ba9c3',
  },
  main: {
    maxWidth: '1200px',
    width: '100%',
    margin: '0 auto',
    padding: '32px 24px 60px',
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '28px',
  },
  h1: {
    fontSize: '26px',
    fontWeight: 800,
    color: '#e6edf7',
    margin: 0,
  },
  subtitle: {
    color: '#9ba9c3',
    fontSize: '13px',
    marginTop: '4px',
  },
  addBtn: {
    background: '#e45d25',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 700,
    padding: '10px 18px',
    transition: 'background 0.15s',
  },
  errorMsg: {
    color: '#f87171',
    background: 'rgba(248,113,113,0.08)',
    border: '1px solid rgba(248,113,113,0.2)',
    borderRadius: '6px',
    padding: '10px 14px',
    fontSize: '13px',
    marginBottom: '16px',
  },
  empty: {
    textAlign: 'center',
    padding: '80px 20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
  },
  emptyText: {
    color: '#9ba9c3',
    fontSize: '15px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
    gap: '16px',
  },
  card: {
    background: '#152033',
    border: '1px solid #25344d',
    borderRadius: '12px',
    padding: '20px',
    cursor: 'pointer',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    outline: 'none',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '8px',
  },
  cardName: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#e6edf7',
    flex: 1,
    wordBreak: 'break-all',
  },
  cardImages: {
    fontSize: '12px',
    color: '#9ba9c3',
    whiteSpace: 'nowrap',
  },
  cardScanning: {
    opacity: 0.65,
    cursor: 'not-allowed',
    borderColor: '#2f7ff566',
  },
  scanningBadge: {
    fontSize: '11px', fontWeight: 700, color: '#2f7ff5',
    background: '#2f7ff522', borderRadius: '4px', padding: '2px 8px', whiteSpace: 'nowrap',
  },
  btnDisabled: {
    opacity: 0.4, cursor: 'not-allowed',
  },
  cardPath: {
    fontSize: '11px',
    color: '#5a6a8a',
    fontFamily: 'monospace',
    wordBreak: 'break-all',
    margin: 0,
  },
  cardActions: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  progressBar: {
    height: '8px',
    borderRadius: '4px',
    background: '#1b2940',
    display: 'flex',
    overflow: 'hidden',
    gap: '1px',
  },
  progressSegment: {
    height: '100%',
    transition: 'width 0.3s',
  },
  progressEmpty: {
    fontSize: '11px',
    color: '#5a6a8a',
  },
  progressStats: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  progressStat: {
    fontSize: '11px',
    color: '#9ba9c3',
  },
  jobList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  jobCard: {
    background: '#152033',
    border: '1px solid #25344d',
    borderRadius: '10px',
    padding: '16px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
  },
  jobCardLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    flex: 1,
  },
  jobCardDataset: {
    fontSize: '11px',
    color: '#9ba9c3',
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
  },
  jobCardTitle: {
    fontSize: '15px',
    fontWeight: 700,
    color: '#e6edf7',
  },
  jobCardRange: {
    fontSize: '12px',
    color: '#5a6a8a',
  },
  jobCardRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  statusBadge: {
    fontSize: '12px',
    fontWeight: 700,
    padding: '4px 10px',
    borderRadius: '20px',
  },
  openBtn: {
    background: '#e45d25',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 700,
    padding: '6px 14px',
  },
  secondaryBtn: {
    background: 'transparent',
    border: '1px solid #3a4f70',
    borderRadius: '6px',
    color: '#b8c7de',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 700,
    padding: '6px 14px',
  },
  tabBar: {
    display: 'flex',
    gap: '4px',
    marginBottom: '24px',
    borderBottom: '1px solid #1b2940',
    paddingBottom: '0',
  },
  tab: {
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    borderRadius: '0',
    color: '#9ba9c3',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 600,
    padding: '8px 16px',
    marginBottom: '-1px',
    transition: 'color 0.15s, border-color 0.15s',
  },
  tabActive: {
    color: '#e45d25',
    borderBottomColor: '#e45d25',
  },
  // Modal
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#152033',
    border: '1px solid #25344d',
    borderRadius: '14px',
    padding: '28px',
    width: '100%',
    maxWidth: '480px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  modalTitle: {
    fontSize: '18px',
    fontWeight: 800,
    color: '#e6edf7',
    margin: 0,
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: '#9ba9c3',
    cursor: 'pointer',
    fontSize: '22px',
    lineHeight: 1,
    padding: '0 4px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    color: '#9ba9c3',
    fontSize: '13px',
    fontWeight: 600,
  },
  input: {
    background: '#0d1626',
    border: '1px solid #25344d',
    borderRadius: '8px',
    color: '#e6edf7',
    fontSize: '14px',
    padding: '10px 12px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  hint: {
    color: '#5a6a8a',
    fontSize: '11px',
  },
  previewBox: {
    marginTop: '8px',
    background: '#0d1626',
    border: '1px solid #25344d',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  previewHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 10px',
    borderBottom: '1px solid #1b2940',
    background: '#111b2d',
  },
  previewTitle: {
    color: '#9ba9c3',
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
  },
  previewMeta: {
    color: '#e45d25',
    fontSize: '11px',
    fontWeight: 700,
  },
  previewContent: {
    margin: 0,
    padding: '10px 12px',
    maxHeight: '180px',
    overflow: 'auto',
    color: '#d6e2f1',
    fontSize: '12px',
    lineHeight: 1.5,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  previewError: {
    margin: 0,
    padding: '10px 12px',
    color: '#f87171',
    fontSize: '12px',
  },
  select: {
    background: '#0d1626',
    border: '1px solid #25344d',
    borderRadius: '8px',
    color: '#e6edf7',
    fontSize: '14px',
    padding: '10px 12px',
    outline: 'none',
    width: '100%',
  },
  inputRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  browseBtn: {
    background: 'transparent',
    border: '1px solid #25344d',
    borderRadius: '8px',
    color: '#9ba9c3',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 600,
    padding: '10px 12px',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  sectionDivider: {
    borderTop: '1px solid #1b2940',
    margin: '4px 0',
  },
  dupHeader: {
    display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', flexWrap: 'wrap',
  },
  dupBadge: {
    fontSize: '11px', color: '#9ba9c3',
    background: '#1b2940', borderRadius: '4px', padding: '2px 7px',
  },
  dupCode: { color: '#e45d25', fontFamily: 'monospace', fontSize: '11px' },
  dupResetBtn: {
    background: 'transparent', border: '1px solid #25344d', borderRadius: '4px',
    color: '#5a6a8a', cursor: 'pointer', fontSize: '11px', padding: '2px 8px',
    marginLeft: 'auto',
  },
  dupGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px',
  },
  dupField: { display: 'flex', flexDirection: 'column', gap: '5px' },
  dupLabel: { fontSize: '11px', color: '#9ba9c3', fontWeight: 600 },
  dupMeta: { color: '#5a6a8a', fontWeight: 400 },
  dupSkipNote: {
    fontSize: '11px', color: '#f1b11a',
    background: 'rgba(241,177,26,0.08)', border: '1px solid rgba(241,177,26,0.2)',
    borderRadius: '5px', padding: '6px 10px', margin: '6px 0 0',
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    cursor: 'pointer',
  },
  checkbox: {
    width: '16px',
    height: '16px',
    accentColor: '#e45d25',
    flexShrink: 0,
  },
  checkboxLabel: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#e6edf7',
  },
  cancelBtn: {
    background: 'transparent',
    border: '1px solid #25344d',
    borderRadius: '8px',
    color: '#9ba9c3',
    cursor: 'pointer',
    fontSize: '13px',
    padding: '9px 20px',
  },
  confirmDoneBtn: {
    background: '#20c25a',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 700,
    padding: '9px 20px',
  },
  doneBtn: {
    background: 'transparent',
    border: '1px solid #20c25a44',
    borderRadius: '6px',
    color: '#20c25a',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 700,
    padding: '6px 14px',
  },
  submitBtn: {
    background: '#e45d25',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 700,
    padding: '12px',
    marginTop: '4px',
    transition: 'background 0.15s',
  },
};
