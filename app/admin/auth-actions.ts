'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import { ADMIN_COOKIE, signUserSession, verifyUserSession, type Stage } from '@/lib/session';
import { audit, sessionUser } from '@/lib/access';
import {
  decryptSecret, newRecoveryCodes, normalizeRecovery, sha256, verifyTotp,
} from '@/lib/totp';
import { appUrl, mailTemplate, sendMail } from '@/lib/mail';
import { createUserToken, lookupUserToken, pendingUser, type DbUser } from '@/lib/users';

const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
// Används när kontot inte finns, så att inloggningen tar lika lång tid oavsett.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const MIN_PASSWORD = 12;

async function setSession(userId: string, stage: Stage, ver: number) {
  const store = await cookies();
  store.set(ADMIN_COOKIE, await signUserSession(userId, stage, ver), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: stage === 'full' ? 60 * 60 * 12 : 60 * 15,
  });
}

const home = (u: { role: string; customer_id: string | null }) => (u.role === 'superadmin' ? '/admin' : `/admin/kunder/${u.customer_id}`);

async function failed(u: DbUser) {
  const n = u.failed_logins + 1;
  if (n >= MAX_FAILS) {
    await sql`update admin_user set failed_logins = 0, locked_until = now() + ${`${LOCK_MINUTES} minutes`}::interval where id = ${u.id}`;
    await audit(null, u.customer_id, 'konto_last', { email: u.email });
  } else {
    await sql`update admin_user set failed_logins = ${n} where id = ${u.id}`;
  }
}

const isLocked = (u: DbUser) => !!u.locked_until && u.locked_until.getTime() > Date.now();

/* ---------- Inloggning ---------- */

export async function login(fd: FormData) {
  const email = s(fd, 'email').toLowerCase();
  const password = String(fd.get('password') ?? '');
  const [u] = await sql<DbUser[]>`select * from admin_user where lower(email) = ${email}`;
  // Jämför alltid mot en hash så att svarstiden inte avslöjar om kontot finns.
  const ok = await bcrypt.compare(password, u?.password_hash ?? DUMMY_HASH);
  if (u && isLocked(u)) redirect('/admin/login?fel=last');
  if (!u || !u.password_hash || !ok || u.disabled) {
    if (u && !u.disabled) await failed(u);
    redirect('/admin/login?fel=1');
  }
  await sql`update admin_user set failed_logins = 0, locked_until = null where id = ${u.id}`;
  await setSession(u.id, u.totp_enabled ? 'mfa' : 'setup', u.session_version);
  redirect(u.totp_enabled ? '/admin/login/kod' : '/admin/tvasteg');
}

// Steg 2: engångskod från appen eller en reservkod.
export async function verifyCode(fd: FormData) {
  const u = await pendingUser('mfa');
  if (!u || !u.totp_secret) redirect('/admin/login');
  if (isLocked(u)) redirect('/admin/login?fel=last');
  const code = s(fd, 'code');
  let ok = false;
  let usedRecovery = false;
  if (/^\d{3}\s?\d{3}$/.test(code)) {
    ok = verifyTotp(decryptSecret(u.totp_secret), code);
  } else if (normalizeRecovery(code).length === 8) {
    const h = sha256(normalizeRecovery(code));
    if (u.recovery_codes.includes(h)) {
      ok = true;
      usedRecovery = true;
      await sql`update admin_user set recovery_codes = array_remove(recovery_codes, ${h}) where id = ${u.id}`;
    }
  }
  if (!ok) {
    await failed(u);
    redirect('/admin/login/kod?fel=1');
  }
  await sql`update admin_user set failed_logins = 0, last_login_at = now() where id = ${u.id}`;
  await setSession(u.id, 'full', u.session_version);
  await audit({ ...u, role: u.role as never }, u.customer_id, usedRecovery ? 'inloggning_reservkod' : 'inloggning');
  redirect(usedRecovery ? '/admin/konto?reservkod=1' : home(u));
}

export async function logout() {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  redirect('/admin/login');
}

/* ---------- Tvåstegsverifiering: aktivera ---------- */

export type SetupState = { error?: string; codes?: string[] };

export async function confirmTotp(_: SetupState, fd: FormData): Promise<SetupState> {
  const u = await pendingUser('setup');
  if (!u || !u.totp_secret) return { error: 'Sessionen har gått ut. Logga in igen.' };
  if (!verifyTotp(decryptSecret(u.totp_secret), s(fd, 'code'))) {
    return { error: 'Koden stämmer inte. Kontrollera att klockan i telefonen är rätt och prova nästa kod.' };
  }
  const codes = newRecoveryCodes();
  await sql`update admin_user set totp_enabled = true, recovery_codes = ${codes.map((c) => sha256(normalizeRecovery(c)))},
    last_login_at = now(), failed_logins = 0 where id = ${u.id}`;
  await setSession(u.id, 'full', u.session_version);
  await audit({ ...u, role: u.role as never }, u.customer_id, 'tvasteg_aktiverad');
  return { codes };
}

/* ---------- Mitt konto ---------- */

export async function newRecoveryCodesAction(_: SetupState, fd: FormData): Promise<SetupState> {
  const user = await sessionUser();
  if (!user) return { error: 'Logga in igen.' };
  const [u] = await sql<DbUser[]>`select * from admin_user where id = ${user.id}`;
  if (!u.totp_secret || !verifyTotp(decryptSecret(u.totp_secret), s(fd, 'code'))) return { error: 'Koden stämmer inte.' };
  const codes = newRecoveryCodes();
  await sql`update admin_user set recovery_codes = ${codes.map((c) => sha256(normalizeRecovery(c)))} where id = ${u.id}`;
  await audit(user, user.customer_id, 'reservkoder_nya');
  return { codes };
}

