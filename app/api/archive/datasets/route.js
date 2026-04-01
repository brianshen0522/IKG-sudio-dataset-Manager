import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getArchivedDatasets } from '@/lib/db-datasets';

export const dynamic = 'force-dynamic';

// GET /api/archive/datasets
// Returns all archived datasets with per-job edit stats and assignment history.
// Admin and data-manager only.
export const GET = withApiLogging(async (req) => {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (actor.role !== 'admin' && actor.role !== 'data-manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const datasets = await getArchivedDatasets();
  return NextResponse.json({ datasets });
});
