import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getVisibleDocPages } from '@/lib/db';
import { normalizeDocLang, normalizeDocRole } from '@/lib/help-docs';

export const dynamic = 'force-dynamic';

export const GET = withApiLogging(async function handler(req) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const lang = normalizeDocLang(searchParams.get('lang') || 'en');
  const role = normalizeDocRole(actor.role);
  const pages = await getVisibleDocPages({ role, lang });

  return NextResponse.json({ lang, role, pages });
});
