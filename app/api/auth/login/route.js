import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { verifyUserPassword } from '@/lib/db';
import { signToken, makeTokenCookie } from '@/lib/auth';

export const POST = withApiLogging(async function handler(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { username, password } = body || {};
  if (!username || !password) {
    return NextResponse.json({ error: 'username and password are required' }, { status: 400 });
  }

  const user = await verifyUserPassword(username, password);
  if (!user) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const token = await signToken({
    sub: String(user.id),
    username: user.username,
    role: user.role,
    isSystemAdmin: user.isSystemAdmin
  });

  const res = NextResponse.json({ user });
  res.headers.set('Set-Cookie', makeTokenCookie(token));
  return res;
});
