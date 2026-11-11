import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { sql } from './db';
import { ADMIN_COOKIE, verifyUserSession, type Stage } from './session';

// Behörighet för admin och kundanvändare. Används i VARJE adminsida och serveråtgärd.
//
// Roller:  superadmin  – allt, alla kunder (Briondo)
//          kundadmin   – allt inom sin kund: användare, personregister, kundprofil, utbildningar
//          utbildare   – utbildningar (skapa, redigera, statistik) och personregister inom sin kund
//          granskare   – bara läsa: statistik, register, export inom sin kund
//
// Behov:   read < edit < admin < super

export type Role = 'superadmin' | 'kundadmin' | 'utbildare' | 'granskare';
export type Need = 'read' | 'edit' | 'admin' | 'super';

export const roleLabel: Record<Role, string> = {
  superadmin: 'Superadmin',
  kundadmin: 'Kundadmin',
  utbildare: 'Utbildningsansvarig',
  granskare: 'Läsbehörighet',
};
export const roleHint: Record<Exclude<Role, 'superadmin'>, string> = {
  kundadmin: 'Allt inom kunden: användare, personregister, kundprofil och utbildningar',
  utbildare: 'Skapa och redigera utbildningar, se statistik, hantera personregistret',
  granskare: 'Bara läsa: statistik, personregister och export (t.ex. för kontroll)',
};

const rank: Record<Role, number> = { granskare: 1, utbildare: 2, kundadmin: 3, superadmin: 4 };
const needRank: Record<Need, number> = { read: 1, edit: 2, admin: 3, super: 4 };

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  customer_id: string | null;
  totp_enabled: boolean;
  session_version: number;
};

// Läser kakan och kontrollerar mot databasen (avstängt konto, utloggad överallt efter lösenordsbyte).
export const sessionUser = cache(async (stages: Stage[] = ['full']): Promise<User | null> => {
  const store = await cookies();
  const claims = await verifyUserSession(store.get(ADMIN_COOKIE)?.value);
  if (!claims || !stages.includes(claims.stage)) return null;
  const [u] = await sql<(User & { disabled: boolean; password_hash: string | null })[]>`
    select id, email, name, role, customer_id, totp_enabled, session_version, disabled, password_hash
    from admin_user where id = ${claims.sub}`;
  if (!u || u.disabled || !u.password_hash || u.session_version !== claims.ver) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role, customer_id: u.customer_id, totp_enabled: u.totp_enabled, session_version: u.session_version };
});

export function can(user: User, customerId: string | null | undefined, need: Need) {
  if (user.role === 'superadmin') return true;
  if (need === 'super' || !customerId || user.customer_id !== customerId) return false;
  return rank[user.role] >= needRank[need];
}

export const hasRole = (user: User, need: Need) => rank[user.role] >= needRank[need];

// Sidor: inte inloggad → inloggningen. Ingen behörighet → 404 (avslöjar inte att något finns).
export async function requireUser(need: Need = 'read') {
  const u = await sessionUser();
  if (!u) redirect('/admin/login');
  if (!hasRole(u, need)) notFound();
  return u;
}

export async function requireCustomerPage(customerId: string, need: Need = 'read') {
  const u = await requireUser();
  if (!can(u, customerId, need)) notFound();
  return u;
}

export type Kind = 'customer' | 'course' | 'chapter' | 'section' | 'block' | 'badge' | 'person' | 'user';

// Vilken kund hör ett objekt till?
export async function customerOf(kind: Kind, id: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await (() => {
    switch (kind) {
      case 'customer': return sql<{ c: string }[]>`select id as c from customer where id = ${id}`;
      case 'course': return sql<{ c: string }[]>`select customer_id as c from course where id = ${id}`;
      case 'chapter': return sql<{ c: string }[]>`select co.customer_id as c from chapter ch join course co on co.id = ch.course_id where ch.id = ${id}`;
      case 'section': return sql<{ c: string }[]>`
        select co.customer_id as c from section s join chapter ch on ch.id = s.chapter_id join course co on co.id = ch.course_id where s.id = ${id}`;
      case 'block': return sql<{ c: string }[]>`
        select co.customer_id as c from block b join section s on s.id = b.section_id join chapter ch on ch.id = s.chapter_id
        join course co on co.id = ch.course_id where b.id = ${id}`;
      case 'badge': return sql<{ c: string }[]>`select customer_id as c from cert_badge where id = ${id}`;
      case 'person': return sql<{ c: string }[]>`select customer_id as c from person where id = ${id}`;
      case 'user': return sql<{ c: string }[]>`select customer_id as c from admin_user where id = ${id}`;
    }
  })();
  return rows[0]?.c ?? null;
}

// Serveråtgärder: kastar fel om användaren saknar behörighet till objektet.
export class AccessError extends Error {}

export async function authorize(kind: Kind, id: string, need: Need) {
  const u = await sessionUser();
  if (!u) redirect('/admin/login');
  const customerId = await customerOf(kind, id);
  if (!customerId || !can(u, customerId, need)) throw new AccessError('Ingen behörighet');
  return { user: u, customerId };
}

export async function authorizeRole(need: Need) {
  const u = await sessionUser();
  if (!u) redirect('/admin/login');
  if (!hasRole(u, need)) throw new AccessError('Ingen behörighet');
  return u;
}

// Ändringslogg. Fel här får aldrig stoppa själva åtgärden.
export async function audit(user: User | null, customerId: string | null, action: string, detail: Record<string, unknown> = {}) {
  try {
    await sql`insert into audit_log (user_id, user_email, customer_id, action, detail)
      values (${user?.id ?? null}, ${user?.email ?? null}, ${customerId}, ${action}, ${sql.json(detail as never)})`;
  } catch (e) {
    console.error('audit_log', e);
  }
}
