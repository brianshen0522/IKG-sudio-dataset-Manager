'use client';

import { useState, useEffect, useCallback } from 'react';
import AppHeader from '../../_components/AppHeader';
import { useCurrentUser } from '../../_components/useCurrentUser';
import { useRouter } from 'next/navigation';

const ROLE_COLOR = {
  admin: '#E8FB1E',
  'data-manager': '#2f7ff5',
  user: '#20c25a',
};

function UserModal({ user: editUser, onClose, onSaved }) {
  const isNew = !editUser;
  const [username, setUsername] = useState(editUser?.username || '');
  const [email, setEmail] = useState(editUser?.email || '');
  const [role, setRole] = useState(editUser?.role || 'user');
  const [password, setPassword] = useState('');
  const [isActive, setIsActive] = useState(editUser?.isActive ?? true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const body = { username, email: email || undefined, role, isActive };
      if (isNew || password) body.password = password;

      const res = isNew
        ? await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch(`/api/users/${editUser.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed'); return; }
      onSaved(data.user);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>{isNew ? 'Add User' : `Edit: ${editUser.username}`}</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Username *</label>
            <input style={styles.input} value={username} onChange={(e) => setUsername(e.target.value)}
              required autoFocus={isNew} disabled={!isNew && editUser?.isSystemAdmin} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Email</label>
            <input style={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Role *</label>
            <select style={styles.select} value={role} onChange={(e) => setRole(e.target.value)}
              disabled={!isNew && editUser?.isSystemAdmin}>
              <option value="user">user</option>
              <option value="data-manager">data-manager</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>{isNew ? 'Password *' : 'New Password (leave blank to keep)'}</label>
            <input style={styles.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              required={isNew} autoComplete="new-password" />
          </div>
          {!editUser?.isSystemAdmin && !isNew && (
            <label style={styles.checkboxLabel}>
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              <span>Active</span>
            </label>
          )}
          {error && <p style={styles.errorMsg}>{error}</p>}
          <button type="submit" style={styles.submitBtn} disabled={loading}>
            {loading ? 'Saving…' : (isNew ? 'Create User' : 'Save Changes')}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const router = useRouter();
  const { user: me, loading: authLoading } = useCurrentUser();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editModal, setEditModal] = useState(null); // null | 'new' | user object
  const [deleteId, setDeleteId] = useState(null);

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      if (res.ok) setUsers(data.users || []);
      else setError(data.error || 'Failed to load users');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading) {
      if (me?.role !== 'admin') { router.replace('/'); return; }
      loadUsers();
    }
  }, [authLoading, me, router, loadUsers]);

  async function handleDelete(id) {
    try {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== id));
        setDeleteId(null);
      } else {
        const d = await res.json();
        alert(d.error || 'Delete failed');
      }
    } catch {
      alert('Network error');
    }
  }

  if (authLoading || loading) {
    return (
      <div style={styles.page}>
        <AppHeader title="Users" />
        <div style={styles.loading}>Loading…</div>
      </div>
    );
  }

  const deleteTarget = users.find((u) => u.id === deleteId);

  return (
    <div style={styles.page}>
      <AppHeader title="User Management" />
      <main style={styles.main}>
        <div style={styles.topBar}>
          <div>
            <h1 style={styles.h1}>Users</h1>
            <p style={styles.subtitle}>{users.length} user{users.length !== 1 ? 's' : ''}</p>
          </div>
          <button style={styles.addBtn} onClick={() => setEditModal('new')}>+ Add User</button>
        </div>

        {error && <p style={styles.errorMsg}>{error}</p>}

        <div style={styles.table}>
          <div style={styles.tableHead}>
            <span>Username</span>
            <span>Email</span>
            <span>Role</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          {users.map((u) => (
            <div key={u.id} style={styles.tableRow}>
              <span style={styles.tdUsername}>
                {u.username}
                {u.isSystemAdmin && <span style={styles.sysAdminBadge}>system admin</span>}
                {u.id === me?.id && <span style={styles.youBadge}>you</span>}
              </span>
              <span style={styles.tdEmail}>{u.email || <em style={{ color: '#5a6a8a' }}>—</em>}</span>
              <span>
                <span style={{ ...styles.roleBadge, color: ROLE_COLOR[u.role] || '#9ba9c3', background: (ROLE_COLOR[u.role] || '#9ba9c3') + '18' }}>
                  {u.role}
                </span>
              </span>
              <span>
                <span style={{ ...styles.statusDot, background: u.isActive ? '#20c25a' : '#d24343' }} />
                <span style={{ fontSize: '12px', color: u.isActive ? '#20c25a' : '#d24343' }}>
                  {u.isActive ? 'Active' : 'Inactive'}
                </span>
              </span>
              <span style={styles.tdActions}>
                <button style={styles.actionBtn} onClick={() => setEditModal(u)}>Edit</button>
                {!u.isSystemAdmin && u.id !== me?.id && (
                  <button style={{ ...styles.actionBtn, ...styles.actionBtnDanger }}
                    onClick={() => setDeleteId(u.id)}>Delete</button>
                )}
              </span>
            </div>
          ))}
        </div>
      </main>

      {(editModal === 'new' || (editModal && typeof editModal === 'object')) && (
        <UserModal
          user={editModal === 'new' ? null : editModal}
          onClose={() => setEditModal(null)}
          onSaved={(saved) => {
            if (editModal === 'new') setUsers((prev) => [...prev, saved]);
            else setUsers((prev) => prev.map((u) => (u.id === saved.id ? saved : u)));
            setEditModal(null);
          }}
        />
      )}

      {deleteId && deleteTarget && (
        <div style={styles.modalOverlay} onClick={() => setDeleteId(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Delete User?</h3>
              <button style={styles.closeBtn} onClick={() => setDeleteId(null)}>×</button>
            </div>
            <p style={{ color: '#9ba9c3', marginBottom: '20px', fontSize: '14px' }}>
              Delete <strong style={{ color: '#e6edf7' }}>{deleteTarget.username}</strong>? This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button style={styles.cancelBtn} onClick={() => setDeleteId(null)}>Cancel</button>
              <button style={{ ...styles.submitBtn, background: '#d24343' }} onClick={() => handleDelete(deleteId)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: 'radial-gradient(circle at 20% 20%, #15233a, #0a111f 50%), radial-gradient(circle at 80% 0%, #12213a, #0a111f 40%), #0d1626', color: '#e6edf7', fontFamily: '"Nunito Sans", "Segoe UI", system-ui, -apple-system, sans-serif', display: 'flex', flexDirection: 'column' },
  loading: { padding: '60px', textAlign: 'center', color: '#9ba9c3' },
  main: { maxWidth: '1000px', width: '100%', margin: '0 auto', padding: '32px 24px 60px' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' },
  h1: { fontSize: '24px', fontWeight: 800, color: '#e6edf7', margin: 0 },
  subtitle: { color: '#9ba9c3', fontSize: '13px', marginTop: '4px' },
  addBtn: { background: '#e45d25', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 700, padding: '10px 18px' },
  errorMsg: { color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: '6px', padding: '10px 14px', fontSize: '13px', marginBottom: '16px' },
  table: { background: '#152033', border: '1px solid #25344d', borderRadius: '10px', overflow: 'hidden' },
  tableHead: { display: 'grid', gridTemplateColumns: '1fr 1fr 120px 100px 140px', padding: '10px 16px', background: '#1b2940', borderBottom: '1px solid #25344d', fontSize: '11px', fontWeight: 700, color: '#9ba9c3', textTransform: 'uppercase', letterSpacing: '0.5px' },
  tableRow: { display: 'grid', gridTemplateColumns: '1fr 1fr 120px 100px 140px', padding: '13px 16px', borderBottom: '1px solid #1b2940', alignItems: 'center', fontSize: '13px' },
  tdUsername: { display: 'flex', alignItems: 'center', gap: '8px', color: '#e6edf7', fontWeight: 600 },
  tdEmail: { color: '#9ba9c3', fontSize: '12px' },
  tdActions: { display: 'flex', gap: '8px' },
  sysAdminBadge: { fontSize: '10px', color: '#E8FB1E', background: 'rgba(232,251,30,0.1)', borderRadius: '4px', padding: '2px 6px', fontWeight: 600 },
  youBadge: { fontSize: '10px', color: '#9ba9c3', background: '#1b2940', borderRadius: '4px', padding: '2px 6px' },
  roleBadge: { fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '20px' },
  statusDot: { display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', marginRight: '6px' },
  actionBtn: { background: 'transparent', border: '1px solid #25344d', borderRadius: '5px', color: '#9ba9c3', cursor: 'pointer', fontSize: '11px', fontWeight: 600, padding: '4px 10px' },
  actionBtnDanger: { borderColor: '#d24343', color: '#d24343' },
  // Modal
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#152033', border: '1px solid #25344d', borderRadius: '14px', padding: '28px', width: '100%', maxWidth: '420px', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  modalTitle: { fontSize: '16px', fontWeight: 800, color: '#e6edf7', margin: 0 },
  closeBtn: { background: 'transparent', border: 'none', color: '#9ba9c3', cursor: 'pointer', fontSize: '22px', lineHeight: 1, padding: '0 4px' },
  form: { display: 'flex', flexDirection: 'column', gap: '14px' },
  field: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: { color: '#9ba9c3', fontSize: '12px', fontWeight: 600 },
  input: { background: '#0d1626', border: '1px solid #25344d', borderRadius: '7px', color: '#e6edf7', fontSize: '13px', padding: '9px 11px', outline: 'none', width: '100%', boxSizing: 'border-box' },
  select: { background: '#0d1626', border: '1px solid #25344d', borderRadius: '7px', color: '#e6edf7', fontSize: '13px', padding: '9px 11px', outline: 'none', width: '100%' },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: '8px', color: '#9ba9c3', fontSize: '13px', cursor: 'pointer' },
  submitBtn: { background: '#e45d25', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 700, padding: '11px', marginTop: '4px' },
  cancelBtn: { background: 'transparent', border: '1px solid #25344d', borderRadius: '8px', color: '#9ba9c3', cursor: 'pointer', fontSize: '13px', padding: '11px 20px' },
};