export type FormState = { error?: string; ok?: string };

export async function changePassword(_: FormState, fd: FormData): Promise<FormState> {
  const user = await sessionUser();
  if (!user) return { error: 'Logga in igen.' };
  const [u] = await sql<DbUser[]>`select * from admin_user where id = ${user.id}`;
  if (!(await bcrypt.compare(String(fd.get('current') ?? ''), u.password_hash ?? DUMMY_HASH))) return { error: 'Nuvarande lösenord stämmer inte.' };
  const pw = String(fd.get('password') ?? '');
  if (pw.length < MIN_PASSWORD) return { error: `Lösenordet måste ha minst ${MIN_PASSWORD} tecken.` };
  if (pw !== String(fd.get('password2') ?? '')) return { error: 'Lösenorden är inte lika.' };
  // Nytt lösenord loggar ut alla andra sessioner (session_version ökas); den här sessionen förnyas.
  const [r] = await sql<{ session_version: number }[]>`
    update admin_user set password_hash = ${await bcrypt.hash(pw, 12)}, session_version = session_version + 1
    where id = ${u.id} returning session_version`;
  await setSession(u.id, 'full', r.session_version);
  await audit(user, user.customer_id, 'losenord_bytt');
  return { ok: 'Lösenordet är bytt. Du är utloggad på andra enheter.' };
}

export async function logoutEverywhere() {
  const user = await sessionUser();
  if (!user) redirect('/admin/login');
  await sql`update admin_user set session_version = session_version + 1 where id = ${user.id}`;
  await audit(user, user.customer_id, 'utloggad_overallt');
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  redirect('/admin/login');
}

/* ---------- Inbjudan och nytt lösenord (engångslänkar) ---------- */

export async function acceptInvite(_: FormState, fd: FormData): Promise<FormState> {
  const token = s(fd, 'token');
  const t = await lookupUserToken(token, 'invite');
  if (!t) return { error: 'Inbjudan är inte giltig längre. Be om en ny.' };
  const name = s(fd, 'name').slice(0, 120);
  const pw = String(fd.get('password') ?? '');
  if (!name) return { error: 'Skriv ditt namn.' };
  if (pw.length < MIN_PASSWORD) return { error: `Lösenordet måste ha minst ${MIN_PASSWORD} tecken.` };
  if (pw !== String(fd.get('password2') ?? '')) return { error: 'Lösenorden är inte lika.' };
  const [u] = await sql<{ id: string; session_version: number; customer_id: string | null; email: string; role: string }[]>`
    update admin_user set name = ${name}, password_hash = ${await bcrypt.hash(pw, 12)}, session_version = session_version + 1
    where id = ${t.user_id} returning id, session_version, customer_id, email, role`;
  await sql`update user_token set used_at = now() where id = ${t.id}`;
  await audit({ id: u.id, email: u.email } as never, u.customer_id, 'inbjudan_accepterad');
  await setSession(u.id, 'setup', u.session_version);
  redirect('/admin/tvasteg');
}

// Glömt lösenord: samma svar oavsett om adressen finns, så att ingen kan pröva fram konton.
export async function requestReset(fd: FormData) {
  const email = s(fd, 'email').toLowerCase();
  const [u] = await sql<{ id: string; email: string; customer_id: string | null }[]>`
    select id, email, customer_id from admin_user
    where lower(email) = ${email} and not disabled and password_hash is not null`;
  if (u) {
    // Högst tre länkar per timme och konto.
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from user_token where user_id = ${u.id} and kind = 'reset' and created_at > now() - interval '1 hour'`;
    if (n < 3) {
      const token = await createUserToken(u.id, 'reset');
      try { await sendMail(mailTemplate({
        to: u.email,
        subject: 'Nytt lösenord till Briondo',
        heading: 'Välj ett nytt lösenord',
        paragraphs: ['Någon (förhoppningsvis du) har bett om ett nytt lösenord till ditt Briondo-konto. Länken gäller i en timme och kan bara användas en gång.'],
        button: { label: 'Välj nytt lösenord', url: appUrl(`/admin/losenord/${token}`) },
        footer: 'Har du inte bett om detta kan du strunta i mejlet – ditt lösenord ändras inte.',
      })); } catch (e) { console.error('losenord', e); }
      await audit(null, u.customer_id, 'losenord_lank_skickad', { email: u.email });
    }
  }
  redirect('/admin/losenord?skickat=1');
}

export async function resetPassword(_: FormState, fd: FormData): Promise<FormState> {
  const t = await lookupUserToken(s(fd, 'token'), 'reset');
  if (!t) return { error: 'Länken är inte giltig längre. Be om en ny.' };
  const pw = String(fd.get('password') ?? '');
  if (pw.length < MIN_PASSWORD) return { error: `Lösenordet måste ha minst ${MIN_PASSWORD} tecken.` };
  if (pw !== String(fd.get('password2') ?? '')) return { error: 'Lösenorden är inte lika.' };
  const [u] = await sql<{ id: string; customer_id: string | null; email: string }[]>`
    update admin_user set password_hash = ${await bcrypt.hash(pw, 12)}, session_version = session_version + 1,
      failed_logins = 0, locked_until = null
    where id = ${t.user_id} returning id, customer_id, email`;
  await sql`update user_token set used_at = now() where id = ${t.id}`;
  await audit({ id: u.id, email: u.email } as never, u.customer_id, 'losenord_aterstallt');
  // Tvåstegsverifieringen gäller fortfarande – logga in som vanligt.
  redirect('/admin/login?nytt=1');
}
