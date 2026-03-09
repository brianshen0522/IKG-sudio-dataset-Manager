import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getDatasetById, getJobById, resetJob } from '@/lib/db-datasets';
import { canManageJobs } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

// POST /api/datasets/:id/jobs/:jobId/reset
// Body: { keepData: boolean }
//   keepData=true  → status: unlabelled (label files on disk untouched)
//   keepData=false → status: unassigned (caller should clear label files separately)
export const POST = withApiLogging(async function handler(req, { params }) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const datasetId = Number(params.id);
  const jobId = Number(params.jobId);

  const dataset = await getDatasetById(datasetId);
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
  if (!canManageJobs(actor, dataset)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const job = await getJobById(jobId);
  if (!job || job.datasetId !== datasetId) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  let body = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const keepData = body.keepData !== false; // default: keep data

  try {
    const updated = await resetJob(jobId, Number(actor.sub), { keepData });
    return NextResponse.json({ job: updated });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
});
