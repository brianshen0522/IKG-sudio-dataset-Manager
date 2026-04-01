/**
 * pg-boss worker: hash-baseline
 *
 * Scans every label.txt in a dataset directory immediately after jobs are
 * created (following the duplicate-scan).  For each file it:
 *   1. Computes an MD5 hash of the file content.
 *   2. Determines which job owns that label (by matching the image stem to the
 *      job's first/last image name anchors).
 *   3. Inserts a row into label_file_hashes with initial_hash = current_hash.
 *
 * Job data: { datasetId, datasetPath }
 */

import fs from 'fs';
import path from 'path';
import { getPool, ensureInitialized } from './db.js';
import { appendTaskLog } from './db-tasks.js';
import { hashLabelContent } from './label-hash.js';

/** Compute MD5 hash of normalized label content. Returns hex string. */
function hashFileContent(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return hashLabelContent(content);
}

/** Strip file extension, returning just the stem (e.g. "frame_001.jpg" → "frame_001"). */
function stem(filename) {
  return filename.replace(/\.[^.]+$/, '');
}

/**
 * Given a label file stem and the sorted list of jobs (each with firstImageName /
 * lastImageName), return the job id that owns it.  Returns null if no job covers it
 * (e.g. the label file has no matching image — shouldn't happen in normal operation).
 */
function findJobIdForStem(labelStem, jobs) {
  for (const job of jobs) {
    if (!job.first_image_name || !job.last_image_name) continue;
    const firstStem = stem(job.first_image_name);
    const lastStem  = stem(job.last_image_name);
    if (labelStem >= firstStem && labelStem <= lastStem) {
      return job.id;
    }
  }
  return null;
}

export async function runHashBaseline(job) {
  await ensureInitialized();

  const j = Array.isArray(job) ? job[0] : job;
  const jobId = j?.id; // pg-boss UUID — used as task_logs.job_id
  const { datasetId, datasetPath } = j?.data ?? {};

  const log = (level, msg) => appendTaskLog(jobId, level, msg);

  try {
    await log('info', `Hash baseline started for dataset #${datasetId}`);

    const labelsDir = path.join(datasetPath, 'labels');

    if (!fs.existsSync(labelsDir)) {
      await log('info', 'labels/ directory does not exist — nothing to hash.');
      return;
    }

    const pool = getPool();

    // Fetch all jobs for this dataset, ordered by job_index so anchor matching works.
    const jobsResult = await pool.query(
      'SELECT id, job_index, first_image_name, last_image_name FROM jobs WHERE dataset_id = $1 ORDER BY job_index ASC',
      [datasetId]
    );
    const jobs = jobsResult.rows;

    if (jobs.length === 0) {
      await log('warn', 'No jobs found for dataset — skipping hash baseline.');
      return;
    }

    // Collect all .txt files in labels/
    let labelFiles;
    try {
      labelFiles = fs.readdirSync(labelsDir)
        .filter((f) => f.endsWith('.txt'))
        .sort();
    } catch (err) {
      await log('error', `Failed to read labels/ directory: ${err.message}`);
      throw err;
    }

    await log('info', `Found ${labelFiles.length} label file(s) — computing hashes…`);

    let inserted = 0;
    let skipped  = 0; // files that couldn't be matched to a job

    // Process in batches to avoid huge single transactions.
    const BATCH = 500;
    for (let i = 0; i < labelFiles.length; i += BATCH) {
      const batch = labelFiles.slice(i, i + BATCH);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const filename of batch) {
          const filePath  = path.join(labelsDir, filename);
          const labelStem = stem(filename);
          const jobId_db  = findJobIdForStem(labelStem, jobs);

          if (jobId_db === null) {
            skipped++;
            continue;
          }

          let hash;
          try {
            hash = hashFileContent(filePath);
          } catch {
            skipped++;
            continue;
          }

          await client.query(
            `INSERT INTO label_file_hashes (dataset_id, job_id, filename, initial_hash, current_hash, updated_at)
             VALUES ($1, $2, $3, $4, $4, NOW())
             ON CONFLICT (job_id, filename) DO NOTHING`,
            [datasetId, jobId_db, filename, hash]
          );
          inserted++;
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    await log('info', `Hash baseline complete — ${inserted} file(s) recorded, ${skipped} skipped.`);
  } catch (err) {
    await log('error', `Hash baseline failed: ${err.message}`);
    throw err;
  }
}
