'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from './_components/AppHeader';
import { useCurrentUser } from './_components/useCurrentUser';
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

function EditedImagesModal({ job, images, loading, error, openOneLabel = 'Open Editor', openAllLabel = 'Open All in Editor', onOpenOne, onOpenAll, onClose }) {
  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={{ ...styles.modal, maxWidth: '640px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>Edited Images for Job #{job?.jobIndex}</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        {loading ? (
          <p style={styles.modalMuted}>Loading edited images…</p>
        ) : error ? (
          <p style={styles.errorMsg}>{error}</p>
        ) : images.length === 0 ? (
          <p style={styles.modalMuted}>No edited images found.</p>
        ) : (
          <>
            <div style={styles.editedList}>
              {images.map((item) => (
                <div key={item.labelFilename} style={styles.editedRow}>
                  <div style={styles.editedInfo}>
                    <span style={styles.editedName}>{item.imageName || item.labelFilename}</span>
                    {item.missingImage && <span style={styles.editedMeta}>Image file missing</span>}
                  </div>
                  {!item.missingImage && (
                    <button style={styles.openBtn} onClick={() => onOpenOne(item.imageName)}>
                      {openOneLabel}
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div style={styles.editedFooter}>
              <button style={styles.cancelBtn} onClick={onClose}>Close</button>
              <button style={styles.submitBtn} onClick={onOpenAll} disabled={!images.some((item) => item.imageName)}>
                {openAllLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

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
  const [step, setStep] = useState(1); // 1=select, 2=review+settings

  // Type + subdirs
  const [datasetTypes, setDatasetTypes] = useState([]);
  const [typesLoading, setTypesLoading] = useState(true);
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [availableSubdirs, setAvailableSubdirs] = useState([]);
  const [subdirsLoading, setSubdirsLoading] = useState(false);
  const [selectedNames, setSelectedNames] = useState(new Set());

  // Per-dataset class file (keyed by subdir name)
  const [itemClassFiles, setItemClassFiles] = useState({});
  const [classFilesLoading, setClassFilesLoading] = useState(false);

  // Users list for assignment
  const [users, setUsers] = useState([]);
  const [assignToUserId, setAssignToUserId] = useState('');

  // Shared settings
  const [obbFormat, setObbFormat] = useState(false);
  const [obbMode, setObbMode] = useState('rectangle');
  const [dupConfigMode, setDupConfigMode] = useState('shared'); // 'shared' | 'individual'
  const [dupAction, setDupAction] = useState('move');
  const [dupLabels, setDupLabels] = useState(0);
  const [dupThreshold, setDupThreshold] = useState(0.8);
  const [dupDebug, setDupDebug] = useState(false);
  // Per-dataset dup settings (individual mode)
  const [itemDupSettings, setItemDupSettings] = useState({});
  // Multi-select in review table for bulk dup edit
  const [reviewSelected, setReviewSelected] = useState(new Set());
  const [bulkDup, setBulkDup] = useState({ action: 'move', labels: 0, threshold: 0.8, debug: false });

  const [loading, setLoading] = useState(false);
  const [createResults, setCreateResults] = useState(null); // { succeeded[], failed[] }
  const [error, setError] = useState('');

  // Load users for assignment
  useEffect(() => {
    fetch('/api/users')
      .then((r) => r.ok ? r.json() : { users: [] })
      .then((d) => setUsers((d.users || []).filter((u) => u.role === 'user' || u.role === 'data-manager')))
      .catch(() => {});
  }, []);

  // Load types on mount
  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings/dataset-types')
      .then((r) => r.ok ? r.json() : { types: [] })
      .then((data) => {
        if (!cancelled) {
          const types = data.types || [];
          setDatasetTypes(types);
          if (types.length === 1) setSelectedTypeId(String(types[0].id));
          setTypesLoading(false);
        }
      })
      .catch(() => { if (!cancelled) setTypesLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Load subdirs when type changes
  useEffect(() => {
    if (!selectedTypeId) { setAvailableSubdirs([]); setSelectedNames(new Set()); return; }
    let cancelled = false;
    setSubdirsLoading(true);
    setSelectedNames(new Set());
    fetch(`/api/settings/dataset-types/${selectedTypeId}/available-datasets`)
      .then((r) => r.ok ? r.json() : { available: [] })
      .then((data) => { if (!cancelled) { setAvailableSubdirs(data.available || []); setSubdirsLoading(false); } })
      .catch(() => { if (!cancelled) setSubdirsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedTypeId]);

  function toggleName(name) {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  function toggleAll() {
    if (selectedNames.size === availableSubdirs.length) {
      setSelectedNames(new Set());
    } else {
      setSelectedNames(new Set(availableSubdirs.map((s) => s.name)));
    }
  }

  async function goToReview() {
    setClassFilesLoading(true);
    const files = {};
    await Promise.all(
      [...selectedNames].map(async (name) => {
        const found = availableSubdirs.find((s) => s.name === name);
        if (!found) return;
        try {
          const r = await fetch(`/api/auto-find-classes?path=${encodeURIComponent(found.path)}`);
          const d = await r.json();
          files[name] = d.classFile || '';
        } catch { files[name] = ''; }
      })
    );
    setItemClassFiles(files);
    // Init per-item dup from shared
    const dups = {};
    for (const name of selectedNames) {
      dups[name] = { action: dupAction, labels: dupLabels, threshold: dupThreshold, debug: dupDebug };
    }
    setItemDupSettings(dups);
    setReviewSelected(new Set());
    setClassFilesLoading(false);
    setStep(2);
  }

  async function handleCreate() {
    setLoading(true);
    setError('');
    const succeeded = [], failed = [];
    for (const name of selectedNames) {
      const found = availableSubdirs.find((s) => s.name === name);
      if (!found) continue;
      try {
        const res = await fetch('/api/datasets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            datasetPath: found.path,
            displayName: name,
            classFile: itemClassFiles[name] || null,
            pentagonFormat: obbFormat,
            obbMode: obbFormat ? obbMode : 'rectangle',
            duplicateMode: dupConfigMode === 'individual' ? (itemDupSettings[name]?.action ?? dupAction) : dupAction,
            duplicateLabels: Number(dupConfigMode === 'individual' ? (itemDupSettings[name]?.labels ?? dupLabels) : dupLabels),
            threshold: Number(dupConfigMode === 'individual' ? (itemDupSettings[name]?.threshold ?? dupThreshold) : dupThreshold),
            debug: dupConfigMode === 'individual' ? (itemDupSettings[name]?.debug ?? dupDebug) : dupDebug,
            typeId: Number(selectedTypeId),
            autoAssignTo: assignToUserId ? Number(assignToUserId) : null,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          succeeded.push(data.dataset);
        } else {
          failed.push({ name, error: data.error || 'Failed' });
        }
      } catch {
        failed.push({ name, error: 'Network error' });
      }
    }
    setLoading(false);
    if (failed.length === 0) {
      succeeded.forEach(onCreated);
      onClose();
    } else {
      setCreateResults({ succeeded, failed });
      succeeded.forEach(onCreated);
    }
  }

  const allSelected = availableSubdirs.length > 0 && selectedNames.size === availableSubdirs.length;
  const someSelected = selectedNames.size > 0 && selectedNames.size < availableSubdirs.length;

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={{ ...styles.modal, maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <div>
            <h2 style={styles.modalTitle}>Add Datasets</h2>
            <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
              {[1, 2].map((n) => (
                <span key={n} style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px',
                  background: step === n ? '#e45d2522' : '#1b294022',
                  color: step === n ? '#e45d25' : '#5a6a8a',
                  border: `1px solid ${step === n ? '#e45d2544' : '#25344d'}` }}>
                  {n === 1 ? '1. Select' : '2. Review & Create'}
                </span>
              ))}
            </div>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        {/* ── STEP 1: Type + multi-select subdirs ── */}
        {step === 1 && (
          <div style={styles.form}>
            {/* Type selector */}
            <div style={styles.field}>
              <label style={styles.label}>Dataset Type *</label>
              {typesLoading ? (
                <p style={{ color: '#9ba9c3', fontSize: '12px' }}>Loading types…</p>
              ) : datasetTypes.length === 0 ? (
                <p style={{ color: '#f1b11a', fontSize: '13px' }}>No dataset types configured. Add one in Settings first.</p>
              ) : (
                <select style={styles.select} value={selectedTypeId} onChange={(e) => setSelectedTypeId(e.target.value)} required>
                  <option value="">Select a type…</option>
                  {datasetTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
            </div>

            {/* Subdir multi-select list */}
            {selectedTypeId && (
              <div style={styles.field}>
                <label style={styles.label}>
                  Select Datasets
                  {availableSubdirs.length > 0 && (
                    <span style={{ color: '#5a6a8a', fontWeight: 400, marginLeft: '8px' }}>
                      {selectedNames.size} / {availableSubdirs.length} selected
                    </span>
                  )}
                </label>
                {subdirsLoading ? (
                  <p style={{ color: '#9ba9c3', fontSize: '12px' }}>Loading available datasets…</p>
                ) : availableSubdirs.length === 0 ? (
                  <p style={{ color: '#f1b11a', fontSize: '12px' }}>No available datasets found in uncheck path.</p>
                ) : (
                  <div style={{ border: '1px solid #25344d', borderRadius: '8px', overflow: 'hidden' }}>
                    {/* Select all header */}
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px',
                      background: '#1b2940', borderBottom: '1px solid #25344d', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected; }}
                        onChange={toggleAll}
                        style={styles.checkbox}
                      />
                      <span style={{ fontSize: '12px', color: '#9ba9c3', fontWeight: 600 }}>Select All</span>
                    </label>
                    {/* Subdir rows */}
                    <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
                      {availableSubdirs.map((s) => (
                        <label key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '10px',
                          padding: '8px 12px', cursor: 'pointer',
                          background: selectedNames.has(s.name) ? 'rgba(228,93,37,0.06)' : 'transparent',
                          borderBottom: '1px solid #1b2940' }}>
                          <input
                            type="checkbox"
                            checked={selectedNames.has(s.name)}
                            onChange={() => toggleName(s.name)}
                            style={styles.checkbox}
                          />
                          <span style={{ flex: 1, fontSize: '13px', color: '#e6edf7' }}>{s.name}</span>
                          {s.imageCount != null && (
                            <span style={{ fontSize: '11px', color: '#5a6a8a', fontFamily: 'monospace' }}>
                              {s.imageCount} imgs
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
              <button style={styles.cancelBtn} type="button" onClick={onClose}>Cancel</button>
              <button
                style={{ ...styles.submitBtn, opacity: selectedNames.size === 0 || classFilesLoading ? 0.5 : 1 }}
                type="button"
                disabled={selectedNames.size === 0 || classFilesLoading}
                onClick={goToReview}
              >
                {classFilesLoading ? 'Loading…' : `Next → (${selectedNames.size} selected)`}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: Review list + shared settings ── */}
        {step === 2 && (
          <div style={styles.form}>
            {/* Review table */}
            <div style={styles.field}>
              <label style={styles.label}>Datasets to Create ({selectedNames.size})</label>
              <div style={{ border: '1px solid #25344d', borderRadius: '8px', overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: dupConfigMode === 'individual' ? '24px 1fr 1fr' : '1fr 1fr', gap: 0,
                  background: '#1b2940', borderBottom: '1px solid #25344d', padding: '6px 12px' }}>
                  {dupConfigMode === 'individual' && <span />}
                  <span style={{ fontSize: '11px', color: '#5a6a8a', fontWeight: 600, textTransform: 'uppercase' }}>Name</span>
                  <span style={{ fontSize: '11px', color: '#5a6a8a', fontWeight: 600, textTransform: 'uppercase' }}>Class File</span>
                </div>
                <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
                  {[...selectedNames].map((name) => {
                    const s = availableSubdirs.find((x) => x.name === name);
                    const isel = reviewSelected.has(name);
                    return (
                      <div key={name}>
                        <div style={{ display: 'grid',
                          gridTemplateColumns: dupConfigMode === 'individual' ? '24px 1fr 1fr' : '1fr 1fr',
                          gap: '8px', padding: '8px 12px', borderBottom: '1px solid #1b2940', alignItems: 'center',
                          background: isel ? 'rgba(228,93,37,0.06)' : 'transparent' }}>
                          {dupConfigMode === 'individual' && (
                            <input type="checkbox" checked={isel} style={styles.checkbox}
                              onChange={() => setReviewSelected((p) => { const n = new Set(p); n.has(name) ? n.delete(name) : n.add(name); return n; })} />
                          )}
                          <div>
                            <span style={{ fontSize: '13px', color: '#e6edf7', fontWeight: 600 }}>{name}</span>
                            {s?.imageCount != null && (
                              <span style={{ fontSize: '11px', color: '#5a6a8a', marginLeft: '8px' }}>{s.imageCount} imgs</span>
                            )}
                            {dupConfigMode === 'individual' && (
                              <div style={{ marginTop: '4px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                <select style={{ ...styles.select, fontSize: '11px', padding: '2px 6px' }}
                                  value={itemDupSettings[name]?.action ?? 'move'}
                                  onChange={(e) => setItemDupSettings((p) => ({ ...p, [name]: { ...p[name], action: e.target.value } }))}>
                                  <option value="move">Move dups</option>
                                  <option value="delete">Delete dups</option>
                                  <option value="skip">Skip detection</option>
                                </select>
                                <input style={{ ...styles.input, width: '60px', fontSize: '11px', padding: '2px 6px' }}
                                  type="number" min="0" max="1" step="0.05" title="IoU Threshold"
                                  value={itemDupSettings[name]?.threshold ?? 0.8}
                                  onChange={(e) => setItemDupSettings((p) => ({ ...p, [name]: { ...p[name], threshold: e.target.value } }))} />
                                <input style={{ ...styles.input, width: '50px', fontSize: '11px', padding: '2px 6px' }}
                                  type="number" min="0" step="1" title="Labels Limit (0=all)"
                                  value={itemDupSettings[name]?.labels ?? 0}
                                  onChange={(e) => setItemDupSettings((p) => ({ ...p, [name]: { ...p[name], labels: e.target.value } }))} />
                                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#9ba9c3', cursor: 'pointer' }}>
                                  <input type="checkbox" style={styles.checkbox}
                                    checked={itemDupSettings[name]?.debug ?? false}
                                    onChange={(e) => setItemDupSettings((p) => ({ ...p, [name]: { ...p[name], debug: e.target.checked } }))} />
                                  Debug
                                </label>
                              </div>
                            )}
                          </div>
                          <input
                            style={{ ...styles.input, fontSize: '12px', padding: '4px 8px' }}
                            value={itemClassFiles[name] || ''}
                            onChange={(e) => setItemClassFiles((prev) => ({ ...prev, [name]: e.target.value }))}
                            placeholder="auto / none"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Bulk-edit panel for individual mode when rows selected */}
            {dupConfigMode === 'individual' && reviewSelected.size > 0 && (
              <div style={{ background: 'rgba(228,93,37,0.06)', border: '1px solid rgba(228,93,37,0.2)', borderRadius: '8px', padding: '12px 14px', marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontSize: '12px', color: '#e45d25', fontWeight: 700 }}>
                    Bulk Edit — {reviewSelected.size} selected
                  </span>
                  <button type="button" style={{ ...styles.cancelBtn, fontSize: '11px', padding: '2px 10px' }}
                    onClick={() => setReviewSelected(new Set())}>Clear</button>
                </div>
                <div style={styles.dupGrid}>
                  <div style={styles.dupField}>
                    <label style={styles.dupLabel}>Action</label>
                    <select style={styles.select} value={bulkDup.action} onChange={(e) => setBulkDup((p) => ({ ...p, action: e.target.value }))}>
                      <option value="move">Move to duplicate/</option>
                      <option value="delete">Delete</option>
                      <option value="skip">Skip (no detection)</option>
                    </select>
                  </div>
                  <div style={styles.dupField}>
                    <label style={styles.dupLabel}>IoU Threshold</label>
                    <input style={styles.input} type="number" min="0" max="1" step="0.05"
                      value={bulkDup.threshold} onChange={(e) => setBulkDup((p) => ({ ...p, threshold: e.target.value }))} />
                  </div>
                  <div style={styles.dupField}>
                    <label style={styles.dupLabel}>Labels Limit <small style={styles.dupMeta}>(0=all)</small></label>
                    <input style={styles.input} type="number" min="0" step="1"
                      value={bulkDup.labels} onChange={(e) => setBulkDup((p) => ({ ...p, labels: e.target.value }))} />
                  </div>
                  <div style={styles.dupField}>
                    <label style={styles.checkboxRow}>
                      <input type="checkbox" style={styles.checkbox} checked={bulkDup.debug} onChange={(e) => setBulkDup((p) => ({ ...p, debug: e.target.checked }))} />
                      <span style={styles.dupLabel}>Debug</span>
                    </label>
                  </div>
                </div>
                <button type="button"
                  style={{ ...styles.submitBtn, marginTop: '10px', background: '#e45d25', padding: '7px 16px', fontSize: '12px' }}
                  onClick={() => {
                    setItemDupSettings((prev) => {
                      const next = { ...prev };
                      for (const name of reviewSelected) next[name] = { ...bulkDup };
                      return next;
                    });
                    setReviewSelected(new Set());
                  }}>
                  Apply to {reviewSelected.size} Selected
                </button>
              </div>
            )}

            <div style={styles.sectionDivider} />

            {/* OBB format */}
            <div style={styles.field}>
              <label style={styles.checkboxRow}>
                <input type="checkbox" checked={obbFormat} onChange={(e) => setObbFormat(e.target.checked)} style={styles.checkbox} />
                <span style={styles.checkboxLabel}>OBB Format (Polygon)</span>
              </label>
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

            {/* Assign To */}
            <div style={styles.field}>
              <label style={styles.label}>Assign To <small style={{ color: '#5a6a8a', fontWeight: 400 }}>(optional — assigns all jobs to this user)</small></label>
              <select style={styles.select} value={assignToUserId} onChange={(e) => setAssignToUserId(e.target.value)}>
                <option value="">— Do not assign —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.username}{u.displayName ? ` (${u.displayName})` : ''}</option>
                ))}
              </select>
            </div>

            <div style={styles.sectionDivider} />

            {/* Dup detection mode toggle + settings */}
            <div style={styles.field}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <span style={styles.label}>Duplicate Detection</span>
                <div style={{ display: 'flex', border: '1px solid #25344d', borderRadius: '6px', overflow: 'hidden', marginLeft: 'auto' }}>
                  {['shared', 'individual'].map((mode) => (
                    <button key={mode} type="button"
                      style={{ padding: '4px 14px', fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer',
                        background: dupConfigMode === mode ? '#e45d25' : 'transparent',
                        color: dupConfigMode === mode ? '#fff' : '#9ba9c3' }}
                      onClick={() => {
                        setDupConfigMode(mode);
                        if (mode === 'individual') {
                          // Sync individual from current shared values
                          const dups = {};
                          for (const name of selectedNames) {
                            dups[name] = { action: dupAction, labels: dupLabels, threshold: dupThreshold, debug: dupDebug };
                          }
                          setItemDupSettings(dups);
                        }
                        setReviewSelected(new Set());
                      }}>
                      {mode === 'shared' ? 'Apply to All' : 'Per Dataset'}
                    </button>
                  ))}
                </div>
              </div>
              {dupConfigMode === 'shared' && (
                <div style={styles.dupGrid}>
                  <div style={styles.dupField}>
                    <label style={styles.dupLabel}>Action</label>
                    <select style={styles.select} value={dupAction} onChange={(e) => setDupAction(e.target.value)}>
                      <option value="move">Move to duplicate/</option>
                      <option value="delete">Delete</option>
                      <option value="skip">Skip (no detection)</option>
                    </select>
                  </div>
                  <div style={styles.dupField}>
                    <label style={styles.dupLabel}>IoU Threshold</label>
                    <input style={styles.input} type="number" min="0" max="1" step="0.05"
                      value={dupThreshold} onChange={(e) => setDupThreshold(e.target.value)} />
                  </div>
                  <div style={styles.dupField}>
                    <label style={styles.dupLabel}>Labels Limit <small style={styles.dupMeta}>(0 = all)</small></label>
                    <input style={styles.input} type="number" min="0" step="1"
                      value={dupLabels} onChange={(e) => setDupLabels(e.target.value)} />
                  </div>
                  <div style={styles.dupField}>
                    <label style={styles.checkboxRow}>
                      <input type="checkbox" style={styles.checkbox} checked={dupDebug} onChange={(e) => setDupDebug(e.target.checked)} />
                      <span style={styles.dupLabel}>Debug mode</span>
                    </label>
                  </div>
                </div>
              )}
              {dupConfigMode === 'individual' && (
                <p style={{ fontSize: '12px', color: '#5a6a8a', margin: 0 }}>
                  Edit each dataset's settings in the table above. Select multiple rows to bulk-edit.
                </p>
              )}
            </div>

            {/* Results after partial failure */}
            {createResults && (
              <div style={{ marginBottom: '12px' }}>
                {createResults.succeeded.length > 0 && (
                  <p style={{ color: '#20c25a', fontSize: '13px', margin: '0 0 6px' }}>
                    ✓ {createResults.succeeded.length} dataset{createResults.succeeded.length !== 1 ? 's' : ''} created successfully.
                  </p>
                )}
                {createResults.failed.map((f) => (
                  <p key={f.name} style={{ color: '#f87171', fontSize: '13px', margin: '0 0 4px' }}>
                    ✗ {f.name}: {f.error}
                  </p>
                ))}
              </div>
            )}

            {error && <p style={styles.errorMsg}>{error}</p>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
              {!createResults && (
                <button style={styles.cancelBtn} type="button" onClick={() => setStep(1)}>← Back</button>
              )}
              {createResults ? (
                <button style={styles.submitBtn} type="button" onClick={onClose}>Close</button>
              ) : (
                <button style={{ ...styles.submitBtn, opacity: loading ? 0.6 : 1 }} type="button"
                  disabled={loading} onClick={handleCreate}>
                  {loading ? 'Creating…' : `Create ${selectedNames.size} Dataset${selectedNames.size !== 1 ? 's' : ''}`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BulkMoveModal({ datasets, onClose, onDone }) {
  const [force, setForce] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null); // null = not submitted yet

  const hasIncomplete = datasets.some(
    (d) => (d.totalJobs ?? 0) > 0 && (d.labelledJobs ?? 0) !== (d.totalJobs ?? 0)
  );

  async function handleConfirm() {
    setLoading(true);
    try {
      const res = await fetch('/api/datasets/bulk-move-to-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: datasets.map((d) => d.id), force }),
      });
      const data = await res.json();
      setResults(data.results || []);
    } catch {
      setResults(datasets.map((d) => ({ id: d.id, ok: false, error: 'Network error', name: d.displayName })));
    } finally {
      setLoading(false);
    }
  }

  const succeeded = results ? results.filter((r) => r.ok) : [];
  const failed = results ? results.filter((r) => !r.ok) : [];

  return (
    <div style={styles.modalOverlay} onClick={results ? undefined : onClose}>
      <div style={{ ...styles.modal, maxWidth: '520px', maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>Move to Done</h2>
          <button style={styles.closeBtn} onClick={results ? onDone : onClose}>×</button>
        </div>

        {!results ? (
          <>
            <p style={{ color: '#9ba9c3', fontSize: '13px', marginBottom: '16px' }}>
              Move {datasets.length} dataset{datasets.length !== 1 ? 's' : ''} to the check path via rsync. Source files will be deleted after verification.
            </p>

            {/* Dataset list */}
            <div style={{ border: '1px solid #25344d', borderRadius: '8px', overflow: 'hidden', marginBottom: '16px' }}>
              {datasets.map((d, i) => {
                const allDone = (d.totalJobs ?? 0) > 0 && (d.labelledJobs ?? 0) === (d.totalJobs ?? 0);
                return (
                  <div key={d.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '9px 14px', gap: '8px',
                    borderBottom: i < datasets.length - 1 ? '1px solid #1b2940' : 'none',
                    background: i % 2 === 0 ? 'transparent' : '#0d162622',
                  }}>
                    <span style={{ fontSize: '13px', color: '#e6edf7', fontWeight: 600, flex: 1, wordBreak: 'break-all' }}>
                      {d.displayName || d.datasetPath.split('/').pop()}
                    </span>
                    {!allDone && (d.totalJobs ?? 0) > 0 && (
                      <span style={{ fontSize: '11px', color: '#f1b11a', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {d.labelledJobs ?? 0}/{d.totalJobs} done
                      </span>
                    )}
                    {allDone && (
                      <span style={{ fontSize: '11px', color: '#20c25a', whiteSpace: 'nowrap', flexShrink: 0 }}>All done</span>
                    )}
                  </div>
                );
              })}
            </div>

            {hasIncomplete && (
              <div style={{ background: 'rgba(241,177,26,0.08)', border: '1px solid rgba(241,177,26,0.25)', borderRadius: '8px', padding: '12px 14px', marginBottom: '16px' }}>
                <p style={{ color: '#f1b11a', fontSize: '13px', fontWeight: 600, margin: '0 0 8px' }}>
                  Some datasets have incomplete jobs.
                </p>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={force}
                    onChange={(e) => setForce(e.target.checked)}
                    style={styles.checkbox}
                  />
                  <span style={{ fontSize: '13px', color: '#e6edf7' }}>Force move anyway</span>
                </label>
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
              <button
                style={{ ...styles.submitBtn, marginTop: 0, padding: '10px 20px', opacity: (hasIncomplete && !force) ? 0.5 : 1 }}
                disabled={loading || (hasIncomplete && !force)}
                onClick={handleConfirm}
              >
                {loading ? 'Starting…' : `Move ${datasets.length} Dataset${datasets.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ color: '#9ba9c3', fontSize: '13px', marginBottom: '16px' }}>
              Move jobs have been queued. They will run in the background.
            </p>
            {succeeded.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <p style={{ fontSize: '12px', fontWeight: 700, color: '#20c25a', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                  Queued ({succeeded.length})
                </p>
                {succeeded.map((r) => (
                  <div key={r.id} style={{ fontSize: '13px', color: '#e6edf7', padding: '4px 0' }}>
                    {r.name || `Dataset #${r.id}`}
                  </div>
                ))}
              </div>
            )}
            {failed.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <p style={{ fontSize: '12px', fontWeight: 700, color: '#d24343', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                  Failed ({failed.length})
                </p>
                {failed.map((r) => (
                  <div key={r.id} style={{ fontSize: '13px', padding: '4px 0' }}>
                    <span style={{ color: '#e6edf7' }}>{r.name || `Dataset #${r.id}`}</span>
                    <span style={{ color: '#f87171', marginLeft: '8px', fontSize: '12px' }}>{r.error}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button style={styles.confirmDoneBtn} onClick={onDone}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
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

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showBulkMove, setShowBulkMove] = useState(false);

  const isAdmin = user?.role === 'admin';
  const isDM = user?.role === 'data-manager';
  const isAdminOrDM = isAdmin || isDM;

  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
  }

  function toggleSelectId(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAll() {
    const movable = datasets.filter(
      (d) => d.typeId && !['pending', 'moving', 'verifying'].includes(d.moveStatus)
    );
    setSelectedIds(new Set(movable.map((d) => d.id)));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

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
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {selectMode && datasets.length > 0 && (
                    <button
                      style={styles.secondaryBtn}
                      onClick={selectedIds.size === 0 ? selectAll : deselectAll}
                    >
                      {selectedIds.size === 0 ? 'Select All' : 'Deselect All'}
                    </button>
                  )}
                  <button
                    style={{ ...styles.secondaryBtn, ...(selectMode ? { borderColor: '#e45d25', color: '#e45d25' } : {}) }}
                    onClick={toggleSelectMode}
                  >
                    {selectMode ? 'Cancel' : 'Select'}
                  </button>
                  <button style={styles.addBtn} onClick={() => setShowAdd(true)}>+ Add Dataset</button>
                </div>
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
                    const isSelected = selectedIds.has(d.id);
                    const isMoving = ['pending', 'moving', 'verifying'].includes(d.moveStatus);
                    const selectable = selectMode && d.typeId && !isMoving;
                    return (
                      <div
                        key={d.id}
                        style={{
                          ...styles.card,
                          ...(scanning ? styles.cardScanning : {}),
                          ...(isSelected ? styles.cardSelected : {}),
                          ...(selectMode && !selectable ? { opacity: 0.45 } : {}),
                        }}
                        onClick={() => {
                          if (selectMode) {
                            if (selectable) toggleSelectId(d.id);
                          } else {
                            router.push(`/datasets/${d.id}`);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            if (selectMode) { if (selectable) toggleSelectId(d.id); }
                            else router.push(`/datasets/${d.id}`);
                          }
                        }}
                      >
                        <div style={styles.cardHeader}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                            {selectMode && (
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={!selectable}
                                onChange={() => { if (selectable) toggleSelectId(d.id); }}
                                onClick={(e) => e.stopPropagation()}
                                style={styles.checkbox}
                              />
                            )}
                            <span style={styles.cardName}>{d.displayName || d.datasetPath.split('/').pop()}</span>
                          </div>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
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
                        {!selectMode && (
                          <div style={styles.cardActions}>
                            <button
                              type="button"
                              style={styles.secondaryBtn}
                              onClick={(e) => { e.stopPropagation(); openDatasetViewer(d.id); }}
                            >
                              Open Viewer
                            </button>
                          </div>
                        )}
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

              {/* Floating action bar when items are selected */}
              {selectMode && selectedIds.size > 0 && (
                <div style={styles.bulkBar}>
                  <span style={{ color: '#e6edf7', fontSize: '14px', fontWeight: 600 }}>
                    {selectedIds.size} dataset{selectedIds.size !== 1 ? 's' : ''} selected
                  </span>
                  <button
                    style={styles.bulkMoveBtn}
                    onClick={() => setShowBulkMove(true)}
                  >
                    Move to Done
                  </button>
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

        {showBulkMove && (
          <BulkMoveModal
            datasets={datasets.filter((d) => selectedIds.has(d.id))}
            onClose={() => setShowBulkMove(false)}
            onDone={() => {
              setShowBulkMove(false);
              setSelectMode(false);
              setSelectedIds(new Set());
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
  const [editedImagesModal, setEditedImagesModal] = useState(null);

  function openInNewTab(path) {
    if (typeof window === 'undefined') return;
    window.open(path, '_blank', 'noopener,noreferrer');
  }

  function openEditedSubset(job, imageNames) {
    const names = (imageNames || []).filter(Boolean);
    if (names.length === 0) return;
    const params = new URLSearchParams({ jobId: String(job.id), edited: '1' });
    params.set('start', names[0]);
    openInNewTab(`/viewer?${params.toString()}`);
  }

  async function showEditedImages(job) {
    setEditedImagesModal({ job, images: [], loading: true, error: '' });
    try {
      const res = await fetch(`/api/datasets/${job.datasetId}/jobs/${job.id}/edited-images`);
      const data = await res.json();
      if (!res.ok) {
        setEditedImagesModal({ job, images: [], loading: false, error: data.error || 'Failed to load edited images' });
        return;
      }
      setEditedImagesModal({ job, images: Array.isArray(data.images) ? data.images : [], loading: false, error: '' });
    } catch {
      setEditedImagesModal({ job, images: [], loading: false, error: 'Network error' });
    }
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
                <span style={styles.jobCardRange}>
                  Images {j.imageStart}–{j.imageEnd}
                  <span style={styles.jobCardCount}> ({j.currentImageCount ?? (j.imageEnd - j.imageStart + 1)} imgs)</span>
                </span>
                {(j.editedFiles > 0 || j.deletedImages > 0) && (
                  <span style={styles.jobCardStats}>
                    {j.editedFiles > 0 && (
                      <button type="button" style={styles.jobStatButton} onClick={() => showEditedImages(j)}>
                        <span style={styles.jobStatEdited}>Edited: {j.editedFiles}</span>
                      </button>
                    )}
                    {j.deletedImages > 0 && <span style={styles.jobStatDeleted}>Deleted: {j.deletedImages}</span>}
                  </span>
                )}
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
      {editedImagesModal && (
        <EditedImagesModal
          job={editedImagesModal.job}
          images={editedImagesModal.images}
          loading={editedImagesModal.loading}
          error={editedImagesModal.error}
          openOneLabel="Open Viewer"
          openAllLabel="Open All in Viewer"
          onOpenOne={(imageName) => openEditedSubset(editedImagesModal.job, [imageName])}
          onOpenAll={() => openEditedSubset(editedImagesModal.job, editedImagesModal.images.map((item) => item.imageName))}
          onClose={() => setEditedImagesModal(null)}
        />
      )}
    </>
  );
}

function UserDashboard({ user }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [markDoneConfirm, setMarkDoneConfirm] = useState(null); // jobId
  const [editedImagesModal, setEditedImagesModal] = useState(null);

  function openInNewTab(path) {
    if (typeof window === 'undefined') return;
    window.open(path, '_blank', 'noopener,noreferrer');
  }

  function openEditedSubset(job, imageNames) {
    const names = (imageNames || []).filter(Boolean);
    if (names.length === 0) return;
    const params = new URLSearchParams({ jobId: String(job.id), edited: '1' });
    params.set('start', names[0]);
    openInNewTab(`/viewer?${params.toString()}`);
  }

  async function showEditedImages(job) {
    setEditedImagesModal({ job, images: [], loading: true, error: '' });
    try {
      const res = await fetch(`/api/datasets/${job.datasetId}/jobs/${job.id}/edited-images`);
      const data = await res.json();
      if (!res.ok) {
        setEditedImagesModal({ job, images: [], loading: false, error: data.error || 'Failed to load edited images' });
        return;
      }
      setEditedImagesModal({ job, images: Array.isArray(data.images) ? data.images : [], loading: false, error: '' });
    } catch {
      setEditedImagesModal({ job, images: [], loading: false, error: 'Network error' });
    }
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
                  <span style={styles.jobCardRange}>
                    Images {j.imageStart}–{j.imageEnd}
                    <span style={styles.jobCardCount}> ({j.currentImageCount ?? (j.imageEnd - j.imageStart + 1)} imgs)</span>
                  </span>
                  {(j.editedFiles > 0 || j.deletedImages > 0) && (
                    <span style={styles.jobCardStats}>
                      {j.editedFiles > 0 && (
                        <button type="button" style={styles.jobStatButton} onClick={() => showEditedImages(j)}>
                          <span style={styles.jobStatEdited}>Edited: {j.editedFiles}</span>
                        </button>
                      )}
                      {j.deletedImages > 0 && <span style={styles.jobStatDeleted}>Deleted: {j.deletedImages}</span>}
                    </span>
                  )}
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
      {editedImagesModal && (
        <EditedImagesModal
          job={editedImagesModal.job}
          images={editedImagesModal.images}
          loading={editedImagesModal.loading}
          error={editedImagesModal.error}
          openOneLabel="Open Viewer"
          openAllLabel="Open All in Viewer"
          onOpenOne={(imageName) => openEditedSubset(editedImagesModal.job, [imageName])}
          onOpenAll={() => openEditedSubset(editedImagesModal.job, editedImagesModal.images.map((item) => item.imageName))}
          onClose={() => setEditedImagesModal(null)}
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
  jobCardCount: {
    color: '#3a4f70',
  },
  jobCardStats: {
    display: 'flex', gap: '10px', marginTop: '2px',
  },
  jobStatButton: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    font: 'inherit',
  },
  jobStatEdited: {
    fontSize: '11px', fontWeight: 700, color: '#f1b11a',
  },
  jobStatDeleted: {
    fontSize: '11px', fontWeight: 700, color: '#d24343',
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
  modalMuted: {
    color: '#9ba9c3',
    marginBottom: '18px',
    fontSize: '14px',
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
  editedList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '50vh',
    overflowY: 'auto',
    marginBottom: '18px',
  },
  editedRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '10px 12px',
    background: '#152033',
    border: '1px solid #25344d',
    borderRadius: '8px',
  },
  editedInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: 0,
  },
  editedName: {
    color: '#e6edf7',
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: 'monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  editedMeta: {
    color: '#9ba9c3',
    fontSize: '11px',
  },
  editedFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
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
  cardSelected: {
    borderColor: '#e45d25',
    boxShadow: '0 0 0 2px rgba(228,93,37,0.25)',
  },
  bulkBar: {
    position: 'fixed',
    bottom: '28px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#152033',
    border: '1px solid #25344d',
    borderRadius: '12px',
    padding: '14px 24px',
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    zIndex: 500,
  },
  bulkMoveBtn: {
    background: '#20c25a',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 700,
    padding: '9px 20px',
  },
};
