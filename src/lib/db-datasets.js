import path from 'path';
import { getPool, ensureInitialized } from './db.js';
import { scanImageFilenames, computeJobRanges } from './dataset-utils.js';

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToDataset(row) {
  if (!row) return null;
  return {
    id: row.id,
    datasetPath: row.dataset_path,
    displayName: row.display_name,
    createdBy: row.created_by,
    totalImages: row.total_images,
    jobSize: row.job_size,
    threshold: parseFloat(row.threshold),
    debug: row.debug,
    pentagonFormat: row.pentagon_format,
    obbMode: row.obb_mode,
    classFile: row.class_file,
    duplicateMode: row.duplicate_mode,
    duplicateLabels: row.duplicate_labels ?? 0,
    hasRunningTask: row.has_running_task === true || row.has_running_task === 't' || row.has_running_task == 1,
    createdAt: row.created_at ? row.created_at.toISOString() : null,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
    // Aggregated fields (only present when joined)
    totalJobs: row.total_jobs !== undefined ? Number(row.total_jobs) : undefined,
    assignedJobs: row.assigned_jobs !== undefined ? Number(row.assigned_jobs) : undefined,
    labelingJobs: row.labeling_jobs !== undefined ? Number(row.labeling_jobs) : undefined,
    labelledJobs: row.labelled_jobs !== undefined ? Number(row.labelled_jobs) : undefined,
    unassignedJobs: row.unassigned_jobs !== undefined ? Number(row.unassigned_jobs) : undefined,
    typeId: row.type_id ?? null,
    typeName: row.type_name || null,
    moveStatus: row.move_status || null,
    moveTaskId: row.move_task_id || null,
    moveError: row.move_error || null,
    moveAttempt: row.move_attempt ?? 0,
  };
}

function rowToJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    datasetId: row.dataset_id,
    jobIndex: row.job_index,
    imageStart: row.image_start,
    imageEnd: row.image_end,
    firstImageName: row.first_image_name || null,
    lastImageName: row.last_image_name || null,
    status: row.status,
    assignedTo: row.assigned_to,
    assignedToUsername: row.assigned_to_username || null,
    assignedAt: row.assigned_at ? row.assigned_at.toISOString() : null,
    labelingStartedAt: row.labeling_started_at ? row.labeling_started_at.toISOString() : null,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    createdAt: row.created_at ? row.created_at.toISOString() : null,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null
  };
}

function rowToJobUserState(row) {
  if (!row) return null;
  return {
    jobId: row.job_id,
    userId: row.user_id,
    lastImagePath: row.last_image_path,
    selectedImages: row.selected_images || [],
    filter: row.filter,
    previewSortMode: row.preview_sort_mode,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null
  };
}

// ---------------------------------------------------------------------------
// pg-boss helper — returns a Set of dataset IDs that have an active scan.
// Gracefully returns an empty Set if the pgboss schema doesn't exist yet.
// ---------------------------------------------------------------------------

