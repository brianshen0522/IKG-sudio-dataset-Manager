import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getDatasetById, getJobById, assignJob } from '@/lib/db-datasets';
import { canManageJobs, canSelfAssign } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

// POST /api/datasets/:id/jobs/:jobId/assign
// Body: { userId } — if omitted, assigns to the calling user (self-assign)
export const POST = withApiLogging(async function handler(req, { params }) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const jobId = Number(params.jobId);
  const datasetId = Number(params.id);

  const dataset = await getDatasetById(datasetId);
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });

  const job = await getJobById(jobId);
  if (!job || job.datasetId !== datasetId) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  let body = {};
  try { body = await req.json(); } catch { /* no body = self-assign */ }

  const targetUserId = body.userId ? Number(body.userId) : Number(actor.sub);
  const isSelfAssign = targetUserId === Number(actor.sub);

  // Permission: admin/DM can assign to anyone; regular user can only self-assign
  if (!isSelfAssign && !canManageJobs(actor, dataset)) {
    return NextResponse.json({ error: 'Forbidden: only admin or data-manager can assign to other users' }, { status: 403 });
  }
  if (isSelfAssign && !canSelfAssign(actor)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const updated = await assignJob(jobId, targetUserId, Number(actor.sub));
    return NextResponse.json({ job: updated });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
});
