import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { containsClassFiles } from '@/lib/manager';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromHeaders } from '@/lib/auth';
import { isAdminOrDM } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export const GET = withApiLogging(async (req) => {
  const actor = getUserFromHeaders(req);
  if (!isAdminOrDM(actor)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    let browsePath = searchParams.get('path') || '/';
    const filterClassFiles = searchParams.get('filterClassFiles') === 'true';

    if (browsePath === '' || browsePath === 'root') browsePath = '/';
    if (!fs.existsSync(browsePath)) return NextResponse.json({ folders: [], files: [] });

    const stat = fs.statSync(browsePath);
    if (!stat.isDirectory()) return NextResponse.json({ folders: [], files: [] });

    const entries = fs.readdirSync(browsePath, { withFileTypes: true });
    const folders = [];
    const files = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      try {
        if (entry.isDirectory()) {
          if (filterClassFiles) {
            if (containsClassFiles(path.join(browsePath, entry.name))) folders.push(entry.name);
          } else {
            folders.push(entry.name);
          }
        } else if (entry.isFile()) {
          files.push(entry.name);
        }
      } catch { /* skip inaccessible entries */ }
    }

    folders.sort();
    files.sort();
    return NextResponse.json({ folders, files });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});
