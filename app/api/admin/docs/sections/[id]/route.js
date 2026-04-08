import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { updateDocSectionTranslation } from '@/lib/db';
import { normalizeDocLang } from '@/lib/help-docs';

export const dynamic = 'force-dynamic';

export const PUT = withApiLogging(async function handler(req, { params }) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (actor.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const sectionId = Number(params?.id);
  if (!Number.isInteger(sectionId) || sectionId <= 0) {
    return NextResponse.json({ error: 'Invalid section id' }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const lang = normalizeDocLang(body?.lang || 'en');
  const title = String(body?.title || '').trim();
  const summary = String(body?.summary || '').trim();
  const mdxContent = String(body?.mdxContent || '');

  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }

  const translation = await updateDocSectionTranslation(sectionId, {
    lang,
    title,
    summary,
    mdxContent,
    editorUserId: Number(actor.sub),
  });

  return NextResponse.json({ translation });
});
