'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import ExcelJS from 'exceljs';
import { sql } from '@/lib/db';
import { audit, authorize } from '@/lib/access';
import { EMAIL_RE, getPerson, newAccessKey, sendLoginLink } from '@/lib/person';

const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const list = (c: string, q = '') => `/admin/kunder/${c}/personer${q}`;
const page = (c: string, p: string, q = '') => `/admin/kunder/${c}/personer/${p}${q}`;

type Fields = { name: string; email: string | null; employee_no: string | null; group_name: string };

function fields(fd: FormData): Fields | 'namn' | 'epost' {
  const name = s(fd, 'name').slice(0, 120);
  const email = s(fd, 'email').toLowerCase().slice(0, 200) || null;
  const employee_no = s(fd, 'employee_no').slice(0, 60) || null;
  if (!name) return 'namn';
  if (email && !EMAIL_RE.test(email)) return 'epost';
  return { name, email, employee_no, group_name: s(fd, 'group_name').slice(0, 80) };
}

// Unikt per kund: e-post och anställningsnummer.
async function conflict(customerId: string, f: Fields, exceptId: string | null) {
  const [c] = await sql<{ email: string | null; employee_no: string | null }[]>`
    select email, employee_no from person
    where customer_id = ${customerId} and id is distinct from ${exceptId}
      and ((${f.email}::text is not null and email = ${f.email}) or (${f.employee_no}::text is not null and employee_no = ${f.employee_no}))
    limit 1`;
  if (!c) return null;
  return c.email && c.email === f.email ? 'epost_finns' : 'nr_finns';
}

export async function createPerson(fd: FormData) {
  const customerId = s(fd, 'customer_id');
  const { user } = await authorize('customer', customerId, 'edit');
  const f = fields(fd);
  if (typeof f === 'string') redirect(list(customerId, `?fel=${f}`));
  const c = await conflict(customerId, f, null);
  if (c) redirect(list(customerId, `?fel=${c}`));
  const [p] = await sql<{ id: string }[]>`
    insert into person (customer_id, name, email, employee_no, group_name)
    values (${customerId}, ${f.name}, ${f.email}, ${f.employee_no}, ${f.group_name}) returning id`;
  await audit(user, customerId, 'person_skapad', { name: f.name });
  revalidatePath('/admin', 'layout');
  redirect(list(customerId, `?tillagd=${encodeURIComponent(f.name)}`));
}

export async function updatePerson(fd: FormData) {
  const id = s(fd, 'person_id');
  const { user, customerId } = await authorize('person', id, 'edit');
  const f = fields(fd);
  if (typeof f === 'string') redirect(page(customerId, id, `?fel=${f}`));
  const c = await conflict(customerId, f, id);
  if (c) redirect(page(customerId, id, `?fel=${c}`));
  await sql`update person set name = ${f.name}, email = ${f.email}, employee_no = ${f.employee_no},
    group_name = ${f.group_name}, updated_at = now() where id = ${id}`;
  await sql`update learner set name = ${f.name}, email = ${f.email} where person_id = ${id}`;
  await audit(user, customerId, 'person_andrad', { name: f.name });
  revalidatePath('/admin', 'layout');
  redirect(page(customerId, id, '?sparad=1'));
}

// Arkiverad: kan inte logga in och visas inte i listan, men historiken finns kvar.
export async function archivePerson(fd: FormData) {
  const id = s(fd, 'person_id');
  const { user, customerId } = await authorize('person', id, 'edit');
  const archive = s(fd, 'archive') === '1';
  const [p] = await sql<{ name: string }[]>`
    update person set archived_at = ${archive ? sql`now()` : null}, session_version = session_version + 1, updated_at = now()
    where id = ${id} returning name`;
  await audit(user, customerId, archive ? 'person_arkiverad' : 'person_aterstalld', { name: p.name });
  revalidatePath('/admin', 'layout');
  redirect(page(customerId, id));
}

