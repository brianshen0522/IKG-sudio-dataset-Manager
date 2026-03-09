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
    createdAt: row.created_at ? row.created_at.toISOString() : null,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
    // Aggregated fields (only present when joined)
    totalJobs: row.total_jobs !== undefined ? Number(row.total_jobs) : undefined,
    assignedJobs: row.assigned_jobs !== undefined ? Number(row.assigned_jobs) : undefined,
    labelingJobs: row.labeling_jobs !== undefined ? Number(row.labeling_jobs) : undefined,
    labelledJobs: row.labelled_jobs !== undefined ? Number(row.labelled_jobs) : undefined,
    unassignedJobs: row.unassigned_jobs !== undefined ? Number(row.unassigned_jobs) : undefined
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
// Dataset CRUD
// ---------------------------------------------------------------------------

/**
 * Create a dataset and auto-split it into jobs.
 * Returns the created dataset with its jobs.
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
  duplicateMode = 'move'
}) {
  await ensureInitialized();

  const normalizedPath = path.resolve(datasetPath);
  const filenames = scanImageFilenames(normalizedPath);
  const totalImages = filenames.length;
  const jobRanges = computeJobRanges(totalImages, jobSize);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const dsResult = await client.query(
      `INSERT INTO datasets (
        dataset_path, display_name, created_by, total_images, job_size,
        threshold, debug, pentagon_format, obb_mode, class_file, duplicate_mode
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *`,
      [
        normalizedPath,
        displayName || null,
        createdBy,
        totalImages,
        jobSize,
        threshold,
        debug,
        pentagonFormat,
        obbMode,
        classFile,
        duplicateMode
      ]
    );
    const dataset = rowToDataset(dsResult.rows[0]);

    // Insert jobs in bulk
    for (const { jobIndex, imageStart, imageEnd } of jobRanges) {
      await client.query(
        `INSERT INTO jobs (dataset_id, job_index, image_start, image_end)
         VALUES ($1, $2, $3, $4)`,
        [dataset.id, jobIndex, imageStart, imageEnd]
      );
    }

    await client.query('COMMIT');
    return { dataset, jobCount: jobRanges.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
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
        COUNT(j.id)                                            AS total_jobs,
        COUNT(j.id) FILTER (WHERE j.status = 'unassigned')    AS unassigned_jobs,
        COUNT(j.id) FILTER (WHERE j.status = 'unlabelled')    AS assigned_jobs,
        COUNT(j.id) FILTER (WHERE j.status = 'labeling')      AS labeling_jobs,
        COUNT(j.id) FILTER (WHERE j.status = 'labelled')      AS labelled_jobs
      FROM datasets d
      LEFT JOIN jobs j ON j.dataset_id = d.id
    `;

    let result;
    if (role === 'admin' || role === 'data-manager') {
      result = await client.query(
        baseQuery + ' GROUP BY d.id ORDER BY d.created_at ASC'
      );
    } else {
      // Regular users see only datasets with jobs assigned to them
      result = await client.query(
        baseQuery +
        ' WHERE d.id IN (SELECT DISTINCT dataset_id FROM jobs WHERE assigned_to = $1)' +
        ' GROUP BY d.id ORDER BY d.created_at ASC',
        [userId]
      );
    }

    return result.rows.map(rowToDataset);
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
        COUNT(j.id)                                            AS total_jobs,
        COUNT(j.id) FILTER (WHERE j.status = 'unassigned')    AS unassigned_jobs,
        COUNT(j.id) FILTER (WHERE j.status = 'unlabelled')    AS assigned_jobs,
        COUNT(j.id) FILTER (WHERE j.status = 'labeling')      AS labeling_jobs,
        COUNT(j.id) FILTER (WHERE j.status = 'labelled')      AS labelled_jobs
       FROM datasets d
       LEFT JOIN jobs j ON j.dataset_id = d.id
       WHERE d.id = $1
       GROUP BY d.id`,
      [id]
    );
    return rowToDataset(result.rows[0]);
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
      threshold: 'threshold',
      debug: 'debug',
      pentagonFormat: 'pentagon_format',
      obbMode: 'obb_mode',
      classFile: 'class_file',
      duplicateMode: 'duplicate_mode'
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
    if (job.status !== 'labeling') {
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
