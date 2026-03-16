'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '../../_components/AppHeader';
import { useCurrentUser } from '../../_components/useCurrentUser';
import FileBrowser from '../../_components/FileBrowser';

function DatasetTypesSection() {
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const loadTypes = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/dataset-types');
      const data = await res.json();
      if (res.ok) setTypes(data.types || []);
      else setError(data.error || 'Failed to load dataset types');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTypes(); }, [loadTypes]);

  async function handleDelete(id) {
    try {
      const res = await fetch(`/api/settings/dataset-types/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setTypes((prev) => prev.filter((t) => t.id !== id));
        setDeleteConfirmId(null);
      } else {
        const d = await res.json();
        setError(d.error || 'Delete failed');
      }
    } catch {
      setError('Network error');
    }
  }

  return (
    <div style={styles.section}>
      <div style={styles.sectionHeader}>
        <div>
          <h2 style={styles.sectionTitle}>Dataset Types</h2>
          <p style={styles.sectionDesc}>
            Configure types with source (uncheck) and destination (check) paths for the Move to Check workflow.
          </p>
        </div>
        <button style={styles.addTypeBtn} onClick={() => { setShowAdd(true); setEditingId(null); }}>
          + Add Type
        </button>
      </div>

      {error && <p style={styles.errorMsg}>{error}</p>}

      {loading ? (
        <p style={styles.loadingText}>Loading…</p>
      ) : types.length === 0 ? (
        <div style={styles.emptyTypes}>
          <p style={{ color: '#9ba9c3', fontSize: '13px' }}>No dataset types configured yet.</p>
        </div>
      ) : (
        <div style={styles.typesTable}>
          <div style={styles.typesTableHead}>
            <span>Name</span>
            <span>Uncheck Path</span>
            <span>Check Path</span>
            <span>Actions</span>
          </div>
          {types.map((t) => (
            <div key={t.id} style={styles.typesTableRow}>
              <span style={styles.typeName}>{t.name}</span>
              <span style={styles.typePath}>{t.uncheckPath}</span>
              <span style={styles.typePath}>{t.checkPath}</span>
              <span style={styles.typeActions}>
                <button
                  style={styles.editBtn}
                  onClick={() => { setEditingId(t.id); setShowAdd(false); }}
                >
                  Edit
                </button>
                <button
                  style={styles.deleteBtn}
                  onClick={() => setDeleteConfirmId(t.id)}
                >
                  Delete
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <DatasetTypeForm
          onClose={() => setShowAdd(false)}
          onSaved={(newType) => {
            setTypes((prev) => [...prev, newType]);
            setShowAdd(false);
          }}
        />
      )}

      {editingId !== null && (
        <DatasetTypeForm
          type={types.find((t) => t.id === editingId)}
          onClose={() => setEditingId(null)}
          onSaved={(updated) => {
            setTypes((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
            setEditingId(null);
          }}
        />
      )}

      {deleteConfirmId !== null && (
        <div style={styles.modalOverlay} onClick={() => setDeleteConfirmId(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Delete Dataset Type?</h3>
              <button style={styles.closeBtn} onClick={() => setDeleteConfirmId(null)}>×</button>
            </div>
            <p style={{ color: '#9ba9c3', fontSize: '13px', marginBottom: '20px' }}>
              This will remove the type configuration. Existing datasets with this type will have their type set to null.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button style={styles.cancelBtn} onClick={() => setDeleteConfirmId(null)}>Cancel</button>
              <button
                style={{ ...styles.submitBtn, background: '#d24343' }}
                onClick={() => handleDelete(deleteConfirmId)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// null = unchecked, 'checking' = in-flight, 'ok' = exists+writable, 'missing' = not found, 'readonly' = no write
async function validatePath(p) {
  const res = await fetch(`/api/validate-path?path=${encodeURIComponent(p)}`);
  if (!res.ok) return 'error';
  const { exists, writable } = await res.json();
  if (!exists) return 'missing';
  if (!writable) return 'readonly';
  return 'ok';
}

const PATH_MSG = {
  missing: 'Directory not found',
  readonly: 'No write permission',
  error: 'Could not check path',
};

function DatasetTypeForm({ type, onClose, onSaved }) {
  const isEdit = !!type;
  const [name, setName] = useState(type?.name || '');
  const [uncheckPath, setUncheckPath] = useState(type?.uncheckPath || '');
  const [checkPath, setCheckPath] = useState(type?.checkPath || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [browsingField, setBrowsingField] = useState(null); // 'uncheck' | 'check'
  const [uncheckStatus, setUncheckStatus] = useState(null);
  const [checkStatus, setCheckStatus]     = useState(null);

  async function checkField(field, value) {
    const setStatus = field === 'uncheck' ? setUncheckStatus : setCheckStatus;
    const p = value.trim();
    if (!p) { setStatus(null); return; }
    setStatus('checking');
    setStatus(await validatePath(p));
  }

  const pathsAreSame = uncheckPath.trim() !== '' && uncheckPath.trim() === checkPath.trim();
  const canSubmit = !pathsAreSame &&
                    uncheckStatus !== 'missing' && uncheckStatus !== 'readonly' && uncheckStatus !== 'error' &&
                    checkStatus   !== 'missing' && checkStatus   !== 'readonly' && checkStatus   !== 'error';

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !uncheckPath.trim() || !checkPath.trim()) {
      setError('All fields are required');
      return;
    }
    if (uncheckPath.trim() === checkPath.trim()) {
      setError('Uncheck Path and Check Path cannot be the same');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const url = isEdit ? `/api/settings/dataset-types/${type.id}` : '/api/settings/dataset-types';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), uncheckPath: uncheckPath.trim(), checkPath: checkPath.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed'); return; }
      onSaved(data.type);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div style={styles.typeFormCard}>
        <div style={styles.typeFormHeader}>
          <span style={styles.typeFormTitle}>{isEdit ? 'Edit Dataset Type' : 'Add Dataset Type'}</span>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={styles.typeForm}>
          <div style={styles.typeFormField}>
            <label style={styles.typeFormLabel}>Name</label>
            <input
              style={{ ...styles.input, textAlign: 'left', fontWeight: 400, fontSize: '14px' }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. dice"
              required
              autoFocus
            />
          </div>
          <div style={styles.typeFormRow}>
            <div style={styles.typeFormField}>
              <label style={styles.typeFormLabel}>Uncheck Path</label>
              <div style={styles.pathRow}>
                <input
                  style={{ ...styles.input, textAlign: 'left', fontWeight: 400, fontSize: '13px', flex: 1,
                    ...(uncheckStatus === 'missing' || uncheckStatus === 'readonly' || uncheckStatus === 'error'
                      ? { borderColor: '#f87171' } : uncheckStatus === 'ok' ? { borderColor: '#20c25a' } : {}) }}
                  value={uncheckPath}
                  onChange={(e) => { setUncheckPath(e.target.value); setUncheckStatus(null); }}
                  onBlur={() => checkField('uncheck', uncheckPath)}
                  placeholder="/data/uncheck/dice"
                  required
                />
                <button type="button" style={styles.browseBtn} onClick={() => setBrowsingField('uncheck')}>
                  Browse
                </button>
              </div>
              {uncheckStatus === 'checking' && <small style={styles.hintChecking}>Checking…</small>}
              {PATH_MSG[uncheckStatus] && <small style={styles.hintError}>{PATH_MSG[uncheckStatus]}</small>}
              {!PATH_MSG[uncheckStatus] && uncheckStatus !== 'checking' && <small style={styles.hint}>Where WIP datasets live (source)</small>}
            </div>
            <div style={styles.typeFormField}>
              <label style={styles.typeFormLabel}>Check Path</label>
              <div style={styles.pathRow}>
                <input
                  style={{ ...styles.input, textAlign: 'left', fontWeight: 400, fontSize: '13px', flex: 1,
                    ...(pathsAreSame || checkStatus === 'missing' || checkStatus === 'readonly' || checkStatus === 'error'
                      ? { borderColor: '#f87171' } : checkStatus === 'ok' ? { borderColor: '#20c25a' } : {}) }}
                  value={checkPath}
                  onChange={(e) => { setCheckPath(e.target.value); setCheckStatus(null); }}
                  onBlur={() => checkField('check', checkPath)}
                  placeholder="/data/check/dice"
                  required
                />
                <button type="button" style={styles.browseBtn} onClick={() => setBrowsingField('check')}>
                  Browse
                </button>
              </div>
              {pathsAreSame && <small style={styles.hintError}>Must be different from Uncheck Path</small>}
              {!pathsAreSame && checkStatus === 'checking' && <small style={styles.hintChecking}>Checking…</small>}
              {!pathsAreSame && PATH_MSG[checkStatus] && <small style={styles.hintError}>{PATH_MSG[checkStatus]}</small>}
              {!pathsAreSame && !PATH_MSG[checkStatus] && checkStatus !== 'checking' && <small style={styles.hint}>Where completed datasets go (destination)</small>}
            </div>
          </div>
          {error && <p style={styles.errorMsg}>{error}</p>}
          <div style={styles.typeFormActions}>
            <button type="button" style={styles.cancelBtn} onClick={onClose}>Cancel</button>
            <button type="submit" style={{ ...styles.submitBtn, ...(!canSubmit || loading ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }} disabled={!canSubmit || loading}>
              {loading ? 'Saving…' : (isEdit ? 'Save Changes' : 'Add Type')}
            </button>
          </div>
        </form>
      </div>

      {browsingField === 'uncheck' && (
        <FileBrowser
          mode="folder"
          value={uncheckPath}
          onChange={(p) => { setUncheckPath(p); setBrowsingField(null); checkField('uncheck', p); }}
          onClose={() => setBrowsingField(null)}
        />
      )}
      {browsingField === 'check' && (
        <FileBrowser
          mode="folder"
          value={checkPath}
          onChange={(p) => { setCheckPath(p); setBrowsingField(null); checkField('check', p); }}
          onClose={() => setBrowsingField(null)}
        />
      )}
    </>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { user: me, loading: authLoading } = useCurrentUser();
  const [jobSize, setJobSize] = useState('');
  const [savedJobSize, setSavedJobSize] = useState('');
  const [moveRetryLimit, setMoveRetryLimit] = useState('');
  const [savedMoveRetryLimit, setSavedMoveRetryLimit] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!authLoading) {
      if (me?.role !== 'admin') { router.replace('/'); return; }
      loadSettings();
    }
  }, [authLoading, me, router]);

  async function loadSettings() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (res.ok) {
        const jsVal = String(data.settings?.job_size ?? 500);
        setJobSize(jsVal);
        setSavedJobSize(jsVal);
        const mrlVal = String(data.settings?.move_retry_limit ?? 3);
        setMoveRetryLimit(mrlVal);
        setSavedMoveRetryLimit(mrlVal);
      } else {
        setError(data.error || 'Failed to load settings');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setSaved(false);
    const jsVal = parseInt(jobSize, 10);
    if (!jsVal || jsVal < 1) { setError('Job size must be a positive integer'); return; }
    const mrlVal = parseInt(moveRetryLimit, 10);
    if (isNaN(mrlVal) || mrlVal < 0) { setError('Move retry limit must be a non-negative integer'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_size: jsVal, move_retry_limit: mrlVal }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to save'); return; }
      setSavedJobSize(String(jsVal));
      setSavedMoveRetryLimit(String(mrlVal));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || loading) {
    return (
      <div style={styles.page}>
        <AppHeader title="Settings" />
        <div style={styles.loading}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <AppHeader title="System Settings" />
      <main style={styles.main}>
        <h1 style={styles.h1}>System Settings</h1>
        <p style={styles.subtitle}>Changes affect future datasets only. Existing datasets retain their original job size.</p>

        <div style={styles.card}>
          <form onSubmit={handleSave} style={styles.form}>
            <div style={styles.settingRow}>
              <div style={styles.settingInfo}>
                <label style={styles.settingLabel} htmlFor="jobSize">Default Job Size</label>
                <p style={styles.settingDesc}>
                  Number of images per job when a new dataset is added. Datasets are split into jobs of this size automatically.
                </p>
              </div>
              <div style={styles.settingControl}>
                <input
                  id="jobSize"
                  type="number"
                  min="1"
                  step="1"
                  style={styles.input}
                  value={jobSize}
                  onChange={(e) => setJobSize(e.target.value)}
                  required
                />
                <small style={styles.hint}>Current saved value: {savedJobSize}</small>
              </div>
            </div>

            <div style={styles.settingRow}>
              <div style={styles.settingInfo}>
                <label style={styles.settingLabel} htmlFor="moveRetryLimit">Move Retry Limit</label>
                <p style={styles.settingDesc}>
                  Number of times to retry a failed &quot;Move to Check&quot; operation before giving up. Set to 0 to disable retries.
                </p>
              </div>
              <div style={styles.settingControl}>
                <input
                  id="moveRetryLimit"
                  type="number"
                  min="0"
                  step="1"
                  style={styles.input}
                  value={moveRetryLimit}
                  onChange={(e) => setMoveRetryLimit(e.target.value)}
                  required
                />
                <small style={styles.hint}>Current saved value: {savedMoveRetryLimit}</small>
              </div>
            </div>

            {error && <p style={styles.errorMsg}>{error}</p>}
            {saved && <p style={styles.successMsg}>Settings saved.</p>}

            <div style={styles.formFooter}>
              <button type="submit" style={styles.saveBtn} disabled={saving}>
                {saving ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          </form>
        </div>

        <div style={{ marginTop: '36px' }}>
          <DatasetTypesSection />
        </div>
      </main>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: 'radial-gradient(circle at 20% 20%, #15233a, #0a111f 50%), radial-gradient(circle at 80% 0%, #12213a, #0a111f 40%), #0d1626', color: '#e6edf7', fontFamily: '"Nunito Sans", "Segoe UI", system-ui, -apple-system, sans-serif', display: 'flex', flexDirection: 'column' },
  loading: { padding: '60px', textAlign: 'center', color: '#9ba9c3' },
  loadingText: { color: '#9ba9c3', fontSize: '13px', padding: '16px 0' },
  main: { maxWidth: '860px', width: '100%', margin: '0 auto', padding: '32px 24px 60px' },
  h1: { fontSize: '24px', fontWeight: 800, color: '#e6edf7', margin: '0 0 6px' },
  subtitle: { color: '#9ba9c3', fontSize: '13px', marginBottom: '28px' },
  card: { background: '#152033', border: '1px solid #25344d', borderRadius: '12px', padding: '24px' },
  form: { display: 'flex', flexDirection: 'column', gap: '24px' },
  settingRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '24px' },
  settingInfo: { flex: 1 },
  settingLabel: { display: 'block', fontSize: '14px', fontWeight: 700, color: '#e6edf7', marginBottom: '6px' },
  settingDesc: { color: '#9ba9c3', fontSize: '12px', lineHeight: 1.5, margin: 0 },
  settingControl: { display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '160px' },
  input: { background: '#0d1626', border: '1px solid #25344d', borderRadius: '8px', color: '#e6edf7', fontSize: '15px', fontWeight: 700, padding: '10px 12px', outline: 'none', width: '100%', boxSizing: 'border-box', textAlign: 'center' },
  hint: { color: '#5a6a8a', fontSize: '11px', textAlign: 'center' },
  errorMsg: { color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: '6px', padding: '10px 14px', fontSize: '13px' },
  successMsg: { color: '#20c25a', background: 'rgba(32,194,90,0.08)', border: '1px solid rgba(32,194,90,0.2)', borderRadius: '6px', padding: '10px 14px', fontSize: '13px' },
  formFooter: { display: 'flex', justifyContent: 'flex-end' },
  saveBtn: { background: '#e45d25', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 700, padding: '11px 24px' },
  // Dataset Types section
  section: { display: 'flex', flexDirection: 'column', gap: '16px' },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' },
  sectionTitle: { fontSize: '18px', fontWeight: 800, color: '#e6edf7', margin: '0 0 4px' },
  sectionDesc: { color: '#9ba9c3', fontSize: '12px', lineHeight: 1.5, margin: 0 },
  addTypeBtn: { background: '#e45d25', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 700, padding: '9px 16px', flexShrink: 0 },
  emptyTypes: { background: '#152033', border: '1px solid #25344d', borderRadius: '10px', padding: '24px', textAlign: 'center' },
  typesTable: { background: '#152033', border: '1px solid #25344d', borderRadius: '10px', overflow: 'hidden' },
  typesTableHead: { display: 'grid', gridTemplateColumns: '1fr 2fr 2fr auto', padding: '10px 16px', background: '#1b2940', borderBottom: '1px solid #25344d', fontSize: '11px', fontWeight: 700, color: '#9ba9c3', textTransform: 'uppercase', letterSpacing: '0.5px', gap: '12px' },
  typesTableRow: { display: 'grid', gridTemplateColumns: '1fr 2fr 2fr auto', padding: '12px 16px', borderBottom: '1px solid #1b2940', alignItems: 'center', gap: '12px', fontSize: '13px' },
  typeName: { fontWeight: 700, color: '#e6edf7' },
  typePath: { color: '#9ba9c3', fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all' },
  typeActions: { display: 'flex', gap: '6px', alignItems: 'center' },
  editBtn: { background: 'transparent', border: '1px solid #25344d', borderRadius: '5px', color: '#9ba9c3', cursor: 'pointer', fontSize: '11px', fontWeight: 600, padding: '4px 10px' },
  deleteBtn: { background: 'transparent', border: '1px solid #d24343', borderRadius: '5px', color: '#d24343', cursor: 'pointer', fontSize: '11px', fontWeight: 600, padding: '4px 10px' },
  // Type form card (inline)
  typeFormCard: { background: '#1b2940', border: '1px solid #25344d', borderRadius: '10px', padding: '20px', marginTop: '8px' },
  typeFormHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  typeFormTitle: { fontSize: '14px', fontWeight: 700, color: '#e6edf7' },
  typeForm: { display: 'flex', flexDirection: 'column', gap: '12px' },
  typeFormRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  typeFormField: { display: 'flex', flexDirection: 'column', gap: '5px' },
  typeFormLabel: { color: '#9ba9c3', fontSize: '12px', fontWeight: 600 },
  typeFormActions: { display: 'flex', justifyContent: 'flex-end', gap: '10px' },
  pathRow: { display: 'flex', gap: '8px', alignItems: 'center' },
  browseBtn: { background: 'transparent', border: '1px solid #25344d', borderRadius: '7px', color: '#9ba9c3', cursor: 'pointer', fontSize: '12px', fontWeight: 600, padding: '9px 12px', whiteSpace: 'nowrap', flexShrink: 0 },
  hintError: { color: '#f87171', fontSize: '11px' },
  hintChecking: { color: '#9ba9c3', fontSize: '11px' },
  // Modal
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#152033', border: '1px solid #25344d', borderRadius: '14px', padding: '28px', width: '100%', maxWidth: '400px', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  modalTitle: { fontSize: '16px', fontWeight: 800, color: '#e6edf7', margin: 0 },
  closeBtn: { background: 'transparent', border: 'none', color: '#9ba9c3', cursor: 'pointer', fontSize: '22px', lineHeight: 1, padding: '0 4px' },
  submitBtn: { background: '#e45d25', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 700, padding: '10px 20px' },
  cancelBtn: { background: 'transparent', border: '1px solid #25344d', borderRadius: '8px', color: '#9ba9c3', cursor: 'pointer', fontSize: '13px', padding: '10px 20px' },
};
