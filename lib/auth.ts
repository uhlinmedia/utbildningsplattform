import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE, verifyAdminSession } from './session';

// Kontroll i varje server action – middleware räcker inte som enda skydd.
export async function requireAdmin() {
  const store = await cookies();
  const id = await verifyAdminSession(store.get(ADMIN_COOKIE)?.value);
  if (!id) redirect('/admin/login');
  return id;
}

export async function isAdmin() {
  const store = await cookies();
  return !!(await verifyAdminSession(store.get(ADMIN_COOKIE)?.value));
}
