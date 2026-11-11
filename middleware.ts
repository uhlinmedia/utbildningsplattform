import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_COOKIE, verifyUserSession } from './lib/session';

// Första skyddet för adminsidorna. Den riktiga kontrollen (roll, kund, avstängt konto) görs på servern
// i varje sida och åtgärd (lib/access.ts).
const OPEN = [/^\/admin\/login(\/|$)/, /^\/admin\/inbjudan\//, /^\/admin\/losenord(\/|$)/];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (OPEN.some((r) => r.test(pathname))) return NextResponse.next();
  const s = await verifyUserSession(req.cookies.get(ADMIN_COOKIE)?.value);
  const url = req.nextUrl.clone();
  url.search = '';
  if (!s) {
    url.pathname = '/admin/login';
    return NextResponse.redirect(url);
  }
  if (s.stage === 'setup' && pathname !== '/admin/tvasteg') {
    url.pathname = '/admin/tvasteg';
    return NextResponse.redirect(url);
  }
  if (s.stage === 'mfa') {
    url.pathname = '/admin/login/kod';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/admin/:path*'] };
