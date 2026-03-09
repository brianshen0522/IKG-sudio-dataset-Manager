import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getDatasetById, deleteDataset, updateDatasetFields } from '@/lib/db-datasets';
import { canDeleteDataset, canUpdateDataset, canViewAll } from '@/lib/permissions';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/datasets/:id
export const GET = withApiLogging(async function handler(req, { params }) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const dataset = await getDatasetById(id);
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });

  if (!canViewAll(actor) && dataset.createdBy !== Number(actor.sub)) {
    // Allow if the user has at least one job assigned in this dataset
    const { rows } = await getPool().query(
      'SELECT 1 FROM jobs WHERE dataset_id = $1 AND assigned_to = $2 LIMIT 1',
      [id, Number(actor.sub)]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ dataset });
});

// PATCH /api/datasets/:id — update mutable settings (not path)
export const PATCH = withApiLogging(async function handler(req, { params }) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const dataset = await getDatasetById(id);
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
  if (!canUpdateDataset(actor, dataset)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updated = await updateDatasetFields(id, body);
  return NextResponse.json({ dataset: updated });
});

// DELETE /api/datasets/:id
export const DELETE = withApiLogging(async function handler(req, { params }) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const dataset = await getDatasetById(id);
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
  if (!canDeleteDataset(actor, dataset)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await deleteDataset(id);
  return NextResponse.json({ ok: true });
});
