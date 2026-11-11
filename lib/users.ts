import 'server-only';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import QRCode from 'qrcode';
import { sql } from './db';
import { ADMIN_COOKIE, verifyUserSession, type Stage } from './session';
import { decryptSecret, encryptSecret, newTotpSecret, otpauthUrl, sha256 } from './totp';

// Hjälpfunktioner för konton. Ligger utanför 'use server'-filer så att de inte kan anropas från webbläsaren.

export type DbUser = {
  id: string; email: string; name: string; role: string; customer_id: string | null; password_hash: string | null;
  totp_secret: string | null; totp_enabled: boolean; recovery_codes: string[]; session_version: number;
  failed_logins: number; locked_until: Date | null; disabled: boolean;
};

export async function pendingUser(stage: Stage) {
  const store = await cookies();
  const c = await verifyUserSession(store.get(ADMIN_COOKIE)?.value);
  if (!c || c.stage !== stage) return null;
  const [u] = await sql<DbUser[]>`select * from admin_user where id = ${c.sub}`;
  if (!u || u.disabled || u.session_version !== c.ver) return null;
  return u;
}

export async function createUserToken(userId: string, kind: 'invite' | 'reset') {
  const token = randomBytes(32).toString('base64url');
  const hours = kind === 'invite' ? 24 * 7 : 1;
  await sql`update user_token set used_at = now() where user_id = ${userId} and kind = ${kind} and used_at is null`;
  await sql`insert into user_token (user_id, kind, token_hash, expires_at)
    values (${userId}, ${kind}, ${sha256(token)}, now() + ${`${hours} hours`}::interval)`;
  return token;
}

export async function lookupUserToken(token: string, kind: 'invite' | 'reset') {
  const [t] = await sql<{ id: string; user_id: string; email: string; name: string; customer: string | null }[]>`
    select t.id, t.user_id, u.email, u.name, c.name as customer
    from user_token t join admin_user u on u.id = t.user_id left join customer c on c.id = u.customer_id
    where t.token_hash = ${sha256(token)} and t.kind = ${kind} and t.used_at is null and t.expires_at > now() and not u.disabled`;
  return t ?? null;
}

export async function totpSetupInfo() {
  const u = await pendingUser('setup');
  if (!u) return null;
  let secret: string;
  if (u.totp_secret && !u.totp_enabled) {
    secret = decryptSecret(u.totp_secret);
  } else {
    secret = newTotpSecret();
    await sql`update admin_user set totp_secret = ${encryptSecret(secret)} where id = ${u.id}`;
  }
  const url = otpauthUrl(secret, u.email);
  return { email: u.email, secret, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
}

