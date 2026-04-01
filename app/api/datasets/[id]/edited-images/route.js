import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getDatasetById, getJobsByDataset, listEditedLabelFilenames } from '@/lib/db-datasets';
import { buildJobEditorPaths } from '@/lib/job-scope';
import { canViewAll } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

function stem(filename) {
  return String(filename || '').replace(/\.[^.]+$/, '');
}

export const GET = withApiLogging(async function handler(req, { params }) {
  const actor = await getUserFromRequest(req);
  if (!canViewAll(actor)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const datasetId = Number(params.id);
  if (!datasetId) return NextResponse.json({ error: 'Invalid dataset id' }, { status: 400 });

  const dataset = await getDatasetById(datasetId);
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });

  const jobs = await getJobsByDataset(datasetId, { role: actor.role, userId: Number(actor.sub) });
  const images = [];

  for (const job of jobs) {
    const editedLabelFilenames = await listEditedLabelFilenames(job.id);
    if (editedLabelFilenames.length === 0) continue;

    const scoped = buildJobEditorPaths(dataset.datasetPath, job, 'images');
    const imageByStem = new Map(scoped.filenames.map((filename) => [stem(filename), filename]));

    for (const labelFilename of editedLabelFilenames) {
      const imageName = imageByStem.get(stem(labelFilename));
      images.push({
        jobId: job.id,
        jobIndex: job.jobIndex,
        labelFilename,
        imageName: imageName || null,
        missingImage: !imageName,
      });
    }
  }

  images.sort((a, b) => {
    if (a.jobIndex !== b.jobIndex) return a.jobIndex - b.jobIndex;
    return String(a.imageName || a.labelFilename).localeCompare(String(b.imageName || b.labelFilename));
  });

  return NextResponse.json({ images });
});
