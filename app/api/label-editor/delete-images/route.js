import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getJobById } from '@/lib/db-datasets';
import { canEditJob } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export const POST = withApiLogging(async (req) => {
  try {
    const { basePath, images, jobId } = await req.json();

    // If jobId supplied, verify access
    if (jobId) {
      const actor = await getUserFromRequest(req);
      if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      const job = await getJobById(Number(jobId));
      if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      if (!canEditJob(actor, job)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!basePath || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json({ error: 'Missing basePath or images array' }, { status: 400 });
    }

    let deleted = 0;
    const errors = [];

    for (const imagePath of images) {
      try {
        const fullImagePath = path.join(basePath, imagePath);
        if (fs.existsSync(fullImagePath)) fs.unlinkSync(fullImagePath);

        const ext = path.extname(imagePath);
        const labelPath = imagePath.replace('images/', 'labels/').replace(ext, '.txt');
        const fullLabelPath = path.join(basePath, labelPath);
        if (fs.existsSync(fullLabelPath)) fs.unlinkSync(fullLabelPath);

        deleted++;
      } catch (err) {
        errors.push({ path: imagePath, error: err.message });
      }
    }

    return NextResponse.json({ deleted, errors });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});
