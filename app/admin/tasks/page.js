'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '../../_components/AppHeader';
import { useCurrentUser } from '../../_components/useCurrentUser';
import { subscribeSSE } from '@/lib/shared-sse';

const STATUS_COLOR = {
  pending:   '#9ba9c3',
  running:   '#2f7ff5',
  completed: '#20c25a',
  failed:    '#d24343',
  cancelled: '#5a6a8a',
};
const STATUS_LABEL = {
  pending:   'Pending',
  running:   'Running',
  completed: 'Completed',
  failed:    'Failed',
  cancelled: 'Cancelled',
};
const LOG_COLOR = { info: '#9ba9c3', warn: '#f1b11a', error: '#f87171' };
const TYPE_LABEL = { 'duplicate-scan': 'Duplicate Scan', 'move-dataset-to-check': 'Move to Check' };

function duration(task) {
  const start = task.startedAt ? new Date(task.startedAt) : null;
  const end = task.completedAt ? new Date(task.completedAt) : task.status === 'running' ? new Date() : null;
  if (!start || !end) return null;
  const s = Math.round((end - start) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

const LOG_PAGE = 50;

function LogBox({ taskId, taskStatus }) {
  const boxRef       = useRef(null);
  const [logs, setLogs]         = useState([]);
  const [hasMore, setHasMore]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [userScrolled, setUserScrolled] = useState(false);

  // ids for pagination
  const oldestId = logs.length > 0 ? logs[0].id        : null;
  const newestId = logs.length > 0 ? logs[logs.length - 1].id : null;
  const newestIdRef = useRef(newestId);
  newestIdRef.current = newestId;

  // initial load: fetch last N logs and scroll to bottom
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/tasks/${taskId}/logs?limit=${LOG_PAGE}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const fetched = data.logs || [];
        setLogs(fetched);
        setHasMore(fetched.length === LOG_PAGE);
        setLoading(false);
        requestAnimationFrame(() => {
          if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
        });
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [taskId]);

  // poll for newer logs while running
  useEffect(() => {
    if (taskStatus !== 'running') return;
    const iv = setInterval(async () => {
      const after = newestIdRef.current;
      if (after == null) return;
      try {
        const r = await fetch(`/api/tasks/${taskId}/logs?limit=100&after=${after}`);
        const data = await r.json();
        const fetched = data.logs || [];
        if (fetched.length === 0) return;
        setLogs((prev) => [...prev, ...fetched]);
        if (!userScrolled) {
          requestAnimationFrame(() => {
            if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
          });
        }
      } catch {}
    }, 2000);
    return () => clearInterval(iv);
  }, [taskId, taskStatus, userScrolled]);

  // load older on scroll-to-top
  const loadOlder = useCallback(async () => {
    if (!hasMore || loading || oldestId == null) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/tasks/${taskId}/logs?limit=${LOG_PAGE}&before=${oldestId}`);
      const data = await r.json();
      const fetched = data.logs || [];
      if (fetched.length === 0) { setHasMore(false); setLoading(false); return; }

      const box = boxRef.current;
      const prevScrollHeight = box?.scrollHeight || 0;
      setLogs((prev) => [...fetched, ...prev]);
      setHasMore(fetched.length === LOG_PAGE);
      setLoading(false);
      requestAnimationFrame(() => {
        if (box) box.scrollTop = box.scrollHeight - prevScrollHeight;
      });
    } catch { setLoading(false); }
  }, [taskId, hasMore, loading, oldestId]);

  const handleScroll = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    setUserScrolled(!atBottom);
    if (el.scrollTop < 40) loadOlder();
  }, [loadOlder]);

  const scrollToBottom = () => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
    setUserScrolled(false);
  };

  return (
    <div style={{ position: 'relative' }}>
      <div ref={boxRef} style={s.logBox} onScroll={handleScroll}>
        {loading && <div style={s.logLoadingTop}>Loading…</div>}
        {!loading && hasMore && (
          <button style={s.loadOlderBtn} onClick={loadOlder}>↑ Load older</button>
        )}
        {logs.length === 0 && !loading
          ? <span style={s.logEmpty}>No logs yet.</span>
          : logs.map((entry) => (
            <div key={entry.id} style={s.logLine}>
              <span style={s.logTs}>{new Date(entry.ts).toLocaleTimeString()}</span>
              <span style={{ ...s.logLevel, color: LOG_COLOR[entry.level] || '#9ba9c3' }}>[{entry.level}]</span>
              <span style={s.logMsg}>{entry.message}</span>
            </div>
          ))
        }
      </div>
      {userScrolled && (
        <button style={s.scrollDownBtn} onClick={scrollToBottom}>↓ Latest</button>
      )}
    </div>
  );
}

function TaskRow({ task }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={s.taskCard}>
      <div style={s.taskHeader} onClick={() => setExpanded((v) => !v)} role="button" tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded((v) => !v)}>
        <div style={s.taskLeft}>
          <span style={{ ...s.statusDot, background: STATUS_COLOR[task.status] || '#9ba9c3' }} />
          <div>
            <span style={s.taskDataset}>{task.datasetName || `Dataset #${task.datasetId}`}</span>
            <span style={s.taskType}>{TYPE_LABEL[task.type] || task.type}</span>
          </div>
        </div>
        <div style={s.taskRight}>
          <span style={{ ...s.statusBadge, background: (STATUS_COLOR[task.status] || '#9ba9c3') + '22', color: STATUS_COLOR[task.status] || '#9ba9c3' }}>
            {STATUS_LABEL[task.status] || task.status}
          </span>
          {duration(task) && <span style={s.taskDuration}>{duration(task)}</span>}
          <span style={s.taskTime}>{new Date(task.createdAt).toLocaleString()}</span>
          <span style={s.expandIcon}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div style={s.taskBody}>
          <div style={s.taskMeta}>
            {task.datasetPath && <span style={s.metaItem}><b>Path:</b> {task.datasetPath}</span>}
            {task.createdByUsername && <span style={s.metaItem}><b>Created by:</b> {task.createdByUsername}</span>}
            {task.startedAt && <span style={s.metaItem}><b>Started:</b> {new Date(task.startedAt).toLocaleString()}</span>}
            {task.completedAt && <span style={s.metaItem}><b>Finished:</b> {new Date(task.completedAt).toLocaleString()}</span>}
          </div>
          {task.error && <div style={s.taskError}>{task.error}</div>}
          <LogBox taskId={task.id} taskStatus={task.status} />
        </div>
      )}
    </div>
  );
}

