'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const from = searchParams.get('from') || '/';

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }
      router.push(from);
      router.refresh();
    } catch {
      setError('Network error, please try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Logo + Title */}
        <div style={styles.header}>
          <img src="/ikg-logo.svg" alt="IKG logo" style={styles.logo} />
          <div style={styles.titleRow}>
            <span style={styles.titleHighlight}>IKG</span>
            <span style={styles.titleRest}> Studio</span>
          </div>
          <p style={styles.subtitle}>Dataset Manager</p>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={styles.input}
              autoComplete="username"
              autoFocus
              required
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label} htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              autoComplete="current-password"
              required
            />
          </div>

          {error && <p style={styles.error}>{error}</p>}

          <button type="submit" style={styles.button} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

const styles = {
  container: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'radial-gradient(circle at 20% 20%, #15233a, #0a111f 50%), radial-gradient(circle at 80% 0%, #12213a, #0a111f 40%), #0d1626',
    fontFamily: '"Nunito Sans", "Segoe UI", system-ui, -apple-system, sans-serif'
  },
  card: {
    background: '#152033',
    border: '1px solid #25344d',
    borderRadius: '16px',
    padding: '2.5rem 2rem',
    width: '100%',
    maxWidth: '380px',
    boxShadow: '0 12px 40px rgba(0,0,0,0.6)'
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '2rem'
  },
  logo: {
    width: '110px',
    height: 'auto',
    filter: 'drop-shadow(0 4px 16px rgba(0,0,0,0.5))',
    marginBottom: '0.5rem'
  },
  titleRow: {
    fontSize: '1.75rem',
    fontWeight: 800,
    letterSpacing: '0.2px',
    lineHeight: 1.1
  },
  titleHighlight: {
    color: '#E8FB1E'
  },
  titleRest: {
    color: '#e6edf7'
  },
  subtitle: {
    color: '#9ba9c3',
    fontSize: '0.88rem',
    margin: 0
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem'
  },
  label: {
    color: '#9ba9c3',
    fontSize: '0.85rem',
    fontWeight: 600
  },
  input: {
    background: '#0d1626',
    border: '1px solid #25344d',
    borderRadius: '8px',
    color: '#e6edf7',
    fontSize: '0.95rem',
    padding: '0.65rem 0.85rem',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s'
  },
  error: {
    color: '#f87171',
    fontSize: '0.85rem',
    margin: '0',
    padding: '0.5rem 0.75rem',
    background: 'rgba(248,113,113,0.08)',
    borderRadius: '6px',
    border: '1px solid rgba(248,113,113,0.2)'
  },
  button: {
    background: '#e45d25',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '0.95rem',
    fontWeight: 700,
    marginTop: '0.5rem',
    padding: '0.75rem',
    transition: 'background 0.15s',
    width: '100%',
    letterSpacing: '0.3px'
  }
};
