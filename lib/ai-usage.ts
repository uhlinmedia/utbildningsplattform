import 'server-only';
import { sql } from './db';
import { can, type User } from './access';

// AI-uppläsning per kund: superadmin aktiverar funktionen och kan sätta en månadskvot (minuter tal).
// Superadmin kan alltid skapa röster (även utan aktivering och över kvoten); förbrukningen räknas ändå på kunden.

export const CHARS_PER_MINUTE = 900; // ungefärlig taltakt för uppskattningar innan rösten finns

// Kalendermånad i svensk tid.
const MONTH_START = sql`date_trunc('month', now() at time zone 'Europe/Stockholm') at time zone 'Europe/Stockholm'`;

export type AiAccess = {
  enabled: boolean;                 // kunden har AI-uppläsning påslagen
  quotaMinutes: number | null;      // null = obegränsat
  usedSeconds: number;              // denna månad
  remainingSeconds: number | null;  // null = obegränsat
  canGenerate: boolean;             // den här användaren får skapa röster här
  reason: string | null;            // varför inte, om canGenerate är falskt
};

export async function aiAccess(user: User, customerId: string): Promise<AiAccess> {
  const [c] = await sql<{ ai_voice: boolean; ai_minutes_month: number | null }[]>`
    select ai_voice, ai_minutes_month from customer where id = ${customerId}`;
  const [u] = await sql<{ s: number }[]>`
    select coalesce(sum(seconds), 0)::int as s from ai_usage where customer_id = ${customerId} and created_at >= ${MONTH_START}`;
  const enabled = !!c?.ai_voice;
  const quotaMinutes = c?.ai_minutes_month ?? null;
  const usedSeconds = u?.s ?? 0;
  const remainingSeconds = quotaMinutes === null ? null : Math.max(0, quotaMinutes * 60 - usedSeconds);
  let reason: string | null = null;
  if (user.role !== 'superadmin') {
    if (!can(user, customerId, 'edit')) reason = 'Du har inte behörighet att ändra utbildningar.';
    else if (!enabled) reason = 'AI-uppläsning är inte aktiverad för er. Kontakta Briondo.';
    else if (remainingSeconds !== null && remainingSeconds <= 0) reason = 'Månadens kvot för AI-uppläsning är förbrukad. Kontakta Briondo för mer.';
  }
  return { enabled, quotaMinutes, usedSeconds, remainingSeconds, canGenerate: reason === null, reason };
}

// Får en text på så här många tecken skapas inom kvoten? (Uppskattning; den faktiska längden räknas efteråt.)
export function fitsQuota(access: AiAccess, chars: number, isSuper: boolean) {
  if (isSuper || access.remainingSeconds === null) return true;
  return Math.ceil((chars / CHARS_PER_MINUTE) * 60) <= access.remainingSeconds;
}

export async function recordUsage(u: {
  customerId: string; sectionId: string; user: User; chars: number; seconds: number; voice: string; model: string;
}) {
  const [t] = await sql<{ course: string; section: string }[]>`
    select co.title as course, s.title as section from section s
    join chapter ch on ch.id = s.chapter_id join course co on co.id = ch.course_id where s.id = ${u.sectionId}`;
  await sql`insert into ai_usage (customer_id, section_id, course_title, section_title, user_id, user_email, chars, seconds, voice, model)
    values (${u.customerId}, ${u.sectionId}, ${t?.course ?? ''}, ${t?.section ?? ''}, ${u.user.id}, ${u.user.email},
      ${u.chars}, ${u.seconds}, ${u.voice}, ${u.model})`;
}

export type UsageRow = { month: string; customer_id: string; customer: string; voices: number; chars: number; seconds: number };

// Förbrukning per kund och månad (senaste 12 månaderna). Utan customerId: alla kunder (superadmin).
export async function usageByMonth(customerId?: string): Promise<UsageRow[]> {
  return sql<UsageRow[]>`
    select to_char(date_trunc('month', u.created_at at time zone 'Europe/Stockholm'), 'YYYY-MM') as month,
           c.id as customer_id, c.name as customer,
           count(*)::int as voices, sum(u.chars)::int as chars, sum(u.seconds)::int as seconds
    from ai_usage u join customer c on c.id = u.customer_id
    where u.created_at >= (date_trunc('month', now() at time zone 'Europe/Stockholm') - interval '11 months') at time zone 'Europe/Stockholm'
      ${customerId ? sql`and u.customer_id = ${customerId}` : sql``}
    group by 1, 2, 3
    order by 1 desc, 3`;
}

export type UsageDetail = {
  created_at: Date; customer: string; course_title: string; section_title: string; user_email: string | null;
  voice: string; chars: number; seconds: number;
};

// Enskilda AI-röster under en månad (YYYY-MM), för Excel-exporten.
export async function usageDetails(month: string, customerId?: string): Promise<UsageDetail[]> {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  return sql<UsageDetail[]>`
    select u.created_at, c.name as customer, u.course_title, u.section_title, u.user_email, u.voice, u.chars, u.seconds
    from ai_usage u join customer c on c.id = u.customer_id
    where to_char(date_trunc('month', u.created_at at time zone 'Europe/Stockholm'), 'YYYY-MM') = ${month}
      ${customerId ? sql`and u.customer_id = ${customerId}` : sql``}
    order by c.name, u.created_at`;
}

// Ungefärlig kostnad hos Google i kronor (Gemini 3.8 Flash TTS: 25 ljudtokens/s; 9 USD/milj. 2026, 18 USD från 2027).
export function estimatedCostSek(seconds: number, month: string) {
  const usdPerMillion = month >= '2027-01' ? 18 : 9;
  return (seconds * 25 * usdPerMillion) / 1e6 * 10.5;
}

export const fmtMinutes = (seconds: number) => (seconds / 60).toLocaleString('sv-SE', { maximumFractionDigits: 1 });
