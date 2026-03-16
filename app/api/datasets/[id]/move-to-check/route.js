import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getDatasetById, updateDatasetMoveStatus } from '@/lib/db-datasets';
import { getDatasetTypeById, getSetting } from '@/lib/db';
import { getBoss, ensureBossStarted } from '@/lib/pg-boss';
import path from 'path';

export const dynamic = 'force-dynamic';

// POST /api/datasets/:id/move-to-check
export const POST = withApiLogging(async function handler(req, { params }) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (actor.role !== 'admin' && actor.role !== 'data-manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const dataset = await getDatasetById(id);
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });

  if (!dataset.typeId) {
    return NextResponse.json({ error: 'Dataset has no type — cannot determine check path' }, { status: 422 });
  }

  if (['pending', 'moving', 'verifying'].includes(dataset.moveStatus)) {
    return NextResponse.json({ error: 'A move is already in progress' }, { status: 409 });
  }

  const type = await getDatasetTypeById(dataset.typeId);
  if (!type) {
    return NextResponse.json({ error: 'Dataset type not found' }, { status: 404 });
  }

  // Subdirectory name = last segment of the dataset path
  const subdirName = path.basename(dataset.datasetPath);

  // Check if all jobs are done (warn but don't block — body param can force)
  const body = await req.json().catch(() => ({}));
  const force = body?.force === true;
  const allDone = (dataset.totalJobs ?? 0) > 0 &&
    (dataset.labelledJobs ?? 0) === (dataset.totalJobs ?? 0);
  if (!force && !allDone) {
    return NextResponse.json({
      error: 'Not all jobs are marked as done. Pass { force: true } to proceed anyway.',
      totalJobs: dataset.totalJobs,
      labelledJobs: dataset.labelledJobs,
    }, { status: 422 });
  }

  // Enqueue
  const retryLimitStr = await getSetting('move_retry_limit');
  const retryLimit = parseInt(retryLimitStr || '3', 10);

  await updateDatasetMoveStatus(id, { moveStatus: 'pending', moveError: null, moveAttempt: 0 });

  await ensureBossStarted();
  const boss = getBoss();
  const jobId = await boss.send({
    name: 'move-dataset-to-check',
    data: {
      datasetId: id,
      datasetPath: dataset.datasetPath,
      checkPath: type.checkPath,
      subdirName,
    },
    options: { retryLimit, retryDelay: 60 },
  });

  await updateDatasetMoveStatus(id, { moveTaskId: jobId || null });

  return NextResponse.json({ ok: true, moveStatus: 'pending', jobId });
});
