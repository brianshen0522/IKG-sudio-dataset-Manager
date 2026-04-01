import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getDatasetById, getDatasetByPath, getJobById, refreshDatasetImageStats, recordImageDeletion, deleteLabelFileHash } from '@/lib/db-datasets';
import { buildJobEditorPaths, isJobImagePathAllowed, scanFolderImagePaths } from '@/lib/job-scope';
import { emitDatasetUpdated, emitUserJobsUpdated } from '@/lib/live-update-events';
import { canEditJob } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

function inferDatasetPath(basePath, imagePath, view) {
  if (!basePath || !imagePath) return null;
  const normalizedImagePath = String(imagePath).replace(/\\/g, '/');
  const marker = view === 'duplicates' ? '/duplicate/images/' : '/images/';
  const markerIndex = normalizedImagePath.indexOf(marker);
  if (markerIndex === -1) return null;
  const datasetRelativePath = normalizedImagePath.slice(0, markerIndex);
  return path.resolve(path.join(basePath, datasetRelativePath));
}

export const POST = withApiLogging(async (req) => {
  try {
    const { basePath, images, imageNames, jobId, view } = await req.json();
    let resolvedBasePath = basePath;
    let resolvedImages = images;
    let dataset = null;
    let actor = null;
    let resolvedJobId = jobId ? Number(jobId) : null;

    // Job-based mode: { jobId, imageNames } — filenames only, no basePath needed
    if (jobId && imageNames) {
      actor = await getUserFromRequest(req);
      if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      const job = await getJobById(Number(jobId));
      if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      if (!canEditJob(actor, job)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

      dataset = await getDatasetById(job.datasetId);
      if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });

      const folder = view === 'duplicates' ? 'duplicate/images' : 'images';
      const { imagePathSet } = view === 'duplicates'
        ? scanFolderImagePaths(dataset.datasetPath, folder)
        : buildJobEditorPaths(dataset.datasetPath, job, folder);

      resolvedBasePath = dataset.datasetPath;
      resolvedImages = imageNames
        .filter((n) => imagePathSet.has(`${folder}/${n}`))
        .map((n) => `${folder}/${n}`);
    } else {
      // Legacy path-based mode
      if (!resolvedBasePath || !Array.isArray(resolvedImages) || resolvedImages.length === 0) {
        return NextResponse.json({ error: 'Missing basePath or images array' }, { status: 400 });
      }
      if (!dataset) {
        const inferredDatasetPath = inferDatasetPath(resolvedBasePath, resolvedImages[0], view);
        if (inferredDatasetPath) {
          dataset = await getDatasetByPath(inferredDatasetPath);
        }
      }
    }

    let deleted = 0;
    const errors = [];

    for (const imagePath of resolvedImages) {
      try {
        const fullImagePath = path.join(resolvedBasePath, imagePath);
        if (fs.existsSync(fullImagePath)) fs.unlinkSync(fullImagePath);

        const ext = path.extname(imagePath);
        const labelPath = imagePath.replace('images/', 'labels/').replace(ext, '.txt');
        const fullLabelPath = path.join(resolvedBasePath, labelPath);
        if (fs.existsSync(fullLabelPath)) fs.unlinkSync(fullLabelPath);

        deleted++;

        // Record deletion for edit statistics (job-based mode only).
        if (resolvedJobId && dataset?.id) {
          const imageName = path.basename(imagePath);
          const labelFilename = path.basename(labelPath);
          await deleteLabelFileHash(dataset.id, resolvedJobId, labelFilename);
          await recordImageDeletion(dataset.id, resolvedJobId, imageName, actor?.sub ? Number(actor.sub) : null);
        }
      } catch (err) {
        errors.push({ path: imagePath, error: err.message });
      }
    }

    if (deleted > 0 && dataset?.id) {
      await refreshDatasetImageStats(dataset.id);
      emitDatasetUpdated(dataset.id);
      if (resolvedJobId) {
        const job = await getJobById(resolvedJobId);
        if (job?.assignedTo) emitUserJobsUpdated(job.assignedTo);
      }
    }

    return NextResponse.json({ deleted, errors });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});
