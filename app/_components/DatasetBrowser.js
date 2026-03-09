'use client';

import { useState, useEffect } from 'react';

/**
 * DatasetBrowser — shows only dataset folders (images/ + labels/ subfolders)
 * and intermediate folders that contain datasets in their subtree.
 *
 * Props:
 *   value: string           — currently selected dataset path
 *   onChange: (path) => void
 *   onClassFileFound: (path) => void  — called with auto-detected classes.txt path
 *   onClose: () => void
 */
export default function DatasetBrowser({ value, onChange, onClassFileFound, onClose }) {
  const [currentPath, setCurrentPath] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [subdirs, setSubdirs] = useState([]);
  const [parent, setParent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    browse(null); // start at default (DATASET_BASE_PATH)
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function browse(dirPath) {
    setLoading(true);
    setSearch('');
    try {
      const url = dirPath
        ? `/api/browse-datasets?path=${encodeURIComponent(dirPath)}`
        : '/api/browse-datasets';
      const res = await fetch(url);
      const data = await res.json();
      setCurrentPath(data.currentPath);
      setDatasets(data.datasets || []);
      setSubdirs(data.subdirs || []);
      setParent(data.parent || null);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }

  async function selectDataset(ds) {
    onChange(ds.path);
    // Auto-find classes.txt
    try {
      const res = await fetch(`/api/auto-find-classes?path=${encodeURIComponent(ds.path)}`);
      const data = await res.json();
      if (data.classFile) onClassFileFound(data.classFile);
      else onClassFileFound('');
    } catch { onClassFileFound(''); }
    onClose();
  }

  // Breadcrumb from currentPath
  const breadcrumbs = [];
  if (currentPath) {
    const parts = currentPath === '/' ? [''] : currentPath.split('/');
    parts.forEach((p, i) => {
      breadcrumbs.push({
        label: i === 0 ? '/' : p,
        path: i === 0 ? '/' : parts.slice(0, i + 1).join('/'),
      });
    });
  }

  const lc = search.toLowerCase();
  const filteredDatasets = search ? datasets.filter((d) => d.name.toLowerCase().includes(lc)) : datasets;
  const filteredSubdirs = search ? subdirs.filter((d) => d.name.toLowerCase().includes(lc)) : subdirs;

  return (
    <div style={fb.overlay} onClick={onClose}>
      <div style={fb.panel} onClick={(e) => e.stopPropagation()}>
        <div style={fb.header}>
          <span style={fb.title}>Select Dataset</span>
          <button style={fb.closeBtn} onClick={onClose}>×</button>
        </div>

        {/* Breadcrumb */}
        <div style={fb.breadcrumb}>
          {breadcrumbs.map((b, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center' }}>
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

        {/* Listing */}
        <div style={fb.list}>
          {loading && <div style={fb.empty}>Scanning…</div>}

          {!loading && parent && (
            <button style={fb.item} onClick={() => browse(parent)}>
              <span style={fb.icon}>↑</span>
              <span style={fb.itemName}>..</span>
            </button>
          )}

          {/* Intermediate folders (contain datasets but aren't datasets themselves) */}
          {!loading && filteredSubdirs.map((d) => (
            <button key={d.path} style={fb.item} onClick={() => browse(d.path)}>
              <span style={fb.icon}>📁</span>
              <span style={fb.itemName}>{d.name}</span>
            </button>
          ))}

          {/* Actual datasets */}
          {!loading && filteredDatasets.map((d) => (
            <button
              key={d.path}
              style={{ ...fb.item, ...fb.datasetItem, ...(value === d.path ? fb.datasetSelected : {}) }}
              onClick={() => selectDataset(d)}
            >
              <span style={fb.icon}>🗂</span>
              <div style={fb.datasetInfo}>
                <span style={fb.itemName}>{d.name}</span>
                <span style={fb.imageCount}>{d.imageCount.toLocaleString()} images</span>
              </div>
            </button>
          ))}

          {!loading && filteredDatasets.length === 0 && filteredSubdirs.length === 0 && !parent && (
            <div style={fb.empty}>No datasets found</div>
          )}
          {!loading && filteredDatasets.length === 0 && filteredSubdirs.length === 0 && parent && (
            <div style={fb.empty}>No datasets in this folder</div>
          )}
        </div>

        <div style={fb.footer}>
          <span style={fb.footerHint}>
            Only folders with <code style={fb.code}>images/</code> and <code style={fb.code}>labels/</code> are shown
          </span>
        </div>
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
    width: '500px', maxWidth: '95vw', maxHeight: '78vh',
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 16px', borderBottom: '1px solid #25344d', flexShrink: 0,
  },
  title: { fontSize: '14px', fontWeight: 700, color: '#e6edf7' },
  closeBtn: {
    background: 'transparent', border: 'none', color: '#9ba9c3',
    cursor: 'pointer', fontSize: '20px', lineHeight: 1,
  },
  breadcrumb: {
    padding: '8px 14px', background: '#0d1626', borderBottom: '1px solid #1b2940',
    display: 'flex', flexWrap: 'wrap', gap: '2px', alignItems: 'center',
    fontSize: '12px', flexShrink: 0, minHeight: '34px',
  },
  sep: { color: '#25344d', margin: '0 2px' },
  breadBtn: {
    background: 'transparent', border: 'none', color: '#2f7ff5',
    cursor: 'pointer', fontSize: '12px', padding: '1px 3px', borderRadius: '3px',
  },
  search: {
    margin: '8px 12px', background: '#0d1626', border: '1px solid #25344d',
    borderRadius: '6px', color: '#e6edf7', fontSize: '12px',
    padding: '6px 10px', outline: 'none', flexShrink: 0,
  },
  list: { flex: 1, overflowY: 'auto', padding: '4px 8px' },
  item: {
    display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
    background: 'transparent', border: 'none', borderRadius: '6px',
    color: '#e6edf7', cursor: 'pointer', fontSize: '13px',
    padding: '8px 10px', textAlign: 'left', transition: 'background 0.1s',
  },
  datasetItem: {
    borderBottom: '1px solid #1b2940',
  },
  datasetSelected: {
    background: 'rgba(228,93,37,0.12)',
    outline: '1px solid rgba(228,93,37,0.4)',
  },
  icon: { fontSize: '16px', flexShrink: 0 },
  datasetInfo: {
    display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0,
  },
  itemName: { fontWeight: 600, wordBreak: 'break-all', lineHeight: 1.3 },
  imageCount: { fontSize: '11px', color: '#20c25a', fontWeight: 600 },
  empty: { color: '#5a6a8a', fontSize: '12px', padding: '24px', textAlign: 'center' },
  footer: {
    padding: '10px 16px', borderTop: '1px solid #25344d',
    background: '#0d1626', borderRadius: '0 0 12px 12px', flexShrink: 0,
  },
  footerHint: { fontSize: '11px', color: '#5a6a8a' },
  code: { fontFamily: 'monospace', color: '#9ba9c3', fontSize: '11px' },
};
