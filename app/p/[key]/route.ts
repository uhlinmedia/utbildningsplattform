import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { setPersonCookie } from '@/lib/person';

// Personlig länk: loggar in personen och går till Mina utbildningar. Fungerar tills länken byts eller stängs av.
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const [p] = key.length >= 20
    ? await sql<{ id: string; session_version: number }[]>`
        select id, session_version from person where access_key = ${key} and archived_at is null`
    : [];
  const url = new URL(req.url);
  const base = process.env.APP_URL || url.origin;
  if (!p) return NextResponse.redirect(new URL('/mina?ogiltig=1', base));
  await setPersonCookie(p);
  return NextResponse.redirect(new URL('/mina', base));
}
