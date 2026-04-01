import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getDatasetById, updateDatasetMoveStatus } from '@/lib/db-datasets';
import { getDatasetTypeById, getSetting } from '@/lib/db';
import { getBoss, ensureBossStarted } from '@/lib/pg-boss';
import path from 'path';

export const dynamic = 'force-dynamic';

// POST /api/datasets/bulk-move-to-check
// Body: { ids: number[], force: boolean }
export const POST = withApiLogging(async function handler(req) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (actor.role !== 'admin' && actor.role !== 'data-manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Boolean) : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'No dataset ids provided' }, { status: 400 });
  }

  const force = body?.force === true;

  const retryLimitStr = await getSetting('move_retry_limit');
  const retryLimit = parseInt(retryLimitStr || '3', 10);

  await ensureBossStarted();
  const boss = getBoss();

  const results = [];

  for (const id of ids) {
    try {
      const dataset = await getDatasetById(id);
      if (!dataset) {
        results.push({ id, ok: false, error: 'Dataset not found' });
        continue;
      }

      if (!dataset.typeId) {
        results.push({ id, ok: false, error: 'Dataset has no type — cannot determine check path', name: dataset.displayName });
        continue;
      }

      if (['pending', 'moving', 'verifying'].includes(dataset.moveStatus)) {
        results.push({ id, ok: false, error: 'A move is already in progress', name: dataset.displayName });
        continue;
      }

      const type = await getDatasetTypeById(dataset.typeId);
      if (!type) {
        results.push({ id, ok: false, error: 'Dataset type not found', name: dataset.displayName });
        continue;
      }

      const allDone = (dataset.totalJobs ?? 0) > 0 &&
        (dataset.labelledJobs ?? 0) === (dataset.totalJobs ?? 0);
      if (!force && !allDone) {
        results.push({
          id,
          ok: false,
          error: 'Not all jobs are marked as done',
          notAllDone: true,
          totalJobs: dataset.totalJobs,
          labelledJobs: dataset.labelledJobs,
          name: dataset.displayName,
        });
        continue;
      }

      const subdirName = path.basename(dataset.datasetPath);

      await updateDatasetMoveStatus(id, { moveStatus: 'pending', moveError: null, moveAttempt: 0 });

      const jobId = await boss.send({
        name: 'move-dataset-to-check',
        data: {
          datasetId: id,
          datasetPath: dataset.datasetPath,
          checkPath: type.checkPath,
          subdirName,
          movedBy: actor.id,
        },
        options: { retryLimit, retryDelay: 60 },
      });

      await updateDatasetMoveStatus(id, { moveTaskId: jobId || null });

      results.push({ id, ok: true, name: dataset.displayName });
    } catch (err) {
      results.push({ id, ok: false, error: err.message || 'Unexpected error' });
    }
  }

  return NextResponse.json({ results });
});
