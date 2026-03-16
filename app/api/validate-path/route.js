import fs from 'fs';
import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/validate-path?path=...
// Returns { exists: bool, writable: bool } for the given absolute path.
export const GET = withApiLogging(async function handler(req) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (actor.role !== 'admin' && actor.role !== 'data-manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const dirPath = searchParams.get('path');
  if (!dirPath) return NextResponse.json({ error: 'path is required' }, { status: 400 });

  let exists = false;
  let writable = false;

  try {
    const stat = fs.statSync(dirPath);
    exists = stat.isDirectory();
  } catch {
    exists = false;
  }

  if (exists) {
    try {
      fs.accessSync(dirPath, fs.constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
  }

  return NextResponse.json({ exists, writable });
});
