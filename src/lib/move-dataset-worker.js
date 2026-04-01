import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getPool, ensureInitialized } from './db.js';
import { computeMetadataHashWithCount } from './dataset-hash.js';
import { updateDatasetMoveStatus, archiveDataset } from './db-datasets.js';
import { appendTaskLog } from './db-tasks.js';

async function log(jobId, level, message) {
  try { await appendTaskLog(jobId, level, message); } catch { /* non-fatal */ }
  console.log(`[move-dataset][${level}] ${message}`);
}

function rsyncWithLogs(src, dst, jobId) {
  return new Promise((resolve, reject) => {
    // Only transfer images/, labels/, and classes.txt (if present)
    const args = [
      '-a', '--checksum', '--stats', '--human-readable',
      '--include=images/', '--include=images/**',
      '--include=labels/', '--include=labels/**',
      '--include=classes.txt',
      '--exclude=*',
      src + '/', dst + '/',
    ];
    const proc = spawn('rsync', args);

    let stderrBuf = '';
    let stdoutBuf = '';

    proc.stdout.on('data', (chunk) => { stdoutBuf += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });

    proc.on('close', async (code) => {
      // Log useful stats lines from --stats output
      const statLines = stdoutBuf.split('\n').map((l) => l.trim()).filter(Boolean);
      for (const line of statLines) {
        if (/number of files|total file size|total transferred|sent |received |speedup/i.test(line)) {
          await log(jobId, 'info', line);
        }
      }
      if (stderrBuf.trim()) {
        await log(jobId, 'warn', `rsync stderr: ${stderrBuf.trim()}`);
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`rsync exited with code ${code}${stderrBuf ? ': ' + stderrBuf.trim() : ''}`));
      }
    });

    proc.on('error', reject);
  });
}

export async function runMoveDataset(job) {
  await ensureInitialized();
  const j = Array.isArray(job) ? job[0] : job;
  const jobId = j?.id;           // pg-boss UUID used as task_logs.job_id
  const { datasetId, datasetPath, checkPath, subdirName, movedBy } = j?.data ?? {};
  const destPath = path.join(checkPath, subdirName);
  const pool = getPool();

  try {
    await updateDatasetMoveStatus(datasetId, { moveStatus: 'moving', moveError: null });
    await log(jobId, 'info', `Starting move: ${datasetPath} → ${destPath}`);

    // --- Hash source images ---
    await log(jobId, 'info', 'Computing hash: images/ (source)…');
    const { hash: srcImagesHash, count: srcImagesCount } = computeMetadataHashWithCount(path.join(datasetPath, 'images'));
    await log(jobId, 'info', `Source images hash computed (${srcImagesCount} files): ${srcImagesHash.slice(0, 12)}…`);

    // --- Hash source labels ---
    await log(jobId, 'info', 'Computing hash: labels/ (source)…');
    const { hash: srcLabelsHash, count: srcLabelsCount } = computeMetadataHashWithCount(path.join(datasetPath, 'labels'));
    await log(jobId, 'info', `Source labels hash computed (${srcLabelsCount} files): ${srcLabelsHash.slice(0, 12)}…`);

    // --- rsync ---
    await log(jobId, 'info', `Running rsync (${srcImagesCount + srcLabelsCount} files total)…`);
    await rsyncWithLogs(datasetPath, destPath, jobId);
    await log(jobId, 'info', 'rsync completed successfully.');

    // --- Verify destination ---
    await updateDatasetMoveStatus(datasetId, { moveStatus: 'verifying' });
    await log(jobId, 'info', 'Verifying transfer: computing destination hashes…');

    await log(jobId, 'info', 'Computing hash: images/ (destination)…');
    const { hash: dstImagesHash, count: dstImagesCount } = computeMetadataHashWithCount(path.join(destPath, 'images'));
    await log(jobId, 'info', `Destination images hash (${dstImagesCount} files): ${dstImagesHash.slice(0, 12)}…`);

    await log(jobId, 'info', 'Computing hash: labels/ (destination)…');
    const { hash: dstLabelsHash, count: dstLabelsCount } = computeMetadataHashWithCount(path.join(destPath, 'labels'));
    await log(jobId, 'info', `Destination labels hash (${dstLabelsCount} files): ${dstLabelsHash.slice(0, 12)}…`);

    if (srcImagesHash !== dstImagesHash) {
      throw new Error(`Hash mismatch in images/: src=${srcImagesHash.slice(0, 12)}… dst=${dstImagesHash.slice(0, 12)}…`);
    }
    await log(jobId, 'info', 'images/ hash OK ✓');

    if (srcLabelsHash !== dstLabelsHash) {
      throw new Error(`Hash mismatch in labels/: src=${srcLabelsHash.slice(0, 12)}… dst=${dstLabelsHash.slice(0, 12)}…`);
    }
    await log(jobId, 'info', 'labels/ hash OK ✓');

    // --- Remove source ---
    await log(jobId, 'info', `Removing source directory: ${datasetPath}`);
    await fs.promises.rm(datasetPath, { recursive: true, force: true });
    await log(jobId, 'info', 'Source directory removed.');

    // --- Archive DB record (keep for history — do not delete) ---
    await archiveDataset(datasetId, movedBy ?? null, destPath);
    await log(jobId, 'info', `Dataset #${datasetId} archived in database (moved by user #${movedBy ?? 'unknown'}).`);
    await log(jobId, 'info', `Move complete. Dataset is now at: ${destPath}`);

  } catch (err) {
    await log(jobId, 'error', `Move failed: ${err.message}`);
    const current = await pool.query('SELECT move_attempt FROM datasets WHERE id = $1', [datasetId]);
    if (current.rows[0]) {
      const attempt = (current.rows[0].move_attempt || 0) + 1;
      await updateDatasetMoveStatus(datasetId, {
        moveStatus: 'failed',
        moveError: err.message,
        moveAttempt: attempt,
      });
    }
    throw err; // Let pg-boss know the job failed (triggers retry if configured)
  }
}
