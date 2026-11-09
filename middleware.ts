import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_COOKIE, verifyAdminSession } from './lib/session';

// Skyddar alla adminsidor utom inloggningen.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === '/admin/login') return NextResponse.next();
  const adminId = await verifyAdminSession(req.cookies.get(ADMIN_COOKIE)?.value);
  if (!adminId) {
    const url = req.nextUrl.clone();
    url.pathname = '/admin/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/admin/:path*'] };
