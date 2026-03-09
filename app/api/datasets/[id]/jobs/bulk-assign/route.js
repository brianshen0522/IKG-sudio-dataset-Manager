import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getDatasetById, assignJob } from '@/lib/db-datasets';
import { canManageJobs } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

// POST /api/datasets/:id/jobs/bulk-assign
// Body: { jobIds: number[], userId: number }
export const POST = withApiLogging(async function handler(req, { params }) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const datasetId = Number(params.id);
  const dataset = await getDatasetById(datasetId);
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
  if (!canManageJobs(actor, dataset)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body = {};
  try { body = await req.json(); } catch {}

  const { jobIds, userId } = body;
  if (!Array.isArray(jobIds) || jobIds.length === 0) {
    return NextResponse.json({ error: 'jobIds must be a non-empty array' }, { status: 400 });
  }
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  const results = [];
  const errors = [];

  for (const jobId of jobIds) {
    try {
      const updated = await assignJob(Number(jobId), Number(userId), Number(actor.sub));
      results.push(updated);
    } catch (err) {
      errors.push({ jobId, error: err.message });
    }
  }

  return NextResponse.json({ assigned: results, errors });
});
