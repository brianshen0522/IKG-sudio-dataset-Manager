/**
 * pg-boss singleton — safe for Next.js HMR (dev) and production.
 *
 * Only import this in Node.js runtime (not Edge). Use it from:
 *  - API routes that enqueue jobs (boss.send)
 *  - The worker is registered once in ensureBossStarted()
 */

import PgBoss from 'pg-boss';

// Use globalThis symbols so dev HMR doesn't create multiple boss instances.
const BOSS_KEY = Symbol.for('ikgstudio.pgboss');
const START_KEY = Symbol.for('ikgstudio.pgboss.start');

export function getBoss() {
  if (!globalThis[BOSS_KEY]) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');
    const boss = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      // Keep completed/failed jobs for 7 days so the UI can list them.
      archiveCompletedAfterSeconds: 60 * 60 * 24 * 7,
      deleteAfterDays: 7,
    });
    boss.on('error', (err) => console.error('[pg-boss]', err.message));
    globalThis[BOSS_KEY] = boss;
  }
  return globalThis[BOSS_KEY];
}

export async function ensureBossStarted() {
  if (globalThis[START_KEY]) return globalThis[START_KEY];

  globalThis[START_KEY] = (async () => {
    const boss = getBoss();
    await boss.start();

    // pg-boss v10: queues must be created explicitly before send() or work().
    await boss.createQueue('duplicate-scan');

    // Register the duplicate-scan worker (one job at a time, no team/batch).
    const { runDuplicateScan } = await import('./duplicate-scan-worker.js');
    await boss.work('duplicate-scan', runDuplicateScan);

    await boss.createQueue('move-dataset-to-check');
    const { runMoveDataset } = await import('./move-dataset-worker.js');
    await boss.work('move-dataset-to-check', runMoveDataset);

    await boss.createQueue('hash-baseline');
    const { runHashBaseline } = await import('./hash-baseline-worker.js');
    await boss.work('hash-baseline', runHashBaseline);

    console.log('[pg-boss] started — workers registered for duplicate-scan, move-dataset-to-check, hash-baseline');
    return boss;
  })().catch((err) => {
    globalThis[START_KEY] = null;
    console.error('[pg-boss] startup error:', err.message);
    throw err;
  });

  return globalThis[START_KEY];
}