async function getRunningDatasetIds(client) {
  try {
    const result = await client.query(`
      SELECT DISTINCT (data->>'datasetId')::integer AS dataset_id
      FROM pgboss.job
      WHERE name = 'duplicate-scan'
        AND state IN ('created', 'retry', 'active')
    `);
    return new Set(result.rows.map((r) => r.dataset_id));
  } catch {
    // pgboss schema not yet created (boss.start() hasn't run)
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// Dataset CRUD
// ---------------------------------------------------------------------------

/**
 * Create a dataset record only (no jobs yet).
 * Jobs are created after the duplicate scan completes via createDatasetJobs().
 */
export async function createDataset({
  datasetPath,
  displayName,
  createdBy,
  jobSize,
  threshold = 0.8,
  debug = false,
  pentagonFormat = false,
  obbMode = 'rectangle',
  classFile = null,
  duplicateMode = 'move',
  duplicateLabels = 0,
  typeId = null
}) {
  await ensureInitialized();

  const normalizedPath = path.resolve(datasetPath);

  const client = await getPool().connect();
  try {
    const dsResult = await client.query(
      `INSERT INTO datasets (
        dataset_path, display_name, created_by, total_images, job_size,
        threshold, debug, pentagon_format, obb_mode, class_file, duplicate_mode, duplicate_labels, type_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *`,
      [
        normalizedPath,
        displayName || null,
        createdBy,
        0,            // total_images set to 0 until jobs are created after scan
        jobSize,
        threshold,
        debug,
        pentagonFormat,
        obbMode,
        classFile,
        duplicateMode,
        duplicateLabels,
        typeId || null
      ]
    );
    const dataset = rowToDataset(dsResult.rows[0]);
    return { dataset, jobCount: 0 };
  } finally {
    client.release();
  }
}

/**
 * Scan the dataset path on disk and create jobs.
 * Called by the duplicate-scan worker after duplicates have been removed.
 */
export async function createDatasetJobs(datasetId) {
  await ensureInitialized();

  const client = await getPool().connect();
  try {
    const dsRow = await client.query('SELECT * FROM datasets WHERE id = $1', [datasetId]);
    if (!dsRow.rows[0]) throw new Error(`Dataset ${datasetId} not found`);
    const dataset = rowToDataset(dsRow.rows[0]);

    const filenames = scanImageFilenames(dataset.datasetPath);
    const totalImages = filenames.length;
    const jobRanges = computeJobRanges(totalImages, dataset.jobSize);

    await client.query('BEGIN');

    // Remove any existing jobs (safe to re-run)
    await client.query('DELETE FROM jobs WHERE dataset_id = $1', [datasetId]);

    for (const { jobIndex, imageStart, imageEnd } of jobRanges) {
      const firstName = filenames[imageStart - 1] || null;
      const lastName  = filenames[imageEnd  - 1] || null;
      await client.query(
        `INSERT INTO jobs (dataset_id, job_index, image_start, image_end, first_image_name, last_image_name)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [datasetId, jobIndex, imageStart, imageEnd, firstName, lastName]
      );
    }

    await client.query(
      'UPDATE datasets SET total_images = $1, updated_at = NOW() WHERE id = $2',
      [totalImages, datasetId]
    );

    await client.query('COMMIT');
    return { totalImages, jobCount: jobRanges.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function refreshDatasetImageStats(datasetId) {
  await ensureInitialized();

  const client = await getPool().connect();
  try {
    const dsRow = await client.query('SELECT * FROM datasets WHERE id = $1', [datasetId]);
    if (!dsRow.rows[0]) throw new Error(`Dataset ${datasetId} not found`);
    const dataset = rowToDataset(dsRow.rows[0]);

    const totalImages = scanImageFilenames(dataset.datasetPath).length;
    const result = await client.query(
      'UPDATE datasets SET total_images = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [totalImages, datasetId]
    );

    return rowToDataset(result.rows[0]);
  } finally {
    client.release();
  }
}

/**
 * List all datasets with aggregated job progress stats.
 * Admin/data-manager: all datasets.
 * User: only datasets that have at least one job assigned to them.
 */
export async function getAllDatasets({ role, userId } = {}) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const baseQuery = `
      SELECT
        d.*,
        dt.name AS type_name,
        COUNT(j.id)                                            AS total_jobs,
        COUNT(j.id) FILTER (WHERE j.status = 'unassigned')    AS unassigned_jobs,
        COUNT(j.id) FILTER (WHERE j.status = 'unlabelled')    AS assigned_jobs,
        COUNT(j.id) FILTER (WHERE j.status = 'labeling')      AS labeling_jobs,
        COUNT(j.id) FILTER (WHERE j.status = 'labelled')      AS labelled_jobs
      FROM datasets d
      LEFT JOIN dataset_types dt ON dt.id = d.type_id
      LEFT JOIN jobs j ON j.dataset_id = d.id
    `;

    let result;
    if (role === 'admin' || role === 'data-manager') {
      result = await client.query(
        baseQuery + ' WHERE d.archived_at IS NULL GROUP BY d.id, dt.name ORDER BY d.created_at ASC'
      );
    } else {
      result = await client.query(
        baseQuery +
        ' WHERE d.archived_at IS NULL AND d.id IN (SELECT DISTINCT dataset_id FROM jobs WHERE assigned_to = $1)' +
        ' GROUP BY d.id, dt.name ORDER BY d.created_at ASC',
        [userId]
      );
    }

    const runningIds = await getRunningDatasetIds(client);
    return result.rows.map((row) => {
      const d = rowToDataset(row);
      d.hasRunningTask = runningIds.has(d.id);
      return d;
    });
  } finally {
    client.release();
  }
}

export async function getDatasetById(id) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query(
      `SELECT
        d.*,
        dt.name AS type_name,
        COUNT(j.id)                                            AS total_jobs,
        COUNT(j.id) FILTER (WHERE j.status = 'unassigned')    AS unassigned_jobs,
        COUNT(j.id) FILTER (WHERE j.status = 'unlabelled')    AS assigned_jobs,
        COUNT(j.id) FILTER (WHERE j.status = 'labeling')      AS labeling_jobs,
        COUNT(j.id) FILTER (WHERE j.status = 'labelled')      AS labelled_jobs
       FROM datasets d
       LEFT JOIN dataset_types dt ON dt.id = d.type_id
       LEFT JOIN jobs j ON j.dataset_id = d.id
       WHERE d.id = $1
       GROUP BY d.id, dt.name`,
      [id]
    );
    const dataset = rowToDataset(result.rows[0]);
    if (dataset) {
      const runningIds = await getRunningDatasetIds(client);
      dataset.hasRunningTask = runningIds.has(dataset.id);
    }
    return dataset;
  } finally {
    client.release();
  }
}

export async function getDatasetByPath(datasetPath) {
  await ensureInitialized();
  const normalized = path.resolve(datasetPath);
  const client = await getPool().connect();
  try {
    const result = await client.query('SELECT * FROM datasets WHERE dataset_path = $1', [normalized]);
    return rowToDataset(result.rows[0]);
  } finally {
    client.release();
  }
}

export async function deleteDataset(id) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const check = await client.query('SELECT move_status FROM datasets WHERE id = $1', [id]);
    if (!check.rows[0]) return false;
    if (['pending', 'moving', 'verifying'].includes(check.rows[0].move_status)) {
      throw Object.assign(new Error('Cannot delete a dataset while a move is in progress'), { status: 409 });
    }
    const result = await client.query('DELETE FROM datasets WHERE id = $1 RETURNING id', [id]);
    return result.rowCount > 0;
  } finally {
    client.release();
  }
}

export async function updateDatasetFields(id, fields) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const allowed = {
      displayName: 'display_name',
      classFile: 'class_file'
    };

    const setClauses = [];
    const values = [];
    let p = 1;

    for (const [key, dbCol] of Object.entries(allowed)) {
      if (fields[key] !== undefined) {
        setClauses.push(`${dbCol} = $${p++}`);
        values.push(fields[key]);
      }
    }

    if (setClauses.length === 0) return getDatasetById(id);

    setClauses.push(`updated_at = $${p++}`);
    values.push(new Date().toISOString());
    values.push(id);

    const result = await client.query(
      `UPDATE datasets SET ${setClauses.join(', ')} WHERE id = $${p} RETURNING *`,
      values
    );
    return rowToDataset(result.rows[0]);
  } finally {
    client.release();
  }
}

export async function updateDatasetMoveStatus(id, { moveStatus, moveTaskId, moveError, moveAttempt } = {}) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const setClauses = [];
    const values = [];
    let p = 1;
    if (moveStatus !== undefined)  { setClauses.push(`move_status = $${p++}`);  values.push(moveStatus); }
    if (moveTaskId !== undefined)  { setClauses.push(`move_task_id = $${p++}`); values.push(moveTaskId); }
    if (moveError !== undefined)   { setClauses.push(`move_error = $${p++}`);   values.push(moveError); }
    if (moveAttempt !== undefined) { setClauses.push(`move_attempt = $${p++}`); values.push(moveAttempt); }
    if (setClauses.length === 0) return;
    setClauses.push(`updated_at = $${p++}`);
    values.push(new Date().toISOString());
    values.push(id);
    await client.query(`UPDATE datasets SET ${setClauses.join(', ')} WHERE id = $${p}`, values);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Job CRUD
// ---------------------------------------------------------------------------

const JOB_WITH_USER = `
  SELECT j.*, u.username AS assigned_to_username
  FROM jobs j
  LEFT JOIN users u ON u.id = j.assigned_to
`;

export async function getJobsByDataset(datasetId, { userId, role } = {}) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    let result;
    if (role === 'admin' || role === 'data-manager') {
      result = await client.query(
        JOB_WITH_USER + ' WHERE j.dataset_id = $1 ORDER BY j.job_index ASC',
        [datasetId]
      );
    } else {
      result = await client.query(
        JOB_WITH_USER + ' WHERE j.dataset_id = $1 AND j.assigned_to = $2 ORDER BY j.job_index ASC',
        [datasetId, userId]
      );
    }
    return result.rows.map(rowToJob);
  } finally {
    client.release();
  }
}

export async function getJobById(jobId) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query(
      JOB_WITH_USER + ' WHERE j.id = $1',
      [jobId]
    );
    return rowToJob(result.rows[0]);
  } finally {
    client.release();
  }
}

async function recordHistory(client, { jobId, fromUserId, toUserId, actionBy, action, keepData, note }) {
  await client.query(
    `INSERT INTO job_assignment_history
      (job_id, from_user_id, to_user_id, action_by, action, keep_data, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [jobId, fromUserId || null, toUserId || null, actionBy, action, keepData ?? null, note || null]
  );
}

/** Assign an unassigned job to a user → status: unlabelled */
export async function assignJob(jobId, toUserId, actorId) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId]);
    const job = rows[0];
    if (!job) throw Object.assign(new Error('Job not found'), { status: 404 });
    if (job.status !== 'unassigned') {
      throw Object.assign(new Error('Job is not in unassigned state'), { status: 409 });
    }

    const result = await client.query(
      `UPDATE jobs SET status = 'unlabelled', assigned_to = $1, assigned_at = NOW(), updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [toUserId, jobId]
    );

    await recordHistory(client, { jobId, fromUserId: null, toUserId, actionBy: actorId, action: 'assign' });
    await client.query('COMMIT');
    return rowToJob(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Unassign a job → status: unassigned */
export async function unassignJob(jobId, actorId) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId]);
    const job = rows[0];
    if (!job) throw Object.assign(new Error('Job not found'), { status: 404 });

    const result = await client.query(
      `UPDATE jobs
       SET status = 'unassigned', assigned_to = NULL, assigned_at = NULL,
           labeling_started_at = NULL, completed_at = NULL, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [jobId]
    );

    await recordHistory(client, { jobId, fromUserId: job.assigned_to, toUserId: null, actionBy: actorId, action: 'unassign' });
    await client.query('COMMIT');
    return rowToJob(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** User starts labeling → status: labeling */
export async function startJob(jobId, userId) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId]);
    const job = rows[0];
    if (!job) throw Object.assign(new Error('Job not found'), { status: 404 });
    if (job.assigned_to !== userId) {
      throw Object.assign(new Error('Job is not assigned to you'), { status: 403 });
    }
    if (job.status !== 'unlabelled') {
      throw Object.assign(new Error(`Cannot start a job with status: ${job.status}`), { status: 409 });
    }

    const result = await client.query(
      `UPDATE jobs SET status = 'labeling', labeling_started_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [jobId]
    );

    await client.query('COMMIT');
    return rowToJob(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** User completes labeling → status: labelled */
export async function completeJob(jobId, userId) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId]);
    const job = rows[0];
    if (!job) throw Object.assign(new Error('Job not found'), { status: 404 });
    if (job.assigned_to !== userId) {
      throw Object.assign(new Error('Job is not assigned to you'), { status: 403 });
    }
    if (!['labeling', 'unlabelled'].includes(job.status)) {
      throw Object.assign(new Error(`Cannot complete a job with status: ${job.status}`), { status: 409 });
    }

    const result = await client.query(
      `UPDATE jobs SET status = 'labelled', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [jobId]
    );

    await recordHistory(client, { jobId, fromUserId: userId, toUserId: userId, actionBy: userId, action: 'complete' });
    await client.query('COMMIT');
    return rowToJob(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reset a job (data-manager / admin only).
 * keepData=true  → status: unlabelled (label files untouched)
 * keepData=false → status: unassigned (label files should be cleared by caller)
 */
export async function resetJob(jobId, actorId, { keepData = true } = {}) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId]);
    const job = rows[0];
    if (!job) throw Object.assign(new Error('Job not found'), { status: 404 });

    const newStatus = keepData ? 'unlabelled' : 'unassigned';
    const clearAssign = !keepData;

    const result = await client.query(
      `UPDATE jobs
       SET status = $1,
           ${clearAssign ? 'assigned_to = NULL, assigned_at = NULL,' : ''}
           labeling_started_at = NULL,
           completed_at = NULL,
           updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [newStatus, jobId]
    );

    // Clear the assigned user's editor state (last image, filter, sort)
    if (job.assigned_to) {
      await client.query(
        `UPDATE job_user_state
         SET last_image_path = NULL, filter = NULL, preview_sort_mode = NULL, updated_at = NOW()
         WHERE job_id = $1 AND user_id = $2`,
        [jobId, job.assigned_to]
      );
    }

    await recordHistory(client, {
      jobId,
      fromUserId: job.assigned_to,
      toUserId: keepData ? job.assigned_to : null,
      actionBy: actorId,
      action: 'reset',
      keepData
    });
    await client.query('COMMIT');
    return rowToJob(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reassign a job to another user (data-manager / admin only).
 * keepData=true  → new user continues from existing labels
 * keepData=false → caller is responsible for clearing label files
 */
export async function reassignJob(jobId, toUserId, actorId, { keepData = true } = {}) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId]);
    const job = rows[0];
    if (!job) throw Object.assign(new Error('Job not found'), { status: 404 });

    const result = await client.query(
      `UPDATE jobs
       SET assigned_to = $1, assigned_at = NOW(), status = 'unlabelled',
           labeling_started_at = NULL, completed_at = NULL, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [toUserId, jobId]
    );

    if (keepData && job.assigned_to && job.assigned_to !== toUserId) {
      // Copy previous user's editor state (last image, filter, sort) to the new user
      const stateRes = await client.query(
        'SELECT * FROM job_user_state WHERE job_id = $1 AND user_id = $2',
        [jobId, job.assigned_to]
      );
      if (stateRes.rows.length > 0) {
        const s = stateRes.rows[0];
        await client.query(
          `INSERT INTO job_user_state (job_id, user_id, last_image_path, filter, preview_sort_mode, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (job_id, user_id) DO UPDATE
             SET last_image_path = $3, filter = $4, preview_sort_mode = $5, updated_at = NOW()`,
          [jobId, toUserId, s.last_image_path, s.filter, s.preview_sort_mode]
        );
      }
    } else if (!keepData && toUserId) {
      // Clear any existing state for the new user (fresh start)
      await client.query(
        `UPDATE job_user_state SET last_image_path = NULL, filter = NULL, preview_sort_mode = NULL, updated_at = NOW()
         WHERE job_id = $1 AND user_id = $2`,
        [jobId, toUserId]
      );
    }

    await recordHistory(client, {
      jobId,
      fromUserId: job.assigned_to,
      toUserId,
      actionBy: actorId,
      action: 'reassign',
      keepData
    });
    await client.query('COMMIT');
    return rowToJob(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Job user state
// ---------------------------------------------------------------------------

export async function getJobUserState(jobId, userId) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query(
      'SELECT * FROM job_user_state WHERE job_id = $1 AND user_id = $2',
      [jobId, userId]
    );
    return rowToJobUserState(result.rows[0]);
  } finally {
    client.release();
  }
}