// Radering (t.ex. begäran enligt GDPR): personen, elevposter, svar och framsteg tas bort.
// Utfärdade certifikat behåller ID och datum men namnet tas bort, så att de fortfarande kan verifieras.
export async function deletePerson(fd: FormData) {
  const id = s(fd, 'person_id');
  const { user, customerId } = await authorize('person', id, 'admin');
  if (s(fd, 'confirm') !== 'RADERA') redirect(page(customerId, id, '?fel=bekrafta'));
  await sql.begin(async (tx) => {
    await tx`update certificate set learner_name = null
      where enrollment_id in (select e.id from enrollment e join learner l on l.id = e.learner_id where l.person_id = ${id})`;
    await tx`delete from learner where person_id = ${id}`;
    await tx`delete from person where id = ${id}`;
  });
  await audit(user, customerId, 'person_raderad', {});
  revalidatePath('/admin', 'layout');
  redirect(list(customerId, '?raderad=1'));
}

export async function setPersonLink(fd: FormData) {
  const id = s(fd, 'person_id');
  const { user, customerId } = await authorize('person', id, 'edit');
  const off = s(fd, 'op') === 'off';
  // Ny eller avstängd länk loggar också ut personen överallt.
  const [p] = await sql<{ name: string }[]>`
    update person set access_key = ${off ? null : newAccessKey()}, session_version = session_version + 1 where id = ${id} returning name`;
  await audit(user, customerId, off ? 'person_lank_av' : 'person_lank_ny', { name: p.name });
  redirect(page(customerId, id));
}

export async function sendPersonLogin(fd: FormData) {
  const id = s(fd, 'person_id');
  const { user, customerId } = await authorize('person', id, 'edit');
  const p = await getPerson(id);
  const ok = p ? await sendLoginLink(p, '/mina') : false;
  if (ok) await audit(user, customerId, 'person_inloggningslank', { name: p!.name });
  redirect(page(customerId, id, ok ? '?skickad=1' : '?fel=skicka'));
}

/* ---------- Import från Excel eller CSV ---------- */

export type ImportResult = {
  created: number;
  updated: number;
  unchanged: number;
  errors: { row: number; message: string }[];
  error?: string;
};

const HEADERS: Record<keyof Fields, RegExp> = {
  name: /^(namn|name|fullst(ä|a)ndigt namn|för- och efternamn)$/i,
  email: /^(e-?post(adress)?|e-?mail|mail|epost)$/i,
  employee_no: /^(anst(ä|a)llningsn(ummer|r)|anst\.? ?nr|personaln(ummer|r)|employee( ?(no|number|id))?|id)$/i,
  group_name: /^(grupp|avdelning|enhet|group|department|team|roll)$/i,
};

