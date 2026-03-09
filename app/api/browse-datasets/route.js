import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromHeaders } from '@/lib/auth';
import { isAdminOrDM } from '@/lib/permissions';
import { CONFIG } from '@/lib/manager';

export const dynamic = 'force-dynamic';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp', '.tiff', '.tif']);

function isDataset(dirPath) {
  try {
    return (
      fs.statSync(path.join(dirPath, 'images')).isDirectory() &&
      fs.statSync(path.join(dirPath, 'labels')).isDirectory()
    );
  } catch { return false; }
}

function countImages(dirPath) {
  try {
    return fs.readdirSync(path.join(dirPath, 'images'))
      .filter((f) => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
      .length;
  } catch { return 0; }
}

// Returns true if dirPath itself is a dataset OR any descendant (up to maxDepth) is
function subtreeHasDataset(dirPath, maxDepth = 5) {
  if (maxDepth <= 0) return false;
  if (isDataset(dirPath)) return true;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      if (subtreeHasDataset(path.join(dirPath, e.name), maxDepth - 1)) return true;
    }
  } catch { /* skip */ }
  return false;
}

export const GET = withApiLogging(async (req) => {
  const actor = getUserFromHeaders(req);
  if (!isAdminOrDM(actor)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const browsePath = searchParams.get('path') || CONFIG.datasetBasePath || '/';

  if (!fs.existsSync(browsePath) || !fs.statSync(browsePath).isDirectory()) {
    return NextResponse.json({ datasets: [], subdirs: [], currentPath: browsePath, parent: null });
  }

  const basePath = path.resolve(CONFIG.datasetBasePath || '/');
  const resolvedBrowse = path.resolve(browsePath);
  const parentDir = path.dirname(resolvedBrowse);
  const parent = (resolvedBrowse !== basePath && parentDir !== resolvedBrowse) ? parentDir : null;
  const datasets = [];
  const subdirs = [];

  let entries;
  try {
    entries = fs.readdirSync(browsePath, { withFileTypes: true });
  } catch {
    return NextResponse.json({ datasets: [], subdirs: [], currentPath: browsePath, parent });
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const fullPath = path.join(browsePath, entry.name);
    try {
      if (isDataset(fullPath)) {
        datasets.push({ name: entry.name, path: fullPath, imageCount: countImages(fullPath) });
      } else if (subtreeHasDataset(fullPath)) {
        subdirs.push({ name: entry.name, path: fullPath });
      }
    } catch { /* skip inaccessible */ }
  }

  datasets.sort((a, b) => a.name.localeCompare(b.name));
  subdirs.sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ datasets, subdirs, currentPath: browsePath, parent });
});
