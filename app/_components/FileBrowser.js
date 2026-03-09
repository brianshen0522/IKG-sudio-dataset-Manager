'use client';

import { useState, useEffect } from 'react';

/**
 * FileBrowser — inline folder/file picker using /api/browse-path
 *
 * Props:
 *   mode: 'folder' | 'file'  — folder picks directories; file picks files
 *   fileFilter: fn(name) => bool  — optional filter for file mode (e.g. .txt only)
 *   value: string  — current selected path
 *   onChange: (path: string) => void
 *   onClose: () => void
 */
export default function FileBrowser({ mode = 'folder', fileFilter, value, onChange, onClose }) {
  const [currentPath, setCurrentPath] = useState('/');
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function init() {
      // Start at the pre-filled value (folder mode) or fetch DATASET_BASE_PATH
      if (value) {
        // Start at the directory containing the selected value
        const dir = mode === 'file'
          ? value.replace(/\/[^/]+$/, '') || '/'
          : value;
        browse(dir);
      } else {
        try {
          const res = await fetch('/api/config');
          const cfg = await res.json();
          browse(cfg.datasetBasePath || '/');
        } catch {
          browse('/');
        }
      }
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function browse(dirPath) {
    setLoading(true);
    setSearch('');
    try {
      const filterClassFiles = mode === 'file' ? 'false' : 'false';
      const res = await fetch(`/api/browse-path?path=${encodeURIComponent(dirPath)}&filterClassFiles=${filterClassFiles}`);
      const data = await res.json();
      setCurrentPath(dirPath);
      setFolders(data.folders || []);
      setFiles((data.files || []).filter(fileFilter || (() => true)));
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }

  function goUp() {
    const parent = currentPath === '/' ? '/' : currentPath.replace(/\/[^/]+\/?$/, '') || '/';
    browse(parent);
  }

  function goInto(folder) {
    const next = currentPath.endsWith('/') ? currentPath + folder : currentPath + '/' + folder;
    browse(next);
  }

  function selectFolder() {
    onChange(currentPath);
    onClose();
  }

  function selectFile(filename) {
    const full = currentPath.endsWith('/') ? currentPath + filename : currentPath + '/' + filename;
    onChange(full);
    onClose();
  }

  // Breadcrumbs
  const parts = currentPath === '/' ? [''] : currentPath.split('/');
  const breadcrumbs = parts.map((p, i) => ({
    label: i === 0 ? '/' : p,
    path: i === 0 ? '/' : parts.slice(0, i + 1).join('/'),
  }));

  const filteredFolders = search
    ? folders.filter((f) => f.toLowerCase().includes(search.toLowerCase()))
    : folders;
  const filteredFiles = search
    ? files.filter((f) => f.toLowerCase().includes(search.toLowerCase()))
    : files;

  return (
    <div style={fb.overlay} onClick={onClose}>
      <div style={fb.panel} onClick={(e) => e.stopPropagation()}>
        <div style={fb.header}>
          <span style={fb.title}>{mode === 'folder' ? 'Select Folder' : 'Select File'}</span>
          <button style={fb.closeBtn} onClick={onClose}>×</button>
        </div>

        {/* Breadcrumb */}
        <div style={fb.breadcrumb}>
          {breadcrumbs.map((b, i) => (
            <span key={i}>
              {i > 0 && <span style={fb.sep}>/</span>}
              <button style={fb.breadBtn} onClick={() => browse(b.path)}>{b.label}</button>
            </span>
          ))}
        </div>

        {/* Search */}
        <input
          style={fb.search}
          placeholder="Filter…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* File listing */}
        <div style={fb.list}>
          {loading && <div style={fb.empty}>Loading…</div>}
          {!loading && currentPath !== '/' && (
            <button style={fb.item} onClick={goUp}>
              <span style={fb.icon}>↑</span>
              <span style={fb.itemName}>..</span>
            </button>
          )}
          {!loading && filteredFolders.map((f) => (
            <button key={f} style={fb.item} onClick={() => goInto(f)}>
              <span style={fb.icon}>📁</span>
              <span style={fb.itemName}>{f}</span>
            </button>
          ))}
          {!loading && mode === 'file' && filteredFiles.map((f) => (
            <button key={f} style={{ ...fb.item, ...fb.fileItem }} onClick={() => selectFile(f)}>
              <span style={fb.icon}>📄</span>
              <span style={fb.itemName}>{f}</span>
            </button>
          ))}
          {!loading && filteredFolders.length === 0 && (mode === 'file' ? filteredFiles.length === 0 : true) && (
            <div style={fb.empty}>No items</div>
          )}
        </div>

        {mode === 'folder' && (
          <div style={fb.footer}>
            <span style={fb.selectedPath}>{currentPath}</span>
            <button style={fb.selectBtn} onClick={selectFolder}>Select This Folder</button>
          </div>
        )}
      </div>
    </div>
  );
}

const fb = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
  },
  panel: {
    background: '#152033', border: '1px solid #25344d', borderRadius: '12px',
    width: '480px', maxWidth: '95vw', maxHeight: '75vh',
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 16px', borderBottom: '1px solid #25344d', flexShrink: 0,
  },
  title: { fontSize: '14px', fontWeight: 700, color: '#e6edf7' },
  closeBtn: { background: 'transparent', border: 'none', color: '#9ba9c3', cursor: 'pointer', fontSize: '20px', lineHeight: 1 },
  breadcrumb: {
    padding: '8px 16px', background: '#0d1626', borderBottom: '1px solid #1b2940',
    display: 'flex', flexWrap: 'wrap', gap: '2px', alignItems: 'center', flexShrink: 0,
    fontSize: '12px',
  },
  sep: { color: '#25344d', margin: '0 2px' },
  breadBtn: { background: 'transparent', border: 'none', color: '#2f7ff5', cursor: 'pointer', fontSize: '12px', padding: '1px 3px', borderRadius: '3px' },
  search: {
    margin: '8px 12px', background: '#0d1626', border: '1px solid #25344d',
    borderRadius: '6px', color: '#e6edf7', fontSize: '12px', padding: '6px 10px',
    outline: 'none', flexShrink: 0,
  },
  list: {
    flex: 1, overflowY: 'auto', padding: '4px 8px',
  },
  item: {
    display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
    background: 'transparent', border: 'none', borderRadius: '6px',
    color: '#e6edf7', cursor: 'pointer', fontSize: '13px',
    padding: '7px 10px', textAlign: 'left',
    transition: 'background 0.1s',
  },
  fileItem: { color: '#9ba9c3' },
  icon: { fontSize: '14px', flexShrink: 0 },
  itemName: { wordBreak: 'break-all', lineHeight: 1.3 },
  empty: { color: '#5a6a8a', fontSize: '12px', padding: '20px', textAlign: 'center' },
  footer: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: '12px', padding: '10px 14px', borderTop: '1px solid #25344d',
    background: '#0d1626', borderRadius: '0 0 12px 12px', flexShrink: 0,
  },
  selectedPath: { fontSize: '11px', color: '#9ba9c3', fontFamily: 'monospace', flex: 1, wordBreak: 'break-all' },
  selectBtn: {
    background: '#e45d25', border: 'none', borderRadius: '6px',
    color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 700,
    padding: '7px 14px', whiteSpace: 'nowrap', flexShrink: 0,
  },
};
