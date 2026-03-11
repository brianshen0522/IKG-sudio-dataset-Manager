import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest, clearTokenCookie } from '@/lib/auth';
import { getUserById } from '@/lib/db';

export const GET = withApiLogging(async function handler(req) {
  const payload = await getUserFromRequest(req);
  if (!payload) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await getUserById(Number(payload.sub));
  if (!user || !user.isActive) {
    const res = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    res.headers.set('Set-Cookie', clearTokenCookie());
    return res;
  }

  // If token_version in JWT doesn't match DB, the session is stale (role changed / deactivated)
  const jwtVersion = Number(payload.tokenVersion ?? 1);
  if (jwtVersion !== user.tokenVersion) {
    const res = NextResponse.json({ error: 'session_invalidated' }, { status: 401 });
    res.headers.set('Set-Cookie', clearTokenCookie());
    return res;
  }

  return NextResponse.json({ user });
});
