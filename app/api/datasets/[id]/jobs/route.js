import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getDatasetById, getJobsByDataset, getJobEditStats } from '@/lib/db-datasets';
import { annotateJobsWithImageCount } from '@/lib/dataset-utils';
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

  const [jobs, editStats] = await Promise.all([
    getJobsByDataset(id, { role: actor.role, userId: Number(actor.sub) }),
    getJobEditStats(id),
  ]);
  const annotated = annotateJobsWithImageCount(dataset.datasetPath, jobs).map((job) => {
    const stats = editStats.get(job.id) ?? { editedFiles: 0, deletedImages: 0 };
    return { ...job, editedFiles: stats.editedFiles, deletedImages: stats.deletedImages };
  });
  return NextResponse.json({ jobs: annotated });
});
