import { NextResponse } from 'next/server';
import { getInstanceByName, updateInstanceFields } from '@/lib/db';
import { getJobUserState, upsertJobUserState } from '@/lib/db-datasets';
import { getUserFromRequest } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

export const dynamic = 'force-dynamic';

// GET: load selected images
// Params: jobId (preferred) OR name (legacy)
export const GET = withApiLogging(async (req) => {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');
    const name = searchParams.get('name');

    if (jobId) {
      const actor = await getUserFromRequest(req);
      if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      const state = await getJobUserState(Number(jobId), Number(actor.sub));
      return NextResponse.json({ selectedImages: state?.selectedImages || [] });
    }

    // Legacy fallback
    if (!name) return NextResponse.json({ error: 'Missing jobId or name' }, { status: 400 });
    const instance = await getInstanceByName(name);
    if (!instance) return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    return NextResponse.json({ selectedImages: instance.selectedImages || [] });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});

// POST: save selected images
// Body: { jobId, selectedImages } OR { name, selectedImages }
export const POST = withApiLogging(async (req) => {
  try {
    const body = await req.json();
    const { jobId, name, selectedImages } = body;

    if (jobId) {
      const actor = await getUserFromRequest(req);
      if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      await upsertJobUserState(Number(jobId), Number(actor.sub), {
        selectedImages: Array.isArray(selectedImages) ? selectedImages : []
      });
      return NextResponse.json({ success: true });
    }

    // Legacy fallback
    if (!name) return NextResponse.json({ error: 'Missing jobId or name' }, { status: 400 });
    const instance = await getInstanceByName(name);
    if (!instance) return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    await updateInstanceFields(name, {
      selectedImages: Array.isArray(selectedImages) ? selectedImages : []
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});
