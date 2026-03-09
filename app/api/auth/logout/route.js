import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { clearTokenCookie } from '@/lib/auth';

export const POST = withApiLogging(async function handler() {
  const res = NextResponse.json({ ok: true });
  res.headers.set('Set-Cookie', clearTokenCookie());
  return res;
});
