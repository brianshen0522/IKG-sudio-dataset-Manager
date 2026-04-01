import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getDatasetById, getJobById, listEditedLabelFilenames } from '@/lib/db-datasets';
import { buildJobEditorPaths } from '@/lib/job-scope';
import { canAccessJob } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

function stem(filename) {
  return String(filename || '').replace(/\.[^.]+$/, '');
}

export const GET = withApiLogging(async function handler(req, { params }) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const datasetId = Number(params.id);
  const jobId = Number(params.jobId);
  if (!datasetId || !jobId) {
    return NextResponse.json({ error: 'Invalid dataset or job id' }, { status: 400 });
  }

  const [dataset, job] = await Promise.all([
    getDatasetById(datasetId),
    getJobById(jobId),
  ]);
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
  if (!job || Number(job.datasetId) !== datasetId) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }
  if (!canAccessJob(actor, job)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const editedLabelFilenames = await listEditedLabelFilenames(jobId);
  const scoped = buildJobEditorPaths(dataset.datasetPath, job, 'images');
  const imageByStem = new Map(scoped.filenames.map((filename) => [stem(filename), filename]));

  const images = editedLabelFilenames.map((labelFilename) => {
    const imageName = imageByStem.get(stem(labelFilename));
    return {
      labelFilename,
      imageName: imageName || null,
      missingImage: !imageName,
    };
  });

  return NextResponse.json({ images });
});
