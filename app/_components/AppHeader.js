'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { useCurrentUser } from './useCurrentUser';
import DbOfflineBanner from './DbOfflineBanner';

function useRunningTaskCount(enabled) {
  const [count, setCount] = useState(0);
  const sourceRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;

    const source = new EventSource('/api/tasks/stream');
    sourceRef.current = source;

    source.addEventListener('tasks', (e) => {
      try {
        const { tasks } = JSON.parse(e.data);
        const running = (tasks || []).filter((t) => t.status === 'running' || t.status === 'pending').length;
        setCount(running);
      } catch {}
    });

    return () => source.close();
  }, [enabled]);

  return count;
}

export default function AppHeader({ title, backHref, backLabel }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, dbOffline } = useCurrentUser();

  const isAdmin = user?.role === 'admin';
  const isDM = user?.role === 'data-manager';
  const isAdminOrDM = isAdmin || isDM;
  const runningTasks = useRunningTaskCount(isAdminOrDM);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  if (dbOffline) return <DbOfflineBanner />;

  return (
    <header style={styles.header}>
      <style>{`@keyframes taskPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.7;transform:scale(1.15)} }`}</style>
      <div style={styles.left}>
        {backHref ? (
          <button style={styles.backBtn} onClick={() => router.push(backHref)}>
            ← {backLabel || 'Back'}
          </button>
        ) : (
          <div style={styles.brand} onClick={() => router.push('/')} role="button" tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && router.push('/')}>
            <img src="/ikg-logo.svg" alt="IKG" style={styles.logo} />
            <span style={styles.brandIKG}>IKG</span>
            <span style={styles.brandRest}> Studio</span>
          </div>
        )}
        {title && <span style={styles.pageTitle}>{title}</span>}
      </div>

      <nav style={styles.nav}>
        {isAdminOrDM && (
          <button
            style={{ ...styles.navBtn, ...(pathname === '/' ? styles.navBtnActive : {}) }}
            onClick={() => router.push('/')}
          >
            Datasets
          </button>
        )}
        {isAdminOrDM && (
          <button
            style={{ ...styles.navBtn, ...(pathname?.startsWith('/admin/tasks') ? styles.navBtnActive : {}) }}
            onClick={() => router.push('/admin/tasks')}
          >
            Tasks
            {runningTasks > 0 && (
              <span style={styles.taskBadge}>{runningTasks}</span>
            )}
          </button>
        )}
        {isAdmin && (
          <>
            <button
              style={{ ...styles.navBtn, ...(pathname?.startsWith('/admin/users') ? styles.navBtnActive : {}) }}
              onClick={() => router.push('/admin/users')}
            >
              Users
            </button>
            <button
              style={{ ...styles.navBtn, ...(pathname?.startsWith('/admin/settings') ? styles.navBtnActive : {}) }}
              onClick={() => router.push('/admin/settings')}
            >
              Settings
            </button>
          </>
        )}
      </nav>

      <div style={styles.right}>
        {user && (
          <span style={styles.userInfo}>
            <span style={styles.userRole}>{user.role}</span>
            <span style={styles.userName}>{user.username}</span>
          </span>
        )}
        <button style={styles.logoutBtn} onClick={handleLogout}>Sign Out</button>
      </div>
    </header>
  );
}

const styles = {
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 24px',
    height: '56px',
    background: '#0d1a2e',
    borderBottom: '1px solid #25344d',
    position: 'sticky',
    top: 0,
    zIndex: 100,
    flexShrink: 0,
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    flex: 1,
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    fontSize: '20px',
    fontWeight: 800,
    letterSpacing: '0.2px',
    userSelect: 'none',
  },
  logo: {
    width: '36px',
    height: 'auto',
    display: 'block',
  },
  brandIKG: {
    color: '#E8FB1E',
  },
  brandRest: {
    color: '#e6edf7',
  },
  pageTitle: {
    color: '#9ba9c3',
    fontSize: '14px',
    paddingLeft: '12px',
    borderLeft: '1px solid #25344d',
  },
  backBtn: {
    background: 'transparent',
    border: '1px solid #25344d',
    borderRadius: '6px',
    color: '#9ba9c3',
    cursor: 'pointer',
    fontSize: '13px',
    padding: '6px 12px',
    transition: 'border-color 0.15s, color 0.15s',
  },
  nav: {
    display: 'flex',
    gap: '4px',
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
  },
  navBtn: {
    background: 'transparent',
    border: 'none',
    borderRadius: '6px',
    color: '#9ba9c3',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    padding: '6px 14px',
    transition: 'background 0.15s, color 0.15s',
  },
  navBtnActive: {
    background: 'rgba(228,93,37,0.15)',
    color: '#e45d25',
  },
  taskBadge: {
    position: 'relative',
    marginLeft: '5px',
    minWidth: '16px',
    height: '16px',
    borderRadius: '8px',
    background: '#2f7ff5',
    color: '#fff',
    fontSize: '10px',
    fontWeight: 800,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 4px',
    lineHeight: 1,
    animation: 'taskPulse 1.5s ease-in-out infinite',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flex: 1,
    justifyContent: 'flex-end',
  },
  userInfo: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '1px',
  },
  userRole: {
    fontSize: '10px',
    color: '#e45d25',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  userName: {
    fontSize: '13px',
    color: '#e6edf7',
    fontWeight: 600,
  },
  logoutBtn: {
    background: 'transparent',
    border: '1px solid #25344d',
    borderRadius: '6px',
    color: '#9ba9c3',
    cursor: 'pointer',
    fontSize: '12px',
    padding: '5px 12px',
    transition: 'border-color 0.15s, color 0.15s',
  },
};
