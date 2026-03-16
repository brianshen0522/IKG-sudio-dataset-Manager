import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Compute a deterministic metadata hash of all files under dirPath.
 * Uses filename (relative), size, and mtime — fast, no file content read.
 * Returns hex string, or empty string if dir doesn't exist.
 */
export function computeMetadataHash(dirPath) {
  return computeMetadataHashWithCount(dirPath).hash;
}

export function computeMetadataHashWithCount(dirPath) {
  const hash = crypto.createHash('sha256');
  const files = [];
  collectFiles(dirPath, dirPath, files);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  for (const { rel, stat } of files) {
    hash.update(`${rel}\0${stat.size}\0${stat.mtimeMs}\n`);
  }
  return { hash: hash.digest('hex'), count: files.length };
}

function collectFiles(root, dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(root, full, out);
    } else {
      try {
        out.push({ rel: path.relative(root, full), stat: fs.statSync(full) });
      } catch { /* ignore */ }
    }
  }
}
