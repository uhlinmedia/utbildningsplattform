import 'server-only';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { sql } from './db';
import { PERSON_COOKIE, signPersonSession, verifyPersonSession } from './session';
import { sha256 } from './totp';
import { appUrl, mailTemplate, sendMail } from './mail';

// Personregistret: en person per anställd hos kunden. Eleven loggar in med en engångslänk via e-post
// eller med sin personliga länk, och alla utbildningar hamnar på samma person.

export type Person = {
  id: string;
  customer_id: string;
  name: string;
  email: string | null;
  employee_no: string | null;
  group_name: string;
  access_key: string | null;
  session_version: number;
  archived_at: Date | null;
  created_at: Date;
};

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGIN_MINUTES = 30;

export async function getPerson(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [p] = await sql<Person[]>`select * from person where id = ${id}`;
  return p ?? null;
}

// Inloggad person (kakan), om kontot fortfarande är aktivt.
export async function sessionPerson(): Promise<Person | null> {
  const store = await cookies();
  const c = await verifyPersonSession(store.get(PERSON_COOKIE)?.value);
  if (!c) return null;
  const p = await getPerson(c.sub);
  if (!p || p.archived_at || p.session_version !== c.ver) return null;
  return p;
}

export async function setPersonCookie(p: Pick<Person, 'id' | 'session_version'>) {
  const store = await cookies();
  store.set(PERSON_COOKIE, await signPersonSession(p.id, p.session_version), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearPersonCookie() {
  (await cookies()).delete(PERSON_COOKIE);
}

export const newAccessKey = () => randomBytes(18).toString('base64url');

// Bara relativa sökvägar inom appen får användas som mål efter inloggning.
export const safeNext = (p: string | null | undefined) => (p && /^\/(k|mina)(\/|$|\?)/.test(p) ? p.slice(0, 300) : '/mina');

// Skickar en inloggningslänk (30 minuter, en gång). Högst fem per timme och person.
export async function sendLoginLink(p: Person, next: string) {
  if (!p.email || p.archived_at) return false;
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from person_token where person_id = ${p.id} and created_at > now() - interval '1 hour'`;
  if (n >= 5) return false;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into person_token (person_id, token_hash, next_path, expires_at)
    values (${p.id}, ${sha256(token)}, ${safeNext(next)}, now() + ${`${LOGIN_MINUTES} minutes`}::interval)`;
  const [c] = await sql<{ name: string; color: string }[]>`select name, color from customer where id = ${p.customer_id}`;
  try { await sendMail(mailTemplate({
    to: p.email,
    subject: `Logga in – utbildningar hos ${c.name}`,
    heading: `Hej ${p.name.split(' ')[0]}!`,
    paragraphs: [
      `Här är din inloggningslänk till utbildningarna hos ${c.name}. Länken gäller i ${LOGIN_MINUTES} minuter och kan bara användas en gång.`,
    ],
    button: { label: 'Logga in', url: appUrl(`/in/${token}`) },
    footer: `Du får mejlet för att du finns i ${c.name}s register för utbildningar i Briondo. Har du inte bett om länken kan du strunta i mejlet.`,
    brand: c.color,
  })); } catch (e) {
    console.error('inloggningslänk', e);
    return false;
  }
  return true;
}

// Löser in en inloggningslänk. Returnerar personen och målsidan, eller null.
export async function redeemLoginToken(token: string) {
  const [t] = await sql<{ id: string; person_id: string; next_path: string }[]>`
    update person_token set used_at = now()
    where token_hash = ${sha256(token)} and used_at is null and expires_at > now()
    returning id, person_id, next_path`;
  if (!t) return null;
  const p = await getPerson(t.person_id);
  if (!p || p.archived_at) return null;
  return { person: p, next: safeNext(t.next_path) };
}

// Elevpost för personen hos kunden – skapas första gången, namnet hålls i synk med registret.
export async function learnerForPerson(p: Person) {
  const [l] = await sql<{ id: string }[]>`
    insert into learner (customer_id, name, email, person_id)
    values (${p.customer_id}, ${p.name}, ${p.email}, ${p.id})
    on conflict (person_id) where person_id is not null
    do update set name = excluded.name, email = excluded.email
    returning id`;
  return l.id;
}
