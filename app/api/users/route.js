import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getAllUsers, createUser } from '@/lib/db';

const ALLOWED_ROLES = ['admin', 'data-manager', 'user'];

// GET /api/users — list all users (admin only)
export const GET = withApiLogging(async function handler(req) {
  const actor = await getUserFromRequest(req);
  if (!actor || actor.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const users = await getAllUsers();
  return NextResponse.json({ users });
});

// POST /api/users — create user (admin only)
export const POST = withApiLogging(async function handler(req) {
  const actor = await getUserFromRequest(req);
  if (!actor || actor.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { username, email, password, role } = body || {};
  if (!username || !password) {
    return NextResponse.json({ error: 'username and password are required' }, { status: 400 });
  }
  if (role && !ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: `role must be one of: ${ALLOWED_ROLES.join(', ')}` }, { status: 400 });
  }

  try {
    const user = await createUser({ username, email, password, role });
    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    if (err.code === '23505') {
      return NextResponse.json({ error: 'Username or email already in use' }, { status: 409 });
    }
    throw err;
  }
});
