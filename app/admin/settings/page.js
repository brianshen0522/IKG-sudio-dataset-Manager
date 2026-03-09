'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '../../_components/AppHeader';
import { useCurrentUser } from '../../_components/useCurrentUser';

export default function SettingsPage() {
  const router = useRouter();
  const { user: me, loading: authLoading } = useCurrentUser();
  const [jobSize, setJobSize] = useState('');
  const [savedJobSize, setSavedJobSize] = useState('');
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
        const val = String(data.settings?.job_size ?? 500);
        setJobSize(val);
        setSavedJobSize(val);
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
    const val = parseInt(jobSize, 10);
    if (!val || val < 1) { setError('Job size must be a positive integer'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_size: val }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to save'); return; }
      setSavedJobSize(String(val));
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

            {error && <p style={styles.errorMsg}>{error}</p>}
            {saved && <p style={styles.successMsg}>Settings saved.</p>}

            <div style={styles.formFooter}>
              <button type="submit" style={styles.saveBtn} disabled={saving}>
                {saving ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: 'radial-gradient(circle at 20% 20%, #15233a, #0a111f 50%), radial-gradient(circle at 80% 0%, #12213a, #0a111f 40%), #0d1626', color: '#e6edf7', fontFamily: '"Nunito Sans", "Segoe UI", system-ui, -apple-system, sans-serif', display: 'flex', flexDirection: 'column' },
  loading: { padding: '60px', textAlign: 'center', color: '#9ba9c3' },
  main: { maxWidth: '720px', width: '100%', margin: '0 auto', padding: '32px 24px 60px' },
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
};
