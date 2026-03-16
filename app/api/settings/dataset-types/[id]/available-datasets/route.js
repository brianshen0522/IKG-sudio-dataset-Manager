import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getDatasetTypeById, getPool, ensureInitialized } from '@/lib/db';
import { scanImageFilenames } from '@/lib/dataset-utils';

export const dynamic = 'force-dynamic';

// GET /api/settings/dataset-types/:id/available-datasets
export const GET = withApiLogging(async function handler(req, { params }) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (actor.role !== 'admin' && actor.role !== 'data-manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const type = await getDatasetTypeById(id);
  if (!type) return NextResponse.json({ error: 'Dataset type not found' }, { status: 404 });

  // Read subdirs under uncheck_path
  let entries;
  try {
    entries = await fs.promises.readdir(type.uncheckPath, { withFileTypes: true });
  } catch {
    return NextResponse.json({ error: `Cannot read directory: ${type.uncheckPath}` }, { status: 422 });
  }

  const subdirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  // Keep only those with images/ and labels/ subdirs
  const valid = subdirs.filter((name) => {
    const dirPath = path.join(type.uncheckPath, name);
    try {
      const stat1 = fs.statSync(path.join(dirPath, 'images'));
      const stat2 = fs.statSync(path.join(dirPath, 'labels'));
      return stat1.isDirectory() && stat2.isDirectory();
    } catch {
      return false;
    }
  });

  // Filter out already-registered datasets
  await ensureInitialized();
  const { rows } = await getPool().query('SELECT dataset_path FROM datasets');
  const registeredPaths = new Set(rows.map((r) => r.dataset_path));

  const available = valid
    .filter((name) => !registeredPaths.has(path.join(type.uncheckPath, name)))
    .map((name) => {
      const dirPath = path.join(type.uncheckPath, name);
      let imageCount = 0;
      try {
        imageCount = scanImageFilenames(dirPath).length;
      } catch { /* ignore */ }
      return { name, path: dirPath, imageCount };
    });

  return NextResponse.json({ type, available });
});
