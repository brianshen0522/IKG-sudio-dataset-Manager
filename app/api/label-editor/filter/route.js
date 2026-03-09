import { NextResponse } from 'next/server';
import { getInstanceByName, updateInstanceFields } from '@/lib/db';
import { getJobUserState, upsertJobUserState } from '@/lib/db-datasets';
import { getUserFromRequest } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

export const dynamic = 'force-dynamic';

// GET: load saved filter
// Params: jobId (preferred) OR name (legacy instance fallback)
export const GET = withApiLogging(async (req) => {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');
    const name = searchParams.get('name');

    if (jobId) {
      const actor = await getUserFromRequest(req);
      if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      const state = await getJobUserState(Number(jobId), Number(actor.sub));
      return NextResponse.json({
        filter: state?.filter || null,
        previewSortMode: state?.previewSortMode || null
      });
    }

    // Legacy fallback
    if (!name) return NextResponse.json({ error: 'Missing jobId or name' }, { status: 400 });
    const instance = await getInstanceByName(name);
    if (!instance) return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    return NextResponse.json({ filter: instance.filter || null, previewSortMode: instance.previewSortMode || null });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});

// POST: save filter
// Body: { jobId, filter, previewSortMode } OR { name, filter, previewSortMode }
export const POST = withApiLogging(async (req) => {
  try {
    const body = await req.json();
    const { jobId, name, filter, previewSortMode } = body;

    if (jobId) {
      const actor = await getUserFromRequest(req);
      if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      const fields = {};
      if (Object.prototype.hasOwnProperty.call(body, 'filter')) {
        fields.filter = filter && typeof filter === 'object' ? filter : null;
      }
      if (previewSortMode !== undefined) fields.previewSortMode = previewSortMode || null;
      await upsertJobUserState(Number(jobId), Number(actor.sub), fields);
      return NextResponse.json({ success: true });
    }

    // Legacy fallback
    if (!name) return NextResponse.json({ error: 'Missing jobId or name' }, { status: 400 });
    const instance = await getInstanceByName(name);
    if (!instance) return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    const fields = {};
    if (Object.prototype.hasOwnProperty.call(body, 'filter')) {
      fields.filter = filter && typeof filter === 'object' ? filter : null;
    }
    if (previewSortMode !== undefined) fields.previewSortMode = previewSortMode || null;
    await updateInstanceFields(name, fields);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});
