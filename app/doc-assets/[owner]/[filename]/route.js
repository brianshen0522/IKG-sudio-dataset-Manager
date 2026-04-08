import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function safeSegment(value) {
  const segment = String(value || '').trim();
  if (!segment || segment.includes('/') || segment.includes('\\') || segment === '.' || segment === '..') {
    return null;
  }
  return segment;
}

export async function GET(_req, { params }) {
  const owner = safeSegment(params?.owner);
  const filename = safeSegment(params?.filename);

  if (!owner || !filename) {
    return NextResponse.json({ error: 'Invalid asset path' }, { status: 400 });
  }

  const absPath = path.join(process.cwd(), 'public', 'doc-assets', owner, filename);

  try {
    const file = await fs.readFile(absPath);
    const ext = path.extname(filename).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    return new NextResponse(file, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to read asset' }, { status: 500 });
  }
}