export default function TasksPage() {
  const { user, loading: authLoading } = useCurrentUser();
  const router = useRouter();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [streamError, setStreamError] = useState(null);

  const isAdminOrDM = user?.role === 'admin' || user?.role === 'data-manager';

  // Initial REST fetch so the page renders immediately without waiting for SSE
  useEffect(() => {
    if (authLoading || !isAdminOrDM) return;
    fetch('/api/tasks')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setTasks(Array.isArray(data.tasks) ? data.tasks : []);
          setLoading(false);
        }
      })
      .catch(() => {});
  }, [authLoading, isAdminOrDM]);

  // SSE for live updates
  useEffect(() => {
    if (authLoading) return;
    if (!isAdminOrDM) { router.push('/'); return; }

    return subscribeSSE('/api/tasks/stream', {
      tasks: (e) => {
        try {
          const data = JSON.parse(e.data);
          setTasks(Array.isArray(data.tasks) ? data.tasks : []);
          setStreamError(null);
          setLoading(false);
        } catch {}
      },
      error: (e) => {
        try { const d = JSON.parse(e.data); setStreamError(d.message); } catch {}
        setLoading(false);
      },
    });
  }, [authLoading, isAdminOrDM, router]);

  const running  = tasks.filter((t) => t.status === 'running').length;
  const pending  = tasks.filter((t) => t.status === 'pending').length;

  return (
    <div style={s.page}>
      <AppHeader />
      <main style={s.main}>
        <div style={s.topBar}>
          <div>
            <h1 style={s.h1}>Tasks</h1>
            <p style={s.subtitle}>
              {tasks.length} task{tasks.length !== 1 ? 's' : ''}
              {running > 0 && <span style={s.runningBadge}>{running} running</span>}
              {pending > 0 && <span style={s.pendingBadge}>{pending} pending</span>}
            </p>
          </div>
        </div>

        {streamError && (
          <div style={s.streamError}>Query error: {streamError}</div>
        )}
        {loading
          ? <div style={s.empty}>Loading…</div>
          : tasks.length === 0
            ? <div style={s.empty}>No tasks yet. Tasks appear here when duplicate scans are queued.</div>
            : <div style={s.list}>{tasks.map((t) => <TaskRow key={t.id} task={t} />)}</div>
        }
      </main>
    </div>
  );
}

