import { NextResponse } from 'next/server';
import path from 'path';
import { CONFIG } from '@/lib/manager';
import { getInstanceByName } from '@/lib/db';
import { getJobById, getDatasetById, getJobUserState, startJob } from '@/lib/db-datasets';
import { getUserFromRequest } from '@/lib/auth';
import { canAccessJob, canViewAll, canEditJob } from '@/lib/permissions';
import fs from 'fs';
import { buildJobEditorPaths, scanFolderImagePaths } from '@/lib/job-scope';
import { withApiLogging } from '@/lib/api-logger';

export const dynamic = 'force-dynamic';

function buildDatasetFolder(datasetPath) {
  const basePath = path.resolve(CONFIG.datasetBasePath).replace(/\/+$/, '');
  let folder = '';
  if (datasetPath.startsWith(`${basePath}/`)) {
    const rel = datasetPath.slice(basePath.length + 1).replace(/\/+$/, '');
    folder = rel.endsWith('/images') || rel === 'images' ? rel : `${rel}/images`;
  } else {
    folder = path.join(datasetPath, 'images');
  }
  return { basePath, folder };
}

export const GET = withApiLogging(async (req) => {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');
    const datasetId = searchParams.get('datasetId');
    const view = searchParams.get('view') || '';

    // ---- New: job-based config ----
    if (jobId) {
      const actor = await getUserFromRequest(req);
      if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      const job = await getJobById(Number(jobId));
      if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      if (!canAccessJob(actor, job)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

      const dataset = await getDatasetById(job.datasetId);
      if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });

      // Auto-transition unlabelled → labeling when the assigned user opens the editor
      if (job.status === 'unlabelled' && job.assignedTo === Number(actor.sub)) {
        try { await startJob(job.id, Number(actor.sub)); } catch { /* ignore race conditions */ }
      }

      const userState = await getJobUserState(Number(jobId), Number(actor.sub));

      const datasetPath = dataset.datasetPath || '';
      const isDuplicateView = view === 'duplicates';
      const { basePath: datasetBasePath, folder: datasetFolder } = buildDatasetFolder(datasetPath);
      const folder = isDuplicateView ? 'duplicate/images' : datasetFolder;

      let filenames = [];
      let imageMeta = {};
      if (isDuplicateView) {
        const scanned = scanFolderImagePaths(datasetPath, 'duplicate/images');
        filenames = scanned.imagePaths.map((p) => p.split('/').pop());
        for (const [p, meta] of Object.entries(scanned.imageMeta)) {
          imageMeta[p.split('/').pop()] = meta;
        }
      } else {
        const built = buildJobEditorPaths(datasetPath, job, 'images');
        filenames = built.filenames;
        for (const filename of built.filenames) {
          const fullImagePath = path.join(datasetPath, 'images', filename);
          try {
            const stat = fs.statSync(fullImagePath);
            imageMeta[filename] = {
              ctimeMs: stat.birthtimeMs || stat.ctimeMs,
              mtimeMs: stat.mtimeMs
            };
          } catch {
            // Ignore unreadable files; the editor can still operate without timestamps.
          }
        }
      }

      return NextResponse.json({
        jobId: job.id,
        jobIndex: job.jobIndex,
        datasetId: dataset.id,
        view,
        imageStart: job.imageStart,
        imageEnd: job.imageEnd,
        totalImagesInJob: filenames.length,
        images: filenames,
        imageMeta,
        obbMode: dataset.obbMode || 'rectangle',
        labelEditorPreloadCount: CONFIG.labelEditorPreloadCount,
        lastImagePath: userState?.lastImagePath || '',
        canEdit: canEditJob(actor, job),
        canDelete: !isDuplicateView && canEditJob(actor, job),
      });
    }

    if (datasetId) {
      const actor = await getUserFromRequest(req);
      if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      const dataset = await getDatasetById(Number(datasetId));
      if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
      if (!canViewAll(actor) && dataset.createdBy !== Number(actor.sub)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const datasetPath = dataset.datasetPath || '';
      const isDuplicateView = view === 'duplicates';
      const folder = isDuplicateView ? 'duplicate/images' : 'images';
      const scanned = isDuplicateView ? scanFolderImagePaths(datasetPath, folder) : null;

      return NextResponse.json({
        datasetId: dataset.id,
        basePath: datasetPath,
        folder,
        datasetPath,
        view,
        images: scanned?.imagePaths || [],
        imageMeta: scanned?.imageMeta || {},
        obbMode: dataset.obbMode || 'rectangle',
        classFile: dataset.classFile || null,
        labelEditorPreloadCount: CONFIG.labelEditorPreloadCount,
        canDelete: !isDuplicateView,
      });
    }

    // ---- Path-based config (admin/DM only, e.g. duplicate subfolder) ----
    const rawPath = searchParams.get('path');
    if (rawPath) {
      const actor = await getUserFromRequest(req);
      if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      if (!canViewAll(actor)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

      const resolved = path.resolve(rawPath);
      const base = path.resolve(CONFIG.datasetBasePath);
      if (!resolved.startsWith(base + path.sep) && resolved !== base) {
        return NextResponse.json({ error: 'Path outside allowed base' }, { status: 403 });
      }

      const { basePath, folder } = buildDatasetFolder(resolved);
      return NextResponse.json({
        basePath,
        folder,
        datasetPath: resolved,
        obbMode: 'rectangle',
        classFile: null,
        labelEditorPreloadCount: CONFIG.labelEditorPreloadCount,
      });
    }

    // ---- Legacy: instance-name-based config ----
    const name = searchParams.get('name');
    if (!name) return NextResponse.json({ error: 'Missing jobId, datasetId, or name' }, { status: 400 });

    const instance = await getInstanceByName(name);
    if (!instance) return NextResponse.json({ error: `Instance not found: ${name}` }, { status: 404 });

    const datasetPath = instance.datasetPath || '';
    const { basePath, folder } = buildDatasetFolder(datasetPath);

    return NextResponse.json({
      basePath,
      folder,
      obbMode: instance.obbMode || 'rectangle',
      lastImagePath: instance.lastImagePath || '',
      instanceName: instance.name,
      labelEditorPreloadCount: CONFIG.labelEditorPreloadCount
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});
