import { NextResponse } from 'next/server';
import { getTokenFromRequest, verifyToken } from '@/lib/auth';

// Paths that never require authentication
const PUBLIC_API_PATHS = ['/api/auth/login', '/api/auth/logout'];
const PUBLIC_PAGE_PATHS = ['/login'];

export async function middleware(req) {
  const { pathname } = req.nextUrl;

  // Always allow public paths
  if (
    PUBLIC_API_PATHS.some((p) => pathname.startsWith(p)) ||
    PUBLIC_PAGE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return NextResponse.next();
  }

  // Resolve user from JWT token
  const token = getTokenFromRequest(req);
  let user = null;
  if (token) {
    try {
      user = await verifyToken(token);
    } catch {
      // Token invalid or expired
    }
  }

  // --- HARD GUARD ---

  if (!user) {
    // API routes → 401 JSON
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Page routes → redirect to /login (preserve intended destination)
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated: inject user identity as headers for downstream routes
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-user-id', String(user.sub));
  requestHeaders.set('x-user-role', user.role);
  requestHeaders.set('x-user-name', user.username || '');

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg$|.*\\.png$|.*\\.ico$).*)']
};
