import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromHeaders } from '@/lib/auth';
import { isAdminOrDM } from '@/lib/permissions';
import { CONFIG } from '@/lib/manager';

export const dynamic = 'force-dynamic';

// Recursively search for classes.txt inside dirPath (BFS, max depth)
function findInsideRecursive(dirPath, maxDepth = 6) {
  const queue = [[dirPath, 0]];
  while (queue.length > 0) {
    const [cur, depth] = queue.shift();
    if (depth > maxDepth) continue;
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && e.name === 'classes.txt') return path.join(cur, e.name);
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) queue.push([path.join(cur, e.name), depth + 1]);
    }
  }
  return null;
}

// Walk up parent directories looking for classes.txt (stops at DATASET_BASE_PATH)
function findUpward(dirPath, basePath) {
  let current = dirPath;
  let iterations = 0;
  while (iterations < 20) {
    const candidate = path.join(current, 'classes.txt');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break; // reached filesystem root
    // Don't go above the base path
    if (basePath && !parent.startsWith(basePath)) break;
    current = parent;
    iterations++;
  }
  return null;
}

export const GET = withApiLogging(async (req) => {
  const actor = getUserFromHeaders(req);
  if (!isAdminOrDM(actor)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const datasetPath = searchParams.get('path');
  if (!datasetPath) return NextResponse.json({ classFile: null });

  const basePath = CONFIG.datasetBasePath || '/';

  // 1. Search inside the dataset folder recursively
  const inside = findInsideRecursive(datasetPath);
  if (inside) return NextResponse.json({ classFile: inside });

  // 2. Walk up parent folders
  const upward = findUpward(path.dirname(datasetPath), basePath);
  if (upward) return NextResponse.json({ classFile: upward });

  return NextResponse.json({ classFile: null });
});
