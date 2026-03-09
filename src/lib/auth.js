import { SignJWT, jwtVerify } from 'jose';

const COOKIE_NAME = 'token';
const EXPIRY = '8h';

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET environment variable is not set');
  return new TextEncoder().encode(s);
}

export async function signToken(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(getSecret());
}

export async function verifyToken(token) {
  const { payload } = await jwtVerify(token, getSecret());
  return payload;
}

export function getTokenFromRequest(req) {
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
  if (match) return decodeURIComponent(match[1]);

  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);

  return null;
}

export function makeTokenCookie(token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${8 * 3600}`;
}

export function clearTokenCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

/**
 * Extract and verify the current user from a request (verifies JWT).
 * Use this in auth-related routes or when you need the full JWT payload.
 * Returns JWT payload or null if not authenticated.
 */
export async function getUserFromRequest(req) {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  try {
    return await verifyToken(token);
  } catch {
    return null;
  }
}

/**
 * Read user identity from middleware-injected headers (no JWT re-verification).
 * Use this in regular API routes after the middleware hard-guard is in place.
 * Returns { sub, username, role } or null if headers are absent.
 */
export function getUserFromHeaders(req) {
  const id = req.headers.get('x-user-id');
  const role = req.headers.get('x-user-role');
  const username = req.headers.get('x-user-name');
  if (!id || !role) return null;
  return { sub: id, username: username || '', role };
}