export async function upsertJobUserState(jobId, userId, fields) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const allowed = {
      lastImagePath: 'last_image_path',
      selectedImages: 'selected_images',
      filter: 'filter',
      previewSortMode: 'preview_sort_mode'
    };

    const cols = ['job_id', 'user_id'];
    const insertVals = [jobId, userId];
    const updateClauses = [];
    let p = 3;

    for (const [key, dbCol] of Object.entries(allowed)) {
      if (fields[key] !== undefined) {
        cols.push(dbCol);
        const val =
          dbCol === 'selected_images' || dbCol === 'filter'
            ? fields[key] !== null ? JSON.stringify(fields[key]) : null
            : fields[key];
        insertVals.push(val);
        updateClauses.push(`${dbCol} = $${p++}`);
      }
    }

    if (updateClauses.length === 0) return getJobUserState(jobId, userId);

    // Build placeholders
    const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(', ');

    const result = await client.query(
      `INSERT INTO job_user_state (${cols.join(', ')}, updated_at)
       VALUES (${placeholders}, NOW())
       ON CONFLICT (job_id, user_id) DO UPDATE
         SET ${updateClauses.join(', ')}, updated_at = NOW()
       RETURNING *`,
      insertVals
    );
    return rowToJobUserState(result.rows[0]);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Edit statistics (live, for active datasets)
