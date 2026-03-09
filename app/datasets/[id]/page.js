'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AppHeader from '../../_components/AppHeader';
import { useCurrentUser } from '../../_components/useCurrentUser';

const STATUS_COLOR = {
  unassigned: '#9ba9c3',
  unlabelled: '#f1b11a',
  labeling: '#2f7ff5',
  labelled: '#20c25a',
};
const STATUS_LABEL = {
  unassigned: 'Unassigned',
  unlabelled: 'Unlabelled',
  labeling: 'In Progress',
  labelled: 'Done',
};

function ReassignModal({ job, users, onClose, onDone }) {
  const [userId, setUserId] = useState('');
  const [keepData, setKeepData] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!userId) { setError('Select a user'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/datasets/${job.datasetId}/jobs/${job.id}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: Number(userId), keepData }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed'); return; }
      onDone(data.job);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>Reassign Job #{job.jobIndex}</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Assign To</label>
            <select style={styles.select} value={userId} onChange={(e) => setUserId(e.target.value)} required>
              <option value="">Select user…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.username} ({u.role})</option>
              ))}
            </select>
          </div>
          <label style={styles.checkboxLabel}>
            <input type="checkbox" checked={keepData} onChange={(e) => setKeepData(e.target.checked)} />
            <span>Keep labeling progress</span>
          </label>
          {error && <p style={styles.errorMsg}>{error}</p>}
          <button type="submit" style={styles.submitBtn} disabled={loading}>
            {loading ? 'Reassigning…' : 'Reassign'}
          </button>
        </form>
      </div>
    </div>
  );
}

function AssignModal({ job, users, onClose, onDone }) {
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!userId) { setError('Select a user'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/datasets/${job.datasetId}/jobs/${job.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: Number(userId) }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed'); return; }
      onDone(data.job);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>Assign Job #{job.jobIndex}</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Assign To</label>
            <select style={styles.select} value={userId} onChange={(e) => setUserId(e.target.value)} required>
              <option value="">Select user…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.username} ({u.role})</option>
              ))}
            </select>
          </div>
          {error && <p style={styles.errorMsg}>{error}</p>}
          <button type="submit" style={styles.submitBtn} disabled={loading}>
            {loading ? 'Assigning…' : 'Assign'}
          </button>
        </form>
      </div>
    </div>
  );
}

