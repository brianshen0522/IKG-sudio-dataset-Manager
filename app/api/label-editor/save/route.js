import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getDatasetById, getJobById, getLabelFileHash, updateLabelFileHashes, upsertLabelFileHash } from '@/lib/db-datasets';
import { buildJobEditorPaths, isJobLabelPathAllowed } from '@/lib/job-scope';
import { emitDatasetUpdated, emitUserJobsUpdated } from '@/lib/live-update-events';
import { hashLabelContent } from '@/lib/label-hash';
import { canEditJob } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export const POST = withApiLogging(async (req) => {
  try {
    const { jobId, imageName, content } = await req.json();

    if (!jobId || !imageName) {
      return NextResponse.json({ error: 'Missing jobId or imageName' }, { status: 400 });
    }

    const actor = await getUserFromRequest(req);
    if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const job = await getJobById(Number(jobId));
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    if (!canEditJob(actor, job)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const dataset = await getDatasetById(job.datasetId);
    if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });

    const { labelPathSet } = buildJobEditorPaths(dataset.datasetPath, job, 'images');
    const relativeLabelPath = `labels/${imageName.replace(/\.[^.]+$/i, '.txt')}`;

    if (!isJobLabelPathAllowed(relativeLabelPath, labelPathSet)) {
      return NextResponse.json({ error: 'Image is outside this job scope' }, { status: 403 });
    }

    const fullLabelPath = path.join(dataset.datasetPath, relativeLabelPath);
    const previousLabelContent = fs.existsSync(fullLabelPath)
      ? fs.readFileSync(fullLabelPath, 'utf-8')
      : '';
    fs.mkdirSync(path.dirname(fullLabelPath), { recursive: true });
    const labelContent = content || '';

    const labelFilename = path.basename(relativeLabelPath); // e.g. "frame_001.txt"
    const existingHash = await getLabelFileHash(dataset.id, job.id, labelFilename);
    if (
      existingHash?.initialHash &&
      existingHash.initialHash === existingHash.currentHash
    ) {
      const normalizedPreviousHash = hashLabelContent(previousLabelContent);
      if (normalizedPreviousHash !== existingHash.initialHash) {
        await updateLabelFileHashes(
          dataset.id,
          job.id,
          labelFilename,
          normalizedPreviousHash,
          normalizedPreviousHash
        );
      }
    }

    fs.writeFileSync(fullLabelPath, labelContent, 'utf-8');

    const currentHash = hashLabelContent(labelContent);
    await upsertLabelFileHash(dataset.id, job.id, labelFilename, currentHash);

    emitDatasetUpdated(dataset.id);
    if (job.assignedTo) {
      emitUserJobsUpdated(job.assignedTo);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});
