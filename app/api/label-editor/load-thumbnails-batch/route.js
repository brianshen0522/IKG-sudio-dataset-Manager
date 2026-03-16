import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { withApiLogging } from '@/lib/api-logger';
import { getInstanceByName } from '@/lib/db';
import { CONFIG } from '@/lib/manager';
import { getUserFromRequest } from '@/lib/auth';
import { getDatasetById, getJobById } from '@/lib/db-datasets';
import { buildJobEditorPaths, isJobImagePathAllowed, scanFolderImagePaths } from '@/lib/job-scope';
import { canAccessJob } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export const POST = withApiLogging(async (req) => {
  try {
    const { basePath, imagePaths, imageNames, instanceName, maxSize, jobId, view } = await req.json();

    let resolvedBasePath = basePath;
    let resolvedImagePaths = imagePaths;

    // Job-based mode: { jobId, imageNames } — no basePath needed from client
    if (jobId && imageNames) {
      const actor = await getUserFromRequest(req);
      if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      const job = await getJobById(Number(jobId));
      if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      if (!canAccessJob(actor, job)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

      const dataset = await getDatasetById(job.datasetId);
      if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });

      const folder = view === 'duplicates' ? 'duplicate/images' : 'images';
      const { imagePathSet } = view === 'duplicates'
        ? scanFolderImagePaths(dataset.datasetPath, folder)
        : buildJobEditorPaths(dataset.datasetPath, job, folder);

      resolvedBasePath = dataset.datasetPath;
      resolvedImagePaths = imageNames
        .filter((n) => imagePathSet.has(`${folder}/${n}`))
        .map((n) => `${folder}/${n}`);
    } else {
      if (!resolvedBasePath && instanceName) {
        const instance = await getInstanceByName(instanceName);
        if (!instance) {
          return NextResponse.json({ error: `Instance not found: ${instanceName}` }, { status: 404 });
        }
        resolvedBasePath = instance.datasetPath;
      }
      if (!resolvedBasePath) {
        return NextResponse.json({ error: 'Missing basePath or instanceName' }, { status: 400 });
      }
      if (!Array.isArray(resolvedImagePaths)) {
        return NextResponse.json({ error: 'Missing imagePaths array' }, { status: 400 });
      }
    }

    const baseResolved = path.resolve(resolvedBasePath);
    const basePrefix = `${baseResolved}${path.sep}`;
    const resolvedMaxSize = Number.isFinite(parseInt(maxSize, 10)) ? parseInt(maxSize, 10) : 512;

    const boundary = '----ThumbnailBatch';
    const parts = [];

    for (const imagePath of resolvedImagePaths) {
      if (!imagePath || typeof imagePath !== 'string') {
        continue;
      }
      const fullPath = path.resolve(path.join(baseResolved, imagePath));
      if (!fullPath.startsWith(basePrefix)) {
        continue;
      }
      let buffer;
      try {
        buffer = await fs.promises.readFile(fullPath);
      } catch {
        continue;
      }
      const safeName = encodeURIComponent(imagePath);

      if (CONFIG.thumbnailQuality >= 100) {
        const ext = path.extname(fullPath).toLowerCase();
        const mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        const header = `--${boundary}\r\nContent-Disposition: form-data; name="${safeName}"\r\nContent-Type: ${contentType}\r\nContent-Length: ${buffer.length}\r\n\r\n`;
        parts.push(Buffer.from(header));
        parts.push(buffer);
      } else {
        const resized = await sharp(buffer)
          .resize({
            width: resolvedMaxSize,
            height: resolvedMaxSize,
            fit: 'inside',
            withoutEnlargement: true
          })
          .jpeg({ quality: CONFIG.thumbnailQuality })
          .toBuffer();
        const header = `--${boundary}\r\nContent-Disposition: form-data; name="${safeName}"\r\nContent-Type: image/jpeg\r\nContent-Length: ${resized.length}\r\n\r\n`;
        parts.push(Buffer.from(header));
        parts.push(resized);
      }
      parts.push(Buffer.from('\r\n'));
    }

    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(parts);

    return new Response(body, {
      headers: {
        'Content-Type': `multipart/mixed; boundary=${boundary}`,
      }
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});
