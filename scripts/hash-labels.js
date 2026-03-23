#!/usr/bin/env node
/**
 * Compute a metadata hash of the labels/ directory for one or more dataset paths.
 *
 * Usage:
 *   node scripts/hash-labels.js <dataset-path> [<dataset-path> ...]
 *
 * Example:
 *   node scripts/hash-labels.js /data/datasets/my-dataset
 *   node scripts/hash-labels.js /data/datasets/ds1 /data/datasets/ds2
 *
 * Output:
 *   /data/datasets/my-dataset/labels  42 files  a3f9c1d2e5b8...
 */

import path from 'path';
import { computeMetadataHashWithCount } from '../src/lib/dataset-hash.js';

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: node scripts/hash-labels.js <dataset-path> [<dataset-path> ...]');
  process.exit(1);
}

for (const datasetPath of args) {
  const labelsDir = path.join(datasetPath, 'labels');
  const { hash, count } = computeMetadataHashWithCount(labelsDir);
  console.log(`${labelsDir}  ${count} files  ${hash}`);
}
