'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '../_components/AppHeader';
import { useCurrentUser } from '../_components/useCurrentUser';

// ── helpers ─────────────────────────────────────────────────────────────────

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

// ── sub-components ──────────────────────────────────────────────────────────

function StatPill({ label, value, color }) {
  return (
    <span style={{ ...styles.pill, background: color || '#1e2a3a' }}>
      <span style={styles.pillLabel}>{label}</span>
      <span style={styles.pillValue}>{value}</span>
    </span>
  );
}

function JobRow({ job, expanded, onToggle }) {
  return (
    <>
      <tr style={styles.jobRow} onClick={onToggle}>
        <td style={styles.td}>
          <span style={styles.expandIcon}>{expanded ? '▾' : '▸'}</span>
          Job #{job.jobIndex}
        </td>
        <td style={styles.td}>
          {job.assignedToUsername
            ? <span style={styles.username}>{job.assignedToUsername}</span>
            : <span style={styles.dim}>—</span>}
        </td>
        <td style={styles.td}>{job.editedFiles}</td>
        <td style={styles.td}>{job.deletedImages}</td>
        <td style={styles.td}>{job.completedAt ? fmtDate(job.completedAt) : <span style={styles.dim}>—</span>}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} style={styles.historyCell}>
            {job.history.length === 0 ? (
              <span style={styles.dim}>No assignment history.</span>
            ) : (
              <table style={styles.histTable}>
                <thead>
                  <tr>
                    <th style={styles.histTh}>Action</th>
                    <th style={styles.histTh}>From</th>
                    <th style={styles.histTh}>To</th>
                    <th style={styles.histTh}>By</th>
                    <th style={styles.histTh}>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {job.history.map((h) => (
                    <tr key={h.id}>
                      <td style={styles.histTd}>{h.action}</td>
                      <td style={styles.histTd}>{h.fromUser?.username ?? <span style={styles.dim}>—</span>}</td>
                      <td style={styles.histTd}>{h.toUser?.username ?? <span style={styles.dim}>—</span>}</td>
                      <td style={styles.histTd}>{h.actionBy?.username ?? '?'}</td>
                      <td style={styles.histTd}>{fmt(h.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function DatasetCard({ dataset }) {
  const [open, setOpen]             = useState(false);
  const [expandedJobs, setExpandedJobs] = useState(new Set());

  function toggleJob(jobId) {
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      next.has(jobId) ? next.delete(jobId) : next.add(jobId);
      return next;
    });
  }

  return (
    <div style={styles.card}>
      {/* ── card header ── */}
      <div style={styles.cardHeader} onClick={() => setOpen((v) => !v)}>
        <div style={styles.cardLeft}>
          <span style={styles.cardToggle}>{open ? '▾' : '▸'}</span>
          <div>
            <div style={styles.cardName}>
              {dataset.displayName || dataset.datasetPath.split('/').pop()}
            </div>
            <div style={styles.cardMeta}>
              {dataset.typeName && <span style={styles.tag}>{dataset.typeName}</span>}
              <span style={styles.dim}>{dataset.totalImages} images</span>
              <span style={styles.dot}>·</span>
              <span style={styles.dim}>Archived {fmtDate(dataset.archivedAt)}</span>
              {dataset.archivedBy && (
                <>
                  <span style={styles.dot}>·</span>
                  <span style={styles.dim}>moved by <b style={{ color: '#9ba9c3' }}>{dataset.archivedBy.username}</b></span>
                </>
              )}
            </div>
          </div>
        </div>
        <div style={styles.cardStats}>
          <StatPill label="Edited" value={dataset.totalEditedFiles} color="#1e3a2a" />
          <StatPill label="Deleted" value={dataset.totalDeletedImages} color="#3a1e1e" />
          <StatPill label="Dup removed" value={dataset.duplicateRemovedCount} color="#1e2a3a" />
          <StatPill label="Jobs" value={dataset.jobs.length} color="#222" />
        </div>
      </div>

      {/* ── jobs table ── */}
      {open && (
        <div style={styles.jobsSection}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Job</th>
                <th style={styles.th}>Assigned to</th>
                <th style={styles.th}>Files edited</th>
                <th style={styles.th}>Images deleted</th>
                <th style={styles.th}>Completed</th>
              </tr>
            </thead>
            <tbody>
              {dataset.jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  expanded={expandedJobs.has(job.id)}
                  onToggle={() => toggleJob(job.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function ArchivePage() {
  const router                      = useRouter();
  const { user, loading: userLoading } = useCurrentUser();
  const [datasets, setDatasets]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);

  const isAdminOrDM = user?.role === 'admin' || user?.role === 'data-manager';

  useEffect(() => {
    if (userLoading) return;
    if (!isAdminOrDM) {
      router.replace('/');
      return;
    }
    fetch('/api/archive/datasets')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setDatasets(data.datasets || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [userLoading, isAdminOrDM]);

  if (userLoading || (!isAdminOrDM && !userLoading)) {
    return null;
  }

  return (
    <div style={styles.page}>
      <AppHeader title="Archive" />
      <main style={styles.main}>
        <div style={styles.header}>
          <h2 style={styles.heading}>Completed Datasets</h2>
          <p style={styles.sub}>Datasets that have been moved to check. Files are removed; records are kept.</p>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        {loading ? (
          <div style={styles.dim}>Loading…</div>
        ) : datasets.length === 0 ? (
          <div style={styles.empty}>No archived datasets yet.</div>
        ) : (
          <div style={styles.list}>
            {datasets.map((ds) => (
              <DatasetCard key={ds.id} dataset={ds} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ── styles ───────────────────────────────────────────────────────────────────

const styles = {
  page:       { minHeight: '100vh', background: '#0f1117', color: '#c9d1d9' },
  main:       { maxWidth: 1100, margin: '0 auto', padding: '32px 24px' },
  header:     { marginBottom: 28 },
  heading:    { margin: 0, fontSize: 24, fontWeight: 600, color: '#e6edf3' },
  sub:        { margin: '6px 0 0', fontSize: 13, color: '#6e7681' },
  error:      { background: '#3a1e1e', border: '1px solid #7a2020', borderRadius: 6, padding: '10px 14px', marginBottom: 16, color: '#f87171', fontSize: 13 },
  empty:      { color: '#6e7681', fontSize: 14, padding: '40px 0', textAlign: 'center' },
  dim:        { color: '#6e7681' },
  list:       { display: 'flex', flexDirection: 'column', gap: 12 },

  card:       { background: '#161b22', border: '1px solid #21262d', borderRadius: 8, overflow: 'hidden' },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', cursor: 'pointer', userSelect: 'none' },
  cardLeft:   { display: 'flex', alignItems: 'flex-start', gap: 10 },
  cardToggle: { color: '#6e7681', fontSize: 14, marginTop: 2, flexShrink: 0 },
  cardName:   { fontWeight: 600, fontSize: 15, color: '#e6edf3', marginBottom: 4 },
  cardMeta:   { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 12 },
  cardStats:  { display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' },

  tag:        { background: '#1f3348', color: '#58a6ff', borderRadius: 4, padding: '1px 7px', fontSize: 11 },
  dot:        { color: '#444' },

  pill:       { display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 4, padding: '3px 8px', fontSize: 12 },
  pillLabel:  { color: '#8b949e' },
  pillValue:  { fontWeight: 600, color: '#e6edf3' },

  jobsSection:{ borderTop: '1px solid #21262d', padding: '0 0 8px' },
  table:      { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:         { padding: '8px 16px', textAlign: 'left', color: '#8b949e', fontWeight: 500, borderBottom: '1px solid #21262d', background: '#0d1117' },
  td:         { padding: '8px 16px', borderBottom: '1px solid #161b22', color: '#c9d1d9', cursor: 'pointer' },
  jobRow:     { ':hover': { background: '#1c2128' } },
  expandIcon: { marginRight: 6, color: '#6e7681', fontSize: 11 },
  username:   { color: '#58a6ff' },

  historyCell:{ padding: '0 32px 12px', background: '#0d1117' },
  histTable:  { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  histTh:     { padding: '5px 10px', textAlign: 'left', color: '#6e7681', fontWeight: 500, borderBottom: '1px solid #21262d' },
  histTd:     { padding: '5px 10px', color: '#8b949e', borderBottom: '1px solid #161b22' },
};
