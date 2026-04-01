/**
 * pg-boss worker: duplicate-scan
 *
 * Ported from the Python duplicate detection script.
 * Job data: { datasetId, datasetPath, datasetName, createdBy, duplicateMode, duplicateLabels, threshold, debug }
 */

import fs from 'fs';
import path from 'path';
import { appendTaskLog } from './db-tasks.js';
import { createDatasetJobs, getJobsByDataset, assignJob } from './db-datasets.js';
import { getMatchingDuplicateRule } from './manager.js';
import { getPool } from './db.js';

// ---------------------------------------------------------------------------
// IoU + label parsing
// ---------------------------------------------------------------------------

function calculateIou(box1, box2) {
  // box: [x_center, y_center, w, h]
  const [x1, y1, w1, h1] = box1;
  const [x2, y2, w2, h2] = box2;

  const x1min = x1 - w1 / 2, x1max = x1 + w1 / 2;
  const y1min = y1 - h1 / 2, y1max = y1 + h1 / 2;
  const x2min = x2 - w2 / 2, x2max = x2 + w2 / 2;
  const y2min = y2 - h2 / 2, y2max = y2 + h2 / 2;

  const interX = Math.max(0, Math.min(x1max, x2max) - Math.max(x1min, x2min));
  const interY = Math.max(0, Math.min(y1max, y2max) - Math.max(y1min, y2min));
  const interArea = interX * interY;

  const unionArea = w1 * h1 + w2 * h2 - interArea;
  return unionArea > 0 ? interArea / unionArea : 0;
}

/** Returns array of [classId, cx, cy, w, h] tuples, or [] if no label file. */
function parseYoloLabels(imagePath) {
  const labelPath = imagePath
    .replace(/[/\\]images[/\\]/, (sep) => sep.replace('images', 'labels'))
    .replace(/\.[^.]+$/, '.txt');

  if (!fs.existsSync(labelPath)) return [];

  const labels = [];
  for (const line of fs.readFileSync(labelPath, 'utf8').split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 5) {
      labels.push([
        parseInt(parts[0], 10),
        parseFloat(parts[1]),
        parseFloat(parts[2]),
        parseFloat(parts[3]),
        parseFloat(parts[4]),
      ]);
    }
  }
  return labels;
}