// ---------------------------------------------------------------------------

/**
 * Returns per-job edit stats for a dataset.
 * Result: Map<jobId, { editedFiles: number, deletedImages: number }>
 */
export async function getJobEditStats(datasetId) {
  await ensureInitialized();
  // Use pool.query() directly so each concurrent query gets its own client.
  // A single pg Client is not safe for concurrent queries.
  const [editResult, delResult] = await Promise.all([
    getPool().query(
      `SELECT job_id,
              COUNT(*) FILTER (WHERE initial_hash IS NULL OR initial_hash != current_hash) AS edited_count
       FROM label_file_hashes
       WHERE dataset_id = $1
       GROUP BY job_id`,
      [datasetId]
    ),
    getPool().query(
      `SELECT job_id, COUNT(*) AS deleted_count
       FROM deleted_images
       WHERE dataset_id = $1
       GROUP BY job_id`,
      [datasetId]
    ),
  ]);

  const map = new Map();
  for (const r of editResult.rows) {
    map.set(r.job_id, { editedFiles: Number(r.edited_count), deletedImages: 0 });
  }
  for (const r of delResult.rows) {
    const existing = map.get(r.job_id) ?? { editedFiles: 0, deletedImages: 0 };
    existing.deletedImages = Number(r.deleted_count);
    map.set(r.job_id, existing);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Label file hash tracking
// ---------------------------------------------------------------------------

/**
 * Insert or update the current_hash for a single label file.
 * initial_hash is only set on INSERT (never overwritten).
 * A filename with no existing baseline row (new label) is inserted with
 * initial_hash = NULL to signal it was created after the baseline scan.
 */
export async function upsertLabelFileHash(datasetId, jobId, filename, currentHash) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    await client.query(
      `INSERT INTO label_file_hashes (dataset_id, job_id, filename, initial_hash, current_hash, updated_at)
       VALUES ($1, $2, $3, NULL, $4, NOW())
       ON CONFLICT (job_id, filename) DO UPDATE
         SET current_hash = $4, updated_at = NOW()`,
      [datasetId, jobId, filename, currentHash]
    );
  } finally {
    client.release();
  }
}

