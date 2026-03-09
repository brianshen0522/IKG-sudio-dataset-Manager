import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getDatasetById, getJobById, getJobHistory } from '@/lib/db-datasets';
import { canManageJobs } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

// GET /api/datasets/:id/jobs/:jobId/history
export const GET = withApiLogging(async function handler(req, { params }) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const datasetId = Number(params.id);
  const jobId = Number(params.jobId);

  const dataset = await getDatasetById(datasetId);
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
  if (!canManageJobs(actor, dataset)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const job = await getJobById(jobId);
  if (!job || job.datasetId !== datasetId) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const history = await getJobHistory(jobId);
  return NextResponse.json({ history });
});