function BulkAssignModal({ count, users, datasetId, selectedIds, onClose, onDone }) {
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!userId) { setError('Select a user'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/datasets/${datasetId}/jobs/bulk-assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds: [...selectedIds], userId: Number(userId) }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed'); return; }
      onDone(data.assigned, data.errors);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>Assign {count} Job{count !== 1 ? 's' : ''}</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Assign To</label>
            <select style={styles.select} value={userId} onChange={(e) => setUserId(e.target.value)} required>
              <option value="">Select user…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.username} ({u.role})</option>
              ))}
            </select>
          </div>
          {error && <p style={styles.errorMsg}>{error}</p>}
          <button type="submit" style={styles.submitBtn} disabled={loading}>
            {loading ? 'Assigning…' : `Assign ${count} Job${count !== 1 ? 's' : ''}`}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function DatasetDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useCurrentUser();
  const [dataset, setDataset] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(null);
  const [assignModal, setAssignModal] = useState(null);
  const [reassignModal, setReassignModal] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkAssignModal, setBulkAssignModal] = useState(false);

  const isAdmin = user?.role === 'admin';
  const isDM = user?.role === 'data-manager';
  const isAdminOrDM = isAdmin || isDM;

  const loadData = useCallback(async () => {
    try {
      const [dsRes, jobsRes] = await Promise.all([
        fetch(`/api/datasets/${id}`),
        fetch(`/api/datasets/${id}/jobs`),
      ]);
      const [dsData, jobsData] = await Promise.all([dsRes.json(), jobsRes.json()]);
      if (!dsRes.ok) { setError(dsData.error || 'Not found'); return; }
      setDataset(dsData.dataset);
      setJobs(jobsData.jobs || []);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      if (res.ok) setUsers((data.users || []).filter((u) => u.isActive && u.role === 'user'));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!authLoading) { loadData(); if (isAdminOrDM) loadUsers(); }
  }, [authLoading, isAdminOrDM, loadData, loadUsers]);

  function updateJob(updated) {
    setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
  }

  const unassignedJobs = jobs.filter((j) => j.status === 'unassigned');
  const allUnassignedSelected = unassignedJobs.length > 0 && unassignedJobs.every((j) => selectedIds.has(j.id));

  function toggleSelect(jobId) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(jobId) ? next.delete(jobId) : next.add(jobId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allUnassignedSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(unassignedJobs.map((j) => j.id)));
    }
  }

  async function jobAction(jobId, action, body = {}) {
    setActionLoading(jobId);
    try {
      const res = await fetch(`/api/datasets/${id}/jobs/${jobId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'Action failed'); return; }
      updateJob(data.job);
    } catch {
      alert('Network error');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete() {
    try {
      const res = await fetch(`/api/datasets/${id}`, { method: 'DELETE' });
      if (res.ok) router.push('/');
      else { const d = await res.json(); alert(d.error || 'Delete failed'); }
    } catch {
      alert('Network error');
    }
  }

  if (authLoading || loading) {
    return (
      <div style={styles.page}>
        <AppHeader backHref="/" backLabel="Datasets" />
        <div style={styles.loading}>Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.page}>
        <AppHeader backHref="/" backLabel="Datasets" />
        <div style={styles.main}>
          <p style={styles.errorMsg}>{error}</p>
        </div>
      </div>
    );
  }

  const labelled = jobs.filter((j) => j.status === 'labelled').length;
  const total = jobs.length;
  const pct = total > 0 ? Math.round((labelled / total) * 100) : 0;

  return (
    <div style={styles.page}>
      <AppHeader backHref="/" backLabel="Datasets" />
      <main style={styles.main}>
        {/* Dataset Header */}
        <div style={styles.dsHeader}>
          <div>
            <h1 style={styles.h1}>{dataset.displayName || dataset.datasetPath.split('/').pop()}</h1>
            <p style={styles.dsPath}>{dataset.datasetPath}</p>
            <p style={styles.dsMeta}>
              {dataset.totalImages} images · {total} jobs · Job size: {dataset.jobSize}
            </p>
          </div>
          <div style={styles.dsActions}>
            {isAdmin && (
              <button
                style={styles.dangerBtn}
                onClick={() => setDeleteConfirm(true)}
              >
                Delete Dataset
              </button>
            )}
          </div>
        </div>

        {/* Progress Summary */}
        {isAdminOrDM && total > 0 && (
          <div style={styles.progressCard}>
            <div style={styles.progressRow}>
              <div style={styles.progressBarLarge}>
                {['labelled', 'labeling', 'unlabelled', 'unassigned'].map((s) => {
                  const cnt = jobs.filter((j) => j.status === s).length;
                  const w = (cnt / total) * 100;
                  return w > 0 ? (
                    <div key={s} style={{ ...styles.progressSegment, width: `${w}%`, background: STATUS_COLOR[s] }}
                      title={`${STATUS_LABEL[s]}: ${cnt}`} />
                  ) : null;
                })}
              </div>
              <span style={styles.progressPct}>{pct}%</span>
            </div>
            <div style={styles.progressLegend}>
              {Object.entries(STATUS_LABEL).map(([s, label]) => {
                const cnt = jobs.filter((j) => j.status === s).length;
                return (
                  <span key={s} style={{ ...styles.legendItem, color: STATUS_COLOR[s] }}>
                    {label}: {cnt}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Jobs Table */}
        <div style={styles.jobsHeader}>
          <h2 style={styles.h2}>Jobs</h2>
          {isAdminOrDM && selectedIds.size > 0 && (
            <div style={styles.bulkBar}>
              <span style={styles.bulkCount}>{selectedIds.size} selected</span>
              <button style={styles.bulkBtn} onClick={() => setBulkAssignModal(true)}>
                Assign Selected
              </button>
              <button style={styles.bulkClearBtn} onClick={() => setSelectedIds(new Set())}>
                Clear
              </button>
            </div>
          )}
        </div>
        <div style={styles.table}>
          {(() => {
            const cols = isAdminOrDM ? '36px 60px 160px 130px 1fr 1fr' : '60px 160px 130px 1fr';
            const gridStyle = { gridTemplateColumns: cols };
            return (
              <>
                <div style={{ ...styles.tableHead, ...gridStyle }}>
                  {isAdminOrDM && (
                    <span style={styles.thCheck}>
                      {unassignedJobs.length > 0 && (
                        <input
                          type="checkbox"
                          checked={allUnassignedSelected}
                          onChange={toggleSelectAll}
                          style={styles.checkbox}
                          title="Select all unassigned"
                        />
                      )}
                    </span>
                  )}
                  <span style={styles.thJob}>Job</span>
                  <span style={styles.thRange}>Image Range</span>
                  <span style={styles.thStatus}>Status</span>
                  {isAdminOrDM && <span style={styles.thAssigned}>Assigned To</span>}
                  <span style={styles.thActions}>Actions</span>
                </div>
                {jobs.map((job) => {
                  const busy = actionLoading === job.id;
                  const isMyJob = String(job.assignedTo) === String(user?.id);
                  return (
                    <div key={job.id} style={{ ...styles.tableRow, ...gridStyle }}>
                      {isAdminOrDM && (
                        <span style={styles.tdCheck}>
                          {job.status === 'unassigned' && (
                            <input
                              type="checkbox"
                              checked={selectedIds.has(job.id)}
                              onChange={() => toggleSelect(job.id)}
                              style={styles.checkbox}
                            />
                          )}
                        </span>
                      )}
                      <span style={styles.tdJob}>#{job.jobIndex}</span>
                      <span style={styles.tdRange}>
                        {job.imageStart}–{job.imageEnd}
                        <small style={styles.tdRangeSub}> ({job.imageEnd - job.imageStart + 1} imgs)</small>
                      </span>
                      <span style={styles.tdStatus}>
                        <span style={{ ...styles.statusBadge, background: STATUS_COLOR[job.status] + '22', color: STATUS_COLOR[job.status] }}>
                          {STATUS_LABEL[job.status]}
                        </span>
                      </span>
                      {isAdminOrDM && (
                        <span style={styles.tdAssigned}>
                          {job.assignedToUsername || <em style={{ color: '#5a6a8a' }}>—</em>}
                        </span>
                      )}
                      <span style={styles.tdActions}>
                        {/* Admin/DM actions */}
                        {isAdminOrDM && job.status === 'unassigned' && (
                          <button style={styles.actionBtn} disabled={busy}
                            onClick={() => setAssignModal(job)}>Assign</button>
                        )}
                        {isAdminOrDM && job.status !== 'unassigned' && (
                          <button style={styles.actionBtn} disabled={busy}
                            onClick={() => setReassignModal(job)}>Reassign</button>
                        )}
                        {isAdminOrDM && job.status !== 'unassigned' && (
                          <button style={{ ...styles.actionBtn, ...styles.actionBtnDanger }} disabled={busy}
                            onClick={() => jobAction(job.id, 'unassign')}>Unassign</button>
                        )}
                        {isAdminOrDM && (job.status === 'unlabelled' || job.status === 'labeling') && (
                          <button style={{ ...styles.actionBtn, ...styles.actionBtnDanger }} disabled={busy}
                            onClick={() => jobAction(job.id, 'reset', { keepData: true })}>Reset</button>
                        )}
                        {isAdminOrDM && job.status === 'labelled' && (
                          <button style={{ ...styles.actionBtn, ...styles.actionBtnDanger }} disabled={busy}
                            onClick={() => jobAction(job.id, 'reset', { keepData: false })}>Reopen</button>
                        )}
                        {/* User actions */}
                        {!isAdminOrDM && job.status === 'unassigned' && (
                          <button style={styles.actionBtn} disabled={busy}
                            onClick={() => jobAction(job.id, 'assign')}>Self-Assign</button>
                        )}
                        {!isAdminOrDM && isMyJob && job.status === 'unlabelled' && (
                          <button style={styles.openBtn} disabled={busy}
                            onClick={() => router.push(`/label-editor?jobId=${job.id}`)}>Start Labeling</button>
                        )}
                        {!isAdminOrDM && isMyJob && job.status === 'labeling' && (
                          <button style={styles.openBtn} disabled={busy}
                            onClick={() => router.push(`/label-editor?jobId=${job.id}`)}>Continue</button>
                        )}
                        {!isAdminOrDM && isMyJob && job.status !== 'labelled' && (
                          <button style={{ ...styles.actionBtn, ...styles.actionBtnDanger }} disabled={busy}
                            onClick={() => jobAction(job.id, 'unassign')}>Unassign</button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </>
            );
          })()}
        </div>
      </main>

      {assignModal && (
        <AssignModal
          job={assignModal}
          users={users}
          onClose={() => setAssignModal(null)}
          onDone={(updated) => { updateJob(updated); setAssignModal(null); }}
        />
      )}
      {reassignModal && (
        <ReassignModal
          job={reassignModal}
          users={users}
          onClose={() => setReassignModal(null)}
          onDone={(updated) => { updateJob(updated); setReassignModal(null); }}
        />
      )}
      {bulkAssignModal && (
        <BulkAssignModal
          count={selectedIds.size}
          users={users}
          datasetId={id}
          selectedIds={selectedIds}
          onClose={() => setBulkAssignModal(false)}
          onDone={(assigned, errors) => {
            assigned.forEach(updateJob);
            setSelectedIds(new Set());
            setBulkAssignModal(false);
            if (errors?.length) alert(`${errors.length} job(s) failed to assign.`);
          }}
        />
      )}
      {deleteConfirm && (
        <div style={styles.modalOverlay} onClick={() => setDeleteConfirm(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Delete Dataset?</h3>
              <button style={styles.closeBtn} onClick={() => setDeleteConfirm(false)}>×</button>
            </div>
            <p style={{ color: '#9ba9c3', marginBottom: '20px', fontSize: '14px' }}>
              This will remove the dataset and all job records from the database. Image files on disk are NOT deleted.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button style={styles.cancelBtn} onClick={() => setDeleteConfirm(false)}>Cancel</button>
              <button style={{ ...styles.submitBtn, background: '#d24343' }} onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
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
  loading: { padding: '60px', textAlign: 'center', color: '#9ba9c3' },
  main: { maxWidth: '1200px', width: '100%', margin: '0 auto', padding: '32px 24px 60px' },
  dsHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: '24px', gap: '16px',
  },
  h1: { fontSize: '24px', fontWeight: 800, color: '#e6edf7', margin: 0 },
  h2: { fontSize: '16px', fontWeight: 700, color: '#9ba9c3', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' },
  jobsHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginTop: '28px', marginBottom: '12px' },
  bulkBar: { display: 'flex', alignItems: 'center', gap: '10px' },
  bulkCount: { fontSize: '13px', color: '#e45d25', fontWeight: 600 },
  bulkBtn: { background: '#e45d25', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 700, padding: '6px 14px' },
  bulkClearBtn: { background: 'transparent', border: '1px solid #25344d', borderRadius: '6px', color: '#9ba9c3', cursor: 'pointer', fontSize: '12px', padding: '6px 10px' },
  checkbox: { width: '15px', height: '15px', accentColor: '#e45d25', cursor: 'pointer' },
  thCheck: { display: 'flex', alignItems: 'center' },
  tdCheck: { display: 'flex', alignItems: 'center' },
  dsPath: { fontSize: '12px', color: '#5a6a8a', fontFamily: 'monospace', marginTop: '4px' },
  dsMeta: { fontSize: '13px', color: '#9ba9c3', marginTop: '6px' },
  dsActions: { display: 'flex', gap: '10px', flexShrink: 0 },
  progressCard: {
    background: '#152033', border: '1px solid #25344d', borderRadius: '10px',
    padding: '16px 20px', marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '10px',
  },
  progressRow: { display: 'flex', alignItems: 'center', gap: '12px' },
  progressBarLarge: {
    flex: 1, height: '10px', borderRadius: '5px', background: '#1b2940',
    display: 'flex', overflow: 'hidden', gap: '1px',
  },
  progressSegment: { height: '100%' },
  progressPct: { fontSize: '14px', fontWeight: 700, color: '#e6edf7', minWidth: '36px', textAlign: 'right' },
  progressLegend: { display: 'flex', flexWrap: 'wrap', gap: '12px' },
  legendItem: { fontSize: '12px' },
  table: { background: '#152033', border: '1px solid #25344d', borderRadius: '10px', overflow: 'hidden' },
  tableHead: {
    display: 'grid',
    gridTemplateColumns: '60px 160px 130px 1fr 1fr',
    padding: '10px 16px',
    background: '#1b2940',
    borderBottom: '1px solid #25344d',
    fontSize: '11px', fontWeight: 700, color: '#9ba9c3', textTransform: 'uppercase', letterSpacing: '0.5px',
  },
  tableHeadNoAssigned: {
    gridTemplateColumns: '60px 160px 130px 1fr',
  },
  tableRow: {
    display: 'grid',
    gridTemplateColumns: '60px 160px 130px 1fr 1fr',
    padding: '12px 16px',
    borderBottom: '1px solid #1b2940',
    alignItems: 'center',
    fontSize: '13px',
  },
  thJob: {}, thRange: {}, thStatus: {}, thAssigned: {}, thActions: {},
  tdJob: { fontWeight: 700, color: '#e6edf7' },
  tdRange: { color: '#9ba9c3', fontFamily: 'monospace', fontSize: '12px' },
  tdRangeSub: { color: '#5a6a8a' },
  tdStatus: {},
  tdAssigned: { color: '#e6edf7', fontSize: '13px' },
  tdActions: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' },
  statusBadge: { fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '20px' },
  actionBtn: {
    background: 'transparent', border: '1px solid #25344d', borderRadius: '5px',
    color: '#9ba9c3', cursor: 'pointer', fontSize: '11px', fontWeight: 600,
    padding: '4px 10px', whiteSpace: 'nowrap',
  },
  actionBtnDanger: { borderColor: '#d24343', color: '#d24343' },
  openBtn: {
    background: '#e45d25', border: 'none', borderRadius: '5px',
    color: '#fff', cursor: 'pointer', fontSize: '11px', fontWeight: 700,
    padding: '4px 10px', whiteSpace: 'nowrap',
  },
  dangerBtn: {
    background: 'transparent', border: '1px solid #d24343', borderRadius: '7px',
    color: '#d24343', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
    padding: '8px 16px',
  },
  errorMsg: {
    color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)',
    borderRadius: '6px', padding: '10px 14px', fontSize: '13px', marginBottom: '16px',
  },
  // Modal
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#152033', border: '1px solid #25344d', borderRadius: '14px', padding: '28px', width: '100%', maxWidth: '400px', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  modalTitle: { fontSize: '16px', fontWeight: 800, color: '#e6edf7', margin: 0 },
  closeBtn: { background: 'transparent', border: 'none', color: '#9ba9c3', cursor: 'pointer', fontSize: '22px', lineHeight: 1, padding: '0 4px' },
  form: { display: 'flex', flexDirection: 'column', gap: '14px' },
  field: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: { color: '#9ba9c3', fontSize: '12px', fontWeight: 600 },
  select: { background: '#0d1626', border: '1px solid #25344d', borderRadius: '7px', color: '#e6edf7', fontSize: '13px', padding: '9px 11px', outline: 'none', width: '100%' },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: '8px', color: '#9ba9c3', fontSize: '13px', cursor: 'pointer' },
  submitBtn: { background: '#e45d25', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 700, padding: '11px', marginTop: '4px' },
  cancelBtn: { background: 'transparent', border: '1px solid #25344d', borderRadius: '8px', color: '#9ba9c3', cursor: 'pointer', fontSize: '13px', padding: '11px 20px' },
};