export async function getLabelFileHash(datasetId, jobId, filename) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query(
      `SELECT initial_hash, current_hash
       FROM label_file_hashes
       WHERE dataset_id = $1 AND job_id = $2 AND filename = $3`,
      [datasetId, jobId, filename]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      initialHash: row.initial_hash,
      currentHash: row.current_hash,
    };
  } finally {
    client.release();
  }
}

export async function updateLabelFileHashes(datasetId, jobId, filename, initialHash, currentHash) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    await client.query(
      `UPDATE label_file_hashes
       SET initial_hash = $4, current_hash = $5, updated_at = NOW()
       WHERE dataset_id = $1 AND job_id = $2 AND filename = $3`,
      [datasetId, jobId, filename, initialHash, currentHash]
    );
  } finally {
    client.release();
  }
}

export async function deleteLabelFileHash(datasetId, jobId, filename) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    await client.query(
      `DELETE FROM label_file_hashes
       WHERE dataset_id = $1 AND job_id = $2 AND filename = $3`,
      [datasetId, jobId, filename]
    );
  } finally {
    client.release();
  }
}

export async function listEditedLabelFilenames(jobId) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query(
      `SELECT filename
       FROM label_file_hashes
       WHERE job_id = $1
         AND (initial_hash IS NULL OR initial_hash != current_hash)
       ORDER BY filename ASC`,
      [jobId]
    );
    return result.rows.map((row) => row.filename);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Deleted image tracking
