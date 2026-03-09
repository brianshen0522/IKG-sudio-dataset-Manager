import { NextResponse } from 'next/server';
import path from 'path';
import { CONFIG } from '@/lib/manager';
import { getInstanceByName } from '@/lib/db';
import { getJobById, getDatasetById, getJobUserState } from '@/lib/db-datasets';
import { getUserFromRequest } from '@/lib/auth';
import { canAccessJob } from '@/lib/permissions';
import { scanImageFilenames, getJobFilenames } from '@/lib/dataset-utils';
import { withApiLogging } from '@/lib/api-logger';

export const dynamic = 'force-dynamic';

export const GET = withApiLogging(async (req) => {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');

    // ---- New: job-based config ----
    if (jobId) {
      const actor = await getUserFromRequest(req);
      if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      const job = await getJobById(Number(jobId));
      if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      if (!canAccessJob(actor, job)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

      const dataset = await getDatasetById(job.datasetId);
      if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });

      const userState = await getJobUserState(Number(jobId), Number(actor.sub));

      // Build folder path relative to CONFIG.datasetBasePath
      const basePath = path.resolve(CONFIG.datasetBasePath).replace(/\/+$/, '');
      const datasetPath = dataset.datasetPath || '';
      let folder = '';
      if (datasetPath.startsWith(`${basePath}/`)) {
        const rel = datasetPath.slice(basePath.length + 1).replace(/\/+$/, '');
        folder = rel.endsWith('/images') || rel === 'images' ? rel : `${rel}/images`;
      } else {
        folder = path.join(datasetPath, 'images');
      }

      // Image list for this job
      const allFilenames = scanImageFilenames(datasetPath);
      const jobFilenames = getJobFilenames(allFilenames, job.imageStart, job.imageEnd);

      return NextResponse.json({
        // Job identity
        jobId: job.id,
        jobIndex: job.jobIndex,
        datasetId: dataset.id,
        // Paths
        basePath,
        folder,
        datasetPath,
        // Job range
        imageStart: job.imageStart,
        imageEnd: job.imageEnd,
        totalImagesInJob: jobFilenames.length,
        // Settings
        obbMode: dataset.obbMode || 'rectangle',
        classFile: dataset.classFile || null,
        labelEditorPreloadCount: CONFIG.labelEditorPreloadCount,
        // Per-user state
        lastImagePath: userState?.lastImagePath || ''
      });
    }

    // ---- Legacy: instance-name-based config ----
    const name = searchParams.get('name');
    if (!name) return NextResponse.json({ error: 'Missing jobId or name' }, { status: 400 });

    const instance = await getInstanceByName(name);
    if (!instance) return NextResponse.json({ error: `Instance not found: ${name}` }, { status: 404 });

    const basePath = path.resolve(CONFIG.datasetBasePath).replace(/\/+$/, '');
    const datasetPath = instance.datasetPath || '';
    let folder = '';
    if (datasetPath.startsWith(`${basePath}/`)) {
      const relativePath = datasetPath.slice(basePath.length + 1).replace(/\/+$/, '');
      folder = relativePath.endsWith('/images') || relativePath === 'images'
        ? relativePath
        : `${relativePath}/images`;
    }

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
