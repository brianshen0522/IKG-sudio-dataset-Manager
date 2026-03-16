import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getSetting } from '@/lib/db';
import { createDataset, getAllDatasets } from '@/lib/db-datasets';
import { canCreateDataset } from '@/lib/permissions';
import { getBoss, ensureBossStarted } from '@/lib/pg-boss';

export const dynamic = 'force-dynamic';

// GET /api/datasets — list datasets (filtered by role)
export const GET = withApiLogging(async function handler(req) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const datasets = await getAllDatasets({ role: actor.role, userId: Number(actor.sub) });
  return NextResponse.json({ datasets });
});

// POST /api/datasets — create a new dataset
export const POST = withApiLogging(async function handler(req) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canCreateDataset(actor)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { datasetPath, displayName, threshold, debug, pentagonFormat, obbMode, classFile, duplicateMode, duplicateLabels, typeId } = body || {};
  if (!datasetPath) {
    return NextResponse.json({ error: 'datasetPath is required' }, { status: 400 });
  }

  // Snapshot current job_size from system_settings at creation time
  const rawJobSize = await getSetting('job_size');
  const jobSize = parseInt(rawJobSize || '500', 10);

  try {
    const result = await createDataset({
      datasetPath,
      displayName,
      createdBy: Number(actor.sub),
      jobSize,
      threshold: threshold ?? 0.8,
      debug: debug ?? false,
      pentagonFormat: pentagonFormat ?? false,
      obbMode: obbMode || 'rectangle',
      classFile: classFile || null,
      duplicateMode: duplicateMode || 'move',
      duplicateLabels: duplicateLabels ?? 0,
      typeId: typeId || null
    });

    // Enqueue duplicate scan via pg-boss
    try {
      await ensureBossStarted();
      const boss = getBoss();
      // pg-boss v10: send() takes a single object { name, data }
      const jobId = await boss.send({
        name: 'duplicate-scan',
        data: {
          datasetId: result.dataset.id,
          datasetPath: result.dataset.datasetPath,
          datasetName: result.dataset.displayName || null,
          createdBy: Number(actor.sub),
          duplicateMode: duplicateMode || 'move',
          duplicateLabels: duplicateLabels ?? 0,
          threshold: threshold ?? 0.8,
          debug: debug ?? false,
        },
      });
      if (!jobId) console.error('[pg-boss] send returned null — queue may not exist');
      else console.log('[pg-boss] duplicate-scan enqueued:', jobId);
    } catch (bossErr) {
      console.error('[pg-boss] failed to enqueue duplicate-scan:', bossErr.message);
      // Dataset was created successfully — don't fail the request over the queue
    }

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err.code === '23505') {
      return NextResponse.json({ error: 'A dataset with this path already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});