function labelsAreSimilar(labels1, labels2, threshold, limit) {
  let l1 = labels1, l2 = labels2;
  if (limit > 0) {
    l1 = labels1.slice(0, limit);
    l2 = labels2.slice(0, limit);
  }
  if (l1.length !== l2.length || l1.length === 0) return false;

  // Class set must match
  const classes1 = [...l1.map((l) => l[0])].sort((a, b) => a - b);
  const classes2 = [...l2.map((l) => l[0])].sort((a, b) => a - b);
  if (classes1.join(',') !== classes2.join(',')) return false;

  // Greedy box matching
  const used = new Set();
  for (const b1 of l1) {
    let matched = false;
    for (let i = 0; i < l2.length; i++) {
      if (!used.has(i) && b1[0] === l2[i][0]) {
        if (calculateIou(b1.slice(1), l2[i].slice(1)) >= threshold) {
          used.add(i);
          matched = true;
          break;
        }
      }
    }
    if (!matched) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Group processing (move / delete)
// ---------------------------------------------------------------------------

function processGroup(datasetPath, groupIndices, allPaths, action, debug) {
  const toProcess = groupIndices.slice(1); // duplicates to move/delete
  const processed = [];

  // In debug mode with move action: copy the original (index 0) into duplicate/ for comparison
  if (debug && action === 'move' && groupIndices.length > 1) {
    const origSrc = allPaths[groupIndices[0]];
    const origLabelSrc = origSrc
      .replace(/[/\\]images[/\\]/, (sep) => sep.replace('images', 'labels'))
      .replace(/\.[^.]+$/, '.txt');

    const destDir = path.join(datasetPath, 'duplicate');
    fs.mkdirSync(path.join(destDir, 'images'), { recursive: true });
    fs.mkdirSync(path.join(destDir, 'labels'), { recursive: true });

    fs.copyFileSync(origSrc, path.join(destDir, 'images', path.basename(origSrc)));
    if (fs.existsSync(origLabelSrc)) {
      fs.copyFileSync(origLabelSrc, path.join(destDir, 'labels', path.basename(origLabelSrc)));
    }
    processed.push(`Copied (original): ${path.basename(origSrc)} → duplicate/`);
  }

  for (const idx of toProcess) {
    const imgSrc = allPaths[idx];
    const labelSrc = imgSrc
      .replace(/[/\\]images[/\\]/, (sep) => sep.replace('images', 'labels'))
      .replace(/\.[^.]+$/, '.txt');

    if (action === 'delete') {
      if (fs.existsSync(imgSrc))   fs.unlinkSync(imgSrc);
      if (fs.existsSync(labelSrc)) fs.unlinkSync(labelSrc);
      processed.push(`Deleted: ${path.basename(imgSrc)}`);

    } else if (action === 'move') {
      const destDir = path.join(datasetPath, 'duplicate');
      fs.mkdirSync(path.join(destDir, 'images'), { recursive: true });
      fs.mkdirSync(path.join(destDir, 'labels'), { recursive: true });

      const imgDest = path.join(destDir, 'images', path.basename(imgSrc));
      fs.renameSync(imgSrc, imgDest);
      if (fs.existsSync(labelSrc)) {
        fs.renameSync(labelSrc, path.join(destDir, 'labels', path.basename(labelSrc)));
      }
      processed.push(`Moved: ${path.basename(imgSrc)} → duplicate/`);
    }
  }
  return processed;
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------

async function handleDuplicates({ datasetPath, threshold, mode, labelsLimit, debug, log }) {
  const imgDir = path.join(datasetPath, 'images');
  if (!fs.existsSync(imgDir)) {
    await log('error', `Images directory not found: ${imgDir}`);
    return { duplicateGroups: 0, processed: 0 };
  }

  const IMAGE_EXT = /\.(jpe?g|png|bmp|webp)$/i;
  const images = fs.readdirSync(imgDir)
    .filter((f) => IMAGE_EXT.test(f))
    .sort()
    .map((f) => path.join(imgDir, f));

  await log('info', `Found ${images.length} images`);

  if (images.length === 0) return { duplicateGroups: 0, processed: 0 };

  const visited = new Array(images.length).fill(false);
  let duplicateGroups = 0;
  let totalProcessed = 0;

  for (let i = 0; i < images.length; i++) {
    if (visited[i]) continue;

    const baseLabels = parseYoloLabels(images[i]);
    if (baseLabels.length === 0) continue;

    const group = [i];

    for (let j = i + 1; j < images.length; j++) {
      if (visited[j]) continue;
      const compareLabels = parseYoloLabels(images[j]);
      if (labelsAreSimilar(baseLabels, compareLabels, threshold, labelsLimit)) {
        group.push(j);
        visited[j] = true;
      } else {
        break; // maintain sequential continuity
      }
    }

    if (group.length > 1) {
      duplicateGroups++;
      const msgs = processGroup(datasetPath, group, images, mode, debug);
      for (const msg of msgs) {
        await log('info', msg);
        totalProcessed++;
      }
    }
  }

  return { duplicateGroups, processed: totalProcessed };
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

export async function runDuplicateScan(job) {
  const jobData = Array.isArray(job) ? job[0]?.data : job?.data;
  if (!jobData) {
    console.error('[duplicate-scan-worker] job.data missing, shape:', JSON.stringify(job));
    throw new Error('job.data is undefined — pg-boss API mismatch');
  }

  const {
    datasetId,
    datasetPath,
    datasetName,
    duplicateMode,
    duplicateLabels,
    threshold,
    debug,
    autoAssignTo,
  } = jobData;

  const jobId = Array.isArray(job) ? job[0]?.id : job?.id;
  const log = (level, msg) => appendTaskLog(jobId, level, msg);

  try {
    await log('info', `Duplicate scan started for "${datasetName || datasetPath}"`);

    // Apply env rule overrides if a matching rule exists
    let action    = duplicateMode || 'move';
    let labelsLimit = duplicateLabels ?? 0;
    let iou       = threshold ?? 0.8;
    let isDebug   = debug ?? false;

    const rule = getMatchingDuplicateRule(datasetPath);
    if (rule) {
      await log('info', `Matched rule pattern "${rule.matchedPattern}": rule action=${rule.action} (dataset override: ${action})`);
      // Dataset-level settings take priority — rule only fills in labelsLimit if unset
      if (labelsLimit === 0 && rule.labels > 0) labelsLimit = rule.labels;
    }

    let duplicateRemovedCount = 0;

    if (action === 'skip') {
      await log('info', 'Action is "skip" — no duplicate processing done.');
    } else {
      await log('info', `Config — mode: ${action}, IoU: ${iou}, labels limit: ${labelsLimit}, debug: ${isDebug}`);

      const { duplicateGroups, processed } = await handleDuplicates({
        datasetPath,
        threshold: iou,
        mode: action,
        labelsLimit,
        debug: isDebug,
        log,
      });

      duplicateRemovedCount = processed;
      await log('info', `Scan done — ${duplicateGroups} duplicate group(s), ${processed} file(s) ${action === 'move' ? 'moved' : 'deleted'}.`);
    }

    // Store duplicate removed count on the dataset record.
    if (duplicateRemovedCount > 0) {
      try {
        const pool = getPool();
        await pool.query(
          'UPDATE datasets SET duplicate_removed_count = $1 WHERE id = $2',
          [duplicateRemovedCount, datasetId]
        );
      } catch (err) {
        await log('warn', `Failed to store duplicate_removed_count: ${err.message}`);
      }
    }

    await log('info', 'Slicing dataset into jobs…');
    const { totalImages, jobCount } = await createDatasetJobs(datasetId);
    await log('info', `Jobs created — ${totalImages} images → ${jobCount} job(s).`);

    // Run hash baseline inline so this task only completes after all label files
    // are hashed.  Pass the current pg-boss job ID so the hash logs appear in
    // the same task timeline.
    const { runHashBaseline } = await import('./hash-baseline-worker.js');
    await runHashBaseline({ id: jobId, data: { datasetId, datasetPath } });

    if (autoAssignTo) {
      try {
        const jobs = await getJobsByDataset(datasetId, { role: 'admin' });
        let assigned = 0;
        for (const j of jobs) {
          try {
            await assignJob(j.id, autoAssignTo, autoAssignTo);
            assigned++;
          } catch (err) {
            await log('warn', `Failed to auto-assign job #${j.id} (index ${j.jobIndex}): ${err.message}`);
          }
        }
        await log('info', `Auto-assigned ${assigned}/${jobs.length} job(s) to user #${autoAssignTo}.`);
        if (assigned < jobs.length) {
          await log('warn', `${jobs.length - assigned} job(s) were not assigned — check warnings above. Admin can assign them manually from the dataset page.`);
        }
      } catch (err) {
        await log('warn', `Auto-assign failed: ${err.message}`);
      }
    }
  } catch (err) {
    await log('error', `Scan failed: ${err.message}`);
    throw err;
  }
}
