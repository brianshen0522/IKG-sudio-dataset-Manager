'use client';

import { useState, useEffect } from 'react';
import { subscribeSSE } from '@/lib/shared-sse';

function forceLogout() {
  fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
    window.location.href = '/login';
  });
}

export function useCurrentUser() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dbOffline, setDbOffline] = useState(false);

  // Fetch current user on mount
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => {
        if (r.status === 503) { setDbOffline(true); return null; }
        if (r.status === 401) { forceLogout(); return null; }
        return r.ok ? r.json() : null;
      })
      .then((data) => {
        setUser(data?.user ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Open SSE connection once authenticated — immediately logs out on invalidate event
  useEffect(() => {
    if (!user) return;

    return subscribeSSE('/api/auth/stream', {
      invalidate: () => forceLogout(),
    });
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return { user, loading, dbOffline };
}
