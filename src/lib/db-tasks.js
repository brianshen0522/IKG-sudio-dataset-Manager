/**
 * Task helpers built on top of pg-boss.
 *
 * pg-boss manages jobs in the `pgboss` schema.
 * We store human-readable log lines in our own `task_logs` table,
 * keyed by the pg-boss job UUID.
 *
 * pg-boss job states → UI status mapping:
 *   created  → pending
 *   retry    → pending
 *   active   → running
 *   completed → completed
 *   failed   → failed
 *   cancelled → cancelled
 *   expired  → failed
 */

import { getPool, ensureInitialized } from './db.js';

// ---------------------------------------------------------------------------
// State mapping
// ---------------------------------------------------------------------------

function mapState(state) {
  if (state === 'active')    return 'running';
  if (state === 'completed') return 'completed';
  if (state === 'failed')    return 'failed';
  if (state === 'cancelled') return 'cancelled';
  if (state === 'expired')   return 'failed';
  return 'pending'; // created, retry
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToTask(row) {
  if (!row) return null;
  const data = row.data || {};
  const output = row.output || {};
  return {
    id: row.id,                                                  // UUID from pg-boss
    type: row.name || 'duplicate-scan',
    datasetId: data.datasetId ?? null,
    datasetName: row.dataset_name || data.datasetName || null,
    datasetPath: row.dataset_path || data.datasetPath || null,
    status: mapState(row.state),
    createdBy: data.createdBy ?? null,
    createdByUsername: row.created_by_username || null,
    createdAt: row.createdon ? new Date(row.createdon).toISOString() : null,
    startedAt: row.startedon ? new Date(row.startedon).toISOString() : null,
    completedAt: row.completedon ? new Date(row.completedon).toISOString() : null,
    error: row.state === 'failed' || row.state === 'expired'
      ? (output.message || output.error || null)
      : null,
    logs: [],  // loaded lazily via /api/tasks/[id]/logs
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const TASK_QUERY = `
  SELECT
    j.id,
    j.name,
    j.data,
    j.state,
    j.created_on   AS createdon,
    j.started_on   AS startedon,
    j.completed_on AS completedon,
    j.output,
    COALESCE(d.display_name, split_part(d.dataset_path, '/', -1)) AS dataset_name,
    d.dataset_path,
    u.username AS created_by_username
  FROM pgboss.job j
  LEFT JOIN datasets d ON d.id = (j.data->>'datasetId')::integer
  LEFT JOIN users u ON u.id = (j.data->>'createdBy')::integer
  WHERE j.name IN ('duplicate-scan', 'move-dataset-to-check')
`;

const GROUP_BY = `
  GROUP BY j.id, j.name, j.data, j.state,
           j.created_on, j.started_on, j.completed_on, j.output,
           d.display_name, d.dataset_path, u.username
`;

export async function getAllTasks({ limit = 100 } = {}) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query(
      TASK_QUERY + GROUP_BY + ' ORDER BY j.created_on DESC LIMIT $1',
      [limit]
    );
    return result.rows.map(rowToTask);
  } catch (err) {
    if (err.code === '42P01') return []; // pgboss schema not ready yet
    console.error('[db-tasks] getAllTasks error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

export async function getTaskById(id) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query(
      TASK_QUERY + ' AND j.id = $1' + GROUP_BY,
      [id]
    );
    return rowToTask(result.rows[0]);
  } catch (err) {
    if (err.code === '42P01') return null;
    console.error('[db-tasks] getTaskById error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/** Append a log line for a pg-boss job (by UUID). */
export async function appendTaskLog(jobId, level, message) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    await client.query(
      `INSERT INTO task_logs (job_id, level, message) VALUES ($1, $2, $3)`,
      [jobId, level, message]
    );
  } finally {
    client.release();
  }
}

/**
 * Paginated log fetch for a task.
 * Returns rows in ASC order (oldest first), limit 50 by default.
 * - before: load older entries (id < before)
 * - after:  load newer entries (id > after)
 */
export async function getTaskLogs(jobId, { limit = 50, before = null, after = null } = {}) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    let query, params;
    if (before != null) {
      query = `SELECT id, ts, level, message FROM task_logs WHERE job_id = $1 AND id < $2 ORDER BY id DESC LIMIT $3`;
      params = [jobId, before, limit];
    } else if (after != null) {
      query = `SELECT id, ts, level, message FROM task_logs WHERE job_id = $1 AND id > $2 ORDER BY id ASC LIMIT $3`;
      params = [jobId, after, limit];
    } else {
      // initial load: last N rows, returned in ASC order
      query = `SELECT * FROM (SELECT id, ts, level, message FROM task_logs WHERE job_id = $1 ORDER BY id DESC LIMIT $2) sub ORDER BY id ASC`;
      params = [jobId, limit];
    }
    const result = await client.query(query, params);
    // for 'before' queries the DB returns DESC; reverse to get ASC for display
    const rows = before != null ? result.rows.reverse() : result.rows;
    return rows.map((r) => ({ id: r.id, ts: r.ts, level: r.level, message: r.message }));
  } catch (err) {
    if (err.code === '42P01') return [];
    console.error('[db-tasks] getTaskLogs error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/** Returns true if the dataset has any pending or running pg-boss jobs. */
export async function datasetHasRunningTask(datasetId) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query(
      `SELECT 1 FROM pgboss.job
       WHERE name IN ('duplicate-scan', 'move-dataset-to-check')
         AND (data->>'datasetId')::integer = $1
         AND state IN ('created', 'retry', 'active')
       LIMIT 1`,
      [datasetId]
    );
    return result.rowCount > 0;
  } catch (err) {
    if (err.code === '42P01') return false; // pgboss schema not ready yet
    throw err;
  } finally {
    client.release();
  }
}
