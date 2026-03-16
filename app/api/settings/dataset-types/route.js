import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getAllDatasetTypes, createDatasetType } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/settings/dataset-types
export const GET = withApiLogging(async function handler(req) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (actor.role !== 'admin' && actor.role !== 'data-manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const types = await getAllDatasetTypes();
  return NextResponse.json({ types });
});

// POST /api/settings/dataset-types
export const POST = withApiLogging(async function handler(req) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (actor.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { name, uncheckPath, checkPath } = body || {};
  if (!name || !uncheckPath || !checkPath) {
    return NextResponse.json({ error: 'name, uncheckPath, and checkPath are required' }, { status: 400 });
  }
  if (uncheckPath.trim() === checkPath.trim()) {
    return NextResponse.json({ error: 'Uncheck Path and Check Path cannot be the same' }, { status: 400 });
  }

  const type = await createDatasetType({ name, uncheckPath, checkPath });
  return NextResponse.json({ type }, { status: 201 });
});
