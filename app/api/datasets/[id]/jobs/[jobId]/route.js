import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getJobById } from '@/lib/db-datasets';
import { canAccessJob } from '@/lib/permissions';
import { getJobFilenames, scanImageFilenames } from '@/lib/dataset-utils';
import { getDatasetById } from '@/lib/db-datasets';

export const dynamic = 'force-dynamic';

// GET /api/datasets/:id/jobs/:jobId
export const GET = withApiLogging(async function handler(req, { params }) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const jobId = Number(params.jobId);
  if (!jobId) return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 });

  const job = await getJobById(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  if (!canAccessJob(actor, job)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Optionally include the image filename list
  const { searchParams } = new URL(req.url);
  let filenames = undefined;
  if (searchParams.get('includeFiles') === 'true') {
    const dataset = await getDatasetById(Number(params.id));
    if (dataset) {
      const all = scanImageFilenames(dataset.datasetPath);
      filenames = getJobFilenames(all, job.imageStart, job.imageEnd);
    }
  }

  return NextResponse.json({ job, filenames });
});
