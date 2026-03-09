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
    const body = await req.json();
    const { labelPath, content, basePath, relativeLabelPath, jobId } = body;

    // If jobId supplied, verify access
    if (jobId) {
      const actor = await getUserFromRequest(req);
      if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      const job = await getJobById(Number(jobId));
      if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      if (!canEditJob(actor, job)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let fullLabelPath = labelPath;
    if (basePath && relativeLabelPath) {
      fullLabelPath = path.join(basePath, relativeLabelPath);
    }
    if (!fullLabelPath) {
      return NextResponse.json({ error: 'Missing label path' }, { status: 400 });
    }

    const labelDir = path.dirname(fullLabelPath);
    if (!fs.existsSync(labelDir)) {
      fs.mkdirSync(labelDir, { recursive: true });
    }
    fs.writeFileSync(fullLabelPath, content || '', 'utf-8');

    return NextResponse.json({ success: true, message: 'Labels saved successfully' });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});
