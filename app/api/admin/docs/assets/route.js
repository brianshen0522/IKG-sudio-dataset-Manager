import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

function sanitizeBaseName(name) {
  return String(name || 'asset')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'asset';
}

function extFromFile(file) {
  const fileExt = path.extname(file.name || '').toLowerCase();
  if (fileExt) return fileExt;
  if (file.type === 'image/png') return '.png';
  if (file.type === 'image/jpeg') return '.jpg';
  if (file.type === 'image/webp') return '.webp';
  if (file.type === 'image/gif') return '.gif';
  return '';
}

export const POST = withApiLogging(async function handler(req) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (actor.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Only PNG, JPG, WEBP, and GIF are allowed' }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const ext = extFromFile(file);
  const basename = sanitizeBaseName(file.name);
  const filename = `${Date.now()}-${randomUUID().slice(0, 8)}-${basename}${ext}`;
  const relDir = path.join('doc-assets', actor.username || 'admin');
  const absDir = path.join(process.cwd(), 'public', relDir);
  await fs.mkdir(absDir, { recursive: true });
  const absPath = path.join(absDir, filename);
  await fs.writeFile(absPath, buffer);

  const publicUrl = `/${path.posix.join(relDir.replace(/\\/g, '/'), filename)}`;
  const alt = basename.replace(/-/g, ' ');
  const markdown = file.type === 'image/gif'
    ? `![${alt}](${publicUrl})`
    : `![${alt}](${publicUrl})`;

  return NextResponse.json({
    asset: {
      url: publicUrl,
      name: file.name,
      contentType: file.type,
      size: file.size,
      markdown,
    },
  });
});
