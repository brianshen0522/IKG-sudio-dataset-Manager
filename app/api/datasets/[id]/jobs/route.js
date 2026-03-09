import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getDatasetById, getJobsByDataset } from '@/lib/db-datasets';
import { canViewAll } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

// GET /api/datasets/:id/jobs
export const GET = withApiLogging(async function handler(req, { params }) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const dataset = await getDatasetById(id);
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });

  const jobs = await getJobsByDataset(id, { role: actor.role, userId: Number(actor.sub) });
  return NextResponse.json({ jobs });
});
