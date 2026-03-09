import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getJobById, completeJob } from '@/lib/db-datasets';
import { canAccessJob } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

// POST /api/datasets/:id/jobs/:jobId/complete
export const POST = withApiLogging(async function handler(req, { params }) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const jobId = Number(params.jobId);
  const job = await getJobById(jobId);
  if (!job || job.datasetId !== Number(params.id)) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  if (!canAccessJob(actor, job)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const updated = await completeJob(jobId, Number(actor.sub));
    return NextResponse.json({ job: updated });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
});
