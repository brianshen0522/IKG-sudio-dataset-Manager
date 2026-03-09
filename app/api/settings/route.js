import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getAllSettings, setSetting } from '@/lib/db';

// GET /api/settings — read system settings (admin only)
export const GET = withApiLogging(async function handler(req) {
  const actor = await getUserFromRequest(req);
  if (!actor || actor.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const settings = await getAllSettings();
  return NextResponse.json({ settings });
});

// PUT /api/settings — update system settings (admin only)
export const PUT = withApiLogging(async function handler(req) {
  const actor = await getUserFromRequest(req);
  if (!actor || actor.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { job_size } = body || {};
  if (job_size !== undefined) {
    const size = parseInt(job_size, 10);
    if (isNaN(size) || size < 1) {
      return NextResponse.json({ error: 'job_size must be a positive integer' }, { status: 400 });
    }
    await setSetting('job_size', size, Number(actor.sub));
  }

  const settings = await getAllSettings();
  return NextResponse.json({ settings });
});
