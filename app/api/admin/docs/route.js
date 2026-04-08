import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getAllDocPagesForAdmin } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = withApiLogging(async function handler(req) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (actor.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const pages = await getAllDocPagesForAdmin();
  return NextResponse.json({ pages });
});