// ---------------------------------------------------------------------------

/**
 * Record that an image was deleted during a labeling job.
 * jobId may be null for legacy path-based deletions.
 */
export async function recordImageDeletion(datasetId, jobId, imageName, deletedBy) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    await client.query(
      `INSERT INTO deleted_images (dataset_id, job_id, image_name, deleted_by, deleted_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [datasetId, jobId || null, imageName, deletedBy || null]
    );
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Dataset archive (after move-to-done)
// ---------------------------------------------------------------------------

/**
 * Mark a dataset as archived (instead of deleting it).
 * Called by move-dataset-worker after a successful move.
 */
export async function archiveDataset(id, archivedBy, archivedToPath) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    await client.query(
      `UPDATE datasets
       SET archived_at = NOW(), archived_by = $2, archived_to_path = $3,
           move_status = 'archived', updated_at = NOW()
       WHERE id = $1`,
      [id, archivedBy || null, archivedToPath || null]
    );
  } finally {
    client.release();
  }
}

/**
 * Return all archived datasets (admin/data-manager only) with their jobs,
 * edit stats, deletion counts, assignment history, and archive metadata.
 */
export async function getArchivedDatasets() {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    // Fetch archived datasets.
    const dsResult = await client.query(`
      SELECT
        d.*,
        dt.name   AS type_name,
        u.username AS archived_by_username
      FROM datasets d
      LEFT JOIN dataset_types dt ON dt.id = d.type_id
      LEFT JOIN users u          ON u.id  = d.archived_by
      WHERE d.archived_at IS NOT NULL
      ORDER BY d.archived_at DESC
    `);

    if (dsResult.rows.length === 0) return [];

    const datasetIds = dsResult.rows.map((r) => r.id);

    // Fetch all jobs for these datasets.
    const jobsResult = await client.query(`
      SELECT j.*, u.username AS assigned_to_username
      FROM jobs j
      LEFT JOIN users u ON u.id = j.assigned_to
      WHERE j.dataset_id = ANY($1)
      ORDER BY j.dataset_id ASC, j.job_index ASC
    `, [datasetIds]);

    // Fetch edit stats per job (edited = initial_hash != current_hash OR initial_hash IS NULL).
    const editResult = await client.query(`
      SELECT
        job_id,
        COUNT(*) FILTER (WHERE initial_hash IS NULL OR initial_hash != current_hash) AS edited_count
      FROM label_file_hashes
      WHERE dataset_id = ANY($1)
      GROUP BY job_id
    `, [datasetIds]);

    // Fetch deletion counts per job.
    const delResult = await client.query(`
      SELECT job_id, COUNT(*) AS deleted_count
      FROM deleted_images
      WHERE dataset_id = ANY($1)
      GROUP BY job_id
    `, [datasetIds]);

    // Fetch assignment history for all jobs of these datasets.
    const jobIds = jobsResult.rows.map((r) => r.id);
    let historyRows = [];
    if (jobIds.length > 0) {
      const histResult = await client.query(`
        SELECT h.*,
               fa.username AS from_username,
               ta.username AS to_username,
               ab.username AS action_by_username
        FROM job_assignment_history h
        LEFT JOIN users fa ON fa.id = h.from_user_id
        LEFT JOIN users ta ON ta.id = h.to_user_id
        LEFT JOIN users ab ON ab.id = h.action_by
        WHERE h.job_id = ANY($1)
        ORDER BY h.job_id ASC, h.created_at ASC
      `, [jobIds]);
      historyRows = histResult.rows;
    }

    // Index lookups.
    const editMap  = new Map(editResult.rows.map((r) => [r.job_id, Number(r.edited_count)]));
    const delMap   = new Map(delResult.rows.map((r) => [r.job_id, Number(r.deleted_count)]));
    const histMap  = new Map();
    for (const h of historyRows) {
      if (!histMap.has(h.job_id)) histMap.set(h.job_id, []);
      histMap.get(h.job_id).push({
        id: h.id,
        fromUser: h.from_user_id ? { id: h.from_user_id, username: h.from_username } : null,
        toUser:   h.to_user_id   ? { id: h.to_user_id,   username: h.to_username }   : null,
        actionBy: { id: h.action_by, username: h.action_by_username },
        action:   h.action,
        createdAt: h.created_at ? h.created_at.toISOString() : null,
      });
    }

    // Group jobs by dataset.
    const jobsByDataset = new Map();
    for (const row of jobsResult.rows) {
      if (!jobsByDataset.has(row.dataset_id)) jobsByDataset.set(row.dataset_id, []);
      const editedFiles  = editMap.get(row.id) ?? 0;
      const deletedImages = delMap.get(row.id) ?? 0;
      jobsByDataset.get(row.dataset_id).push({
        id: row.id,
        jobIndex: row.job_index,
        status: row.status,
        assignedTo: row.assigned_to,
        assignedToUsername: row.assigned_to_username || null,
        assignedAt: row.assigned_at ? row.assigned_at.toISOString() : null,
        labelingStartedAt: row.labeling_started_at ? row.labeling_started_at.toISOString() : null,
        completedAt: row.completed_at ? row.completed_at.toISOString() : null,
        editedFiles,
        deletedImages,
        history: histMap.get(row.id) ?? [],
      });
    }

    // Build final result.
    return dsResult.rows.map((row) => {
      const jobs = jobsByDataset.get(row.id) ?? [];
      const totalEdited  = jobs.reduce((s, j) => s + j.editedFiles, 0);
      const totalDeleted = jobs.reduce((s, j) => s + j.deletedImages, 0);
      return {
        id: row.id,
        datasetPath: row.dataset_path,
        displayName: row.display_name,
        totalImages: row.total_images,
        typeId: row.type_id ?? null,
        typeName: row.type_name || null,
        duplicateRemovedCount: row.duplicate_removed_count ?? 0,
        archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
        archivedBy: row.archived_by
          ? { id: row.archived_by, username: row.archived_by_username }
          : null,
        archivedToPath: row.archived_to_path || null,
        createdAt: row.created_at ? row.created_at.toISOString() : null,
        totalEditedFiles: totalEdited,
        totalDeletedImages: totalDeleted,
        jobs,
      };
    });
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Assignment history (read-only)
// ---------------------------------------------------------------------------

export async function getJobHistory(jobId) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query(
      `SELECT h.*,
              fa.username AS from_username,
              ta.username AS to_username,
              ab.username AS action_by_username
       FROM job_assignment_history h
       LEFT JOIN users fa ON fa.id = h.from_user_id
       LEFT JOIN users ta ON ta.id = h.to_user_id
       LEFT JOIN users ab ON ab.id = h.action_by
       WHERE h.job_id = $1
       ORDER BY h.created_at ASC`,
      [jobId]
    );
    return result.rows.map((r) => ({
      id: r.id,
      jobId: r.job_id,
      fromUser: r.from_user_id ? { id: r.from_user_id, username: r.from_username } : null,
      toUser: r.to_user_id ? { id: r.to_user_id, username: r.to_username } : null,
      actionBy: { id: r.action_by, username: r.action_by_username },
      action: r.action,
      keepData: r.keep_data,
      note: r.note,
      createdAt: r.created_at ? r.created_at.toISOString() : null
    }));
  } finally {
    client.release();
  }
}