const s = {
  page: {
    minHeight: '100vh',
    background: 'radial-gradient(circle at 20% 20%, #15233a, #0a111f 50%), #0d1626',
    color: '#e6edf7',
    fontFamily: '"Nunito Sans", "Segoe UI", system-ui, sans-serif',
    display: 'flex', flexDirection: 'column',
  },
  main: { maxWidth: '900px', width: '100%', margin: '0 auto', padding: '32px 24px 60px' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' },
  h1: { fontSize: '24px', fontWeight: 800, color: '#e6edf7', margin: 0 },
  subtitle: { fontSize: '13px', color: '#9ba9c3', marginTop: '4px', display: 'flex', gap: '8px', alignItems: 'center' },
  runningBadge: { background: '#2f7ff522', color: '#2f7ff5', borderRadius: '4px', padding: '1px 7px', fontSize: '11px', fontWeight: 700 },
  pendingBadge: { background: '#9ba9c322', color: '#9ba9c3', borderRadius: '4px', padding: '1px 7px', fontSize: '11px', fontWeight: 700 },
  list: { display: 'flex', flexDirection: 'column', gap: '8px' },
  empty: { color: '#5a6a8a', padding: '48px', textAlign: 'center', fontSize: '14px' },
  taskCard: { background: '#152033', border: '1px solid #25344d', borderRadius: '10px', overflow: 'hidden' },
  taskHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 16px', cursor: 'pointer', gap: '12px',
  },
  taskLeft: { display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 },
  taskRight: { display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 },
  statusDot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
  taskDataset: { fontSize: '14px', fontWeight: 700, color: '#e6edf7', display: 'block' },
  taskType: { fontSize: '11px', color: '#5a6a8a', display: 'block', marginTop: '2px' },
  statusBadge: { fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' },
  taskDuration: { fontSize: '11px', color: '#9ba9c3', fontFamily: 'monospace' },
  taskTime: { fontSize: '11px', color: '#5a6a8a' },
  expandIcon: { fontSize: '10px', color: '#5a6a8a', marginLeft: '4px' },
  taskBody: { borderTop: '1px solid #1b2940', padding: '14px 16px', background: '#0d1626' },
  taskMeta: { display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '10px' },
  metaItem: { fontSize: '12px', color: '#9ba9c3' },
  taskError: {
    fontSize: '12px', color: '#f87171', background: 'rgba(248,113,113,0.08)',
    border: '1px solid rgba(248,113,113,0.2)', borderRadius: '6px', padding: '8px 12px', marginBottom: '10px',
  },
  logBox: {
    background: '#070e1a', border: '1px solid #1b2940', borderRadius: '6px',
    padding: '10px 12px', maxHeight: '300px', overflowY: 'auto',
    fontFamily: 'ui-monospace, monospace', fontSize: '12px', lineHeight: 1.6,
  },
  streamError: { color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: '6px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px' },
  logEmpty: { color: '#5a6a8a' },
  logLoadingTop: { color: '#5a6a8a', fontSize: '11px', textAlign: 'center', padding: '4px 0 8px' },
  loadOlderBtn: {
    display: 'block', width: '100%', background: 'none', border: 'none',
    color: '#5a6a8a', fontSize: '11px', cursor: 'pointer', padding: '4px 0 8px',
    textAlign: 'center',
  },
  scrollDownBtn: {
    position: 'absolute', bottom: '8px', right: '12px',
    background: '#1b2940', border: '1px solid #3a4f70', borderRadius: '20px',
    color: '#9ba9c3', cursor: 'pointer', fontSize: '11px', fontWeight: 700,
    padding: '4px 12px', zIndex: 1, boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
  },
  logLine: { display: 'flex', gap: '8px', marginBottom: '2px' },
  logTs: { color: '#3a4f70', flexShrink: 0 },
  logLevel: { flexShrink: 0, fontWeight: 700 },
  logMsg: { color: '#9ba9c3', wordBreak: 'break-all' },
};
