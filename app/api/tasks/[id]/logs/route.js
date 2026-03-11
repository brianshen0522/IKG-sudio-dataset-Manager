import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromHeaders } from '@/lib/auth';
import { isAdminOrDM } from '@/lib/permissions';
import { getTaskLogs } from '@/lib/db-tasks';

export const dynamic = 'force-dynamic';

export const GET = withApiLogging(async (req, { params }) => {
  const actor = getUserFromHeaders(req);
  if (!isAdminOrDM(actor)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = params;
  const { searchParams } = new URL(req.url);
  const limit  = Math.min(parseInt(searchParams.get('limit')  || '50', 10), 200);
  const before = searchParams.get('before') ? parseInt(searchParams.get('before'), 10) : null;
  const after  = searchParams.get('after')  ? parseInt(searchParams.get('after'),  10) : null;

  const logs = await getTaskLogs(id, { limit, before, after });
  return NextResponse.json({ logs });
});
