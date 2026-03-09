import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getDatasetById, getJobById, unassignJob } from '@/lib/db-datasets';
import { canManageJobs, canSelfUnassign } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

// POST /api/datasets/:id/jobs/:jobId/unassign
export const POST = withApiLogging(async function handler(req, { params }) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const jobId = Number(params.jobId);
  const datasetId = Number(params.id);

  const dataset = await getDatasetById(datasetId);
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });

  const job = await getJobById(jobId);
  if (!job || job.datasetId !== datasetId) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  if (!canManageJobs(actor, dataset) && !canSelfUnassign(actor, job)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const updated = await unassignJob(jobId, Number(actor.sub));
    return NextResponse.json({ job: updated });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
});
