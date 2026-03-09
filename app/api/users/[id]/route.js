import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getUserById, updateUser, deleteUser } from '@/lib/db';

const ALLOWED_ROLES = ['admin', 'data-manager', 'user'];

// PUT /api/users/:id — update user (admin only)
export const PUT = withApiLogging(async function handler(req, { params }) {
  const actor = await getUserFromRequest(req);
  if (!actor || actor.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { username, email, password, role, isActive } = body || {};
  if (role !== undefined && !ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: `role must be one of: ${ALLOWED_ROLES.join(', ')}` }, { status: 400 });
  }

  // Prevent disabling the system admin
  const target = await getUserById(id);
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  if (target.isSystemAdmin && isActive === false) {
    return NextResponse.json({ error: 'Cannot disable the system admin account' }, { status: 403 });
  }
  if (target.isSystemAdmin && role && role !== 'admin') {
    return NextResponse.json({ error: 'Cannot change the role of the system admin account' }, { status: 403 });
  }

  try {
    const user = await updateUser(id, { username, email, password, role, isActive });
    return NextResponse.json({ user });
  } catch (err) {
    if (err.code === '23505') {
      return NextResponse.json({ error: 'Username or email already in use' }, { status: 409 });
    }
    throw err;
  }
});

// DELETE /api/users/:id — delete user (admin only)
export const DELETE = withApiLogging(async function handler(req, { params }) {
  const actor = await getUserFromRequest(req);
  if (!actor || actor.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  // Prevent deleting yourself
  if (String(id) === String(actor.sub)) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 403 });
  }

  try {
    const deleted = await deleteUser(id);
    if (!deleted) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
});