function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function readRows(file: File): Promise<string[][]> {
  const buf = Buffer.from(await file.arrayBuffer());
  if (/\.xlsx$/i.test(file.name)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const ws = wb.worksheets[0];
    const rows: string[][] = [];
    ws?.eachRow({ includeEmpty: false }, (r) => {
      const vals = (r.values as unknown[]).slice(1);
      rows.push(vals.map((v) => {
        if (v == null) return '';
        if (typeof v === 'object' && v !== null) {
          const o = v as { text?: string; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
          if (o.richText) return o.richText.map((x) => x.text).join('');
          if (o.text) return String(o.text);
          if (o.result != null) return String(o.result);
          return '';
        }
        return String(v);
      }));
    });
    return rows;
  }
  // CSV: UTF-8, annars Windows-1252 (Excel på svenska sparar ofta så).
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
  return parseCsv(text.replace(/^﻿/, ''));
}

export async function importPersons(_: ImportResult | null, fd: FormData): Promise<ImportResult> {
  const customerId = s(fd, 'customer_id');
  const { user } = await authorize('customer', customerId, 'edit');
  const empty: ImportResult = { created: 0, updated: 0, unchanged: 0, errors: [] };
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return { ...empty, error: 'Välj en fil.' };
  if (file.size > 5 * 1024 * 1024) return { ...empty, error: 'Filen får vara högst 5 MB.' };
  if (!/\.(xlsx|csv|txt)$/i.test(file.name)) return { ...empty, error: 'Använd Excel (.xlsx) eller CSV.' };
  let rows: string[][];
  try {
    rows = (await readRows(file)).filter((r) => r.some((c) => c.trim()));
  } catch {
    return { ...empty, error: 'Filen kunde inte läsas. Spara den som .xlsx eller CSV och försök igen.' };
  }
  if (rows.length < 2) return { ...empty, error: 'Filen saknar rader. Första raden ska vara rubriker (Namn, E-post, Anställningsnummer, Grupp).' };
  if (rows.length > 5001) return { ...empty, error: 'Högst 5 000 personer per import.' };

  const head = rows[0].map((h) => h.trim());
  const col = Object.fromEntries(
    (Object.keys(HEADERS) as (keyof Fields)[]).map((k) => [k, head.findIndex((h) => HEADERS[k].test(h))]),
  ) as Record<keyof Fields, number>;
  if (col.name < 0) return { ...empty, error: `Hittar ingen kolumn för namn. Rubrikerna i filen är: ${head.join(', ')}.` };
  if (col.email < 0 && col.employee_no < 0) return { ...empty, error: 'Filen behöver en kolumn för e-post eller anställningsnummer, så att personer kan kännas igen vid nästa import.' };

  const result = { ...empty };
  const seen = new Set<string>();
  const existing = await sql<{ id: string; name: string; email: string | null; employee_no: string | null; group_name: string }[]>`
    select id, name, email, employee_no, group_name from person where customer_id = ${customerId}`;
  const byNo = new Map(existing.filter((p) => p.employee_no).map((p) => [p.employee_no!, p]));
  const byEmail = new Map(existing.filter((p) => p.email).map((p) => [p.email!, p]));

  await sql.begin(async (tx) => {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const get = (k: keyof Fields) => (col[k] >= 0 ? (r[col[k]] ?? '').trim() : '');
      const f: Fields = {
        name: get('name').slice(0, 120),
        email: get('email').toLowerCase().slice(0, 200) || null,
        employee_no: get('employee_no').slice(0, 60) || null,
        group_name: get('group_name').slice(0, 80),
      };
      const rowNo = i + 1;
      if (!f.name) { result.errors.push({ row: rowNo, message: 'Namn saknas' }); continue; }
      if (f.email && !EMAIL_RE.test(f.email)) { result.errors.push({ row: rowNo, message: `Ogiltig e-post: ${f.email}` }); continue; }
      if (!f.email && !f.employee_no) { result.errors.push({ row: rowNo, message: 'Varken e-post eller anställningsnummer' }); continue; }
      const key = f.employee_no ? `n:${f.employee_no}` : `e:${f.email}`;
      if (seen.has(key) || (f.email && seen.has(`e:${f.email}`))) { result.errors.push({ row: rowNo, message: 'Finns två gånger i filen' }); continue; }
      seen.add(key); if (f.email) seen.add(`e:${f.email}`);

      // Kännas igen på anställningsnummer i första hand, annars e-post.
      const match = (f.employee_no && byNo.get(f.employee_no)) || (f.email && byEmail.get(f.email)) || null;
      if (match) {
        const other = f.email ? byEmail.get(f.email) : undefined;
        if (other && other.id !== match.id) { result.errors.push({ row: rowNo, message: `E-posten används redan av ${other.name}` }); continue; }
        const same = match.name === f.name && match.email === f.email && match.employee_no === (f.employee_no ?? match.employee_no)
          && (col.group_name < 0 || match.group_name === f.group_name);
        if (same) { result.unchanged++; continue; }
        await tx`update person set name = ${f.name}, email = ${f.email},
          employee_no = ${f.employee_no ?? match.employee_no},
          group_name = ${col.group_name >= 0 ? f.group_name : match.group_name}, updated_at = now()
          where id = ${match.id}`;
        await tx`update learner set name = ${f.name}, email = ${f.email} where person_id = ${match.id}`;
        result.updated++;
      } else {
        if (f.email && byEmail.has(f.email)) { result.errors.push({ row: rowNo, message: 'E-posten används redan' }); continue; }
        const [p] = await tx<{ id: string }[]>`
          insert into person (customer_id, name, email, employee_no, group_name)
          values (${customerId}, ${f.name}, ${f.email}, ${f.employee_no}, ${f.group_name}) returning id`;
        const rec = { id: p.id, ...f };
        if (f.employee_no) byNo.set(f.employee_no, rec);
        if (f.email) byEmail.set(f.email, rec);
        result.created++;
      }
    }
  });
  await audit(user, customerId, 'personer_importerade', { created: result.created, updated: result.updated, file: file.name });
  revalidatePath('/admin', 'layout');
  return result;
}
