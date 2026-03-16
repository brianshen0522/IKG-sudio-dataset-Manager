import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getDatasetTypeById, updateDatasetType, deleteDatasetType } from '@/lib/db';

export const dynamic = 'force-dynamic';

// PATCH /api/settings/dataset-types/:id
export const PATCH = withApiLogging(async function handler(req, { params }) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (actor.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { uncheckPath, checkPath } = body || {};
  if (uncheckPath && checkPath && uncheckPath.trim() === checkPath.trim()) {
    return NextResponse.json({ error: 'Uncheck Path and Check Path cannot be the same' }, { status: 400 });
  }

  const type = await updateDatasetType(id, body);
  if (!type) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ type });
});

// DELETE /api/settings/dataset-types/:id
export const DELETE = withApiLogging(async function handler(req, { params }) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (actor.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const ok = await deleteDatasetType(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
});
