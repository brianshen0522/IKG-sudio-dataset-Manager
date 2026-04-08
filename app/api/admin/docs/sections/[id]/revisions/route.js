import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getDocRevisionHistory } from '@/lib/db';
import { normalizeDocLang } from '@/lib/help-docs';

export const dynamic = 'force-dynamic';

export const GET = withApiLogging(async function handler(req, { params }) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (actor.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const sectionId = Number(params?.id);
  if (!Number.isInteger(sectionId) || sectionId <= 0) {
    return NextResponse.json({ error: 'Invalid section id' }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const lang = normalizeDocLang(searchParams.get('lang') || 'en');
  const revisions = await getDocRevisionHistory(sectionId, lang, 20);

  return NextResponse.json({ revisions });
});
