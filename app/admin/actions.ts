'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { sql } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { ADMIN_COOKIE } from '@/lib/session';
import { slugify } from '@/lib/course';
import { parseVimeo } from '@/lib/vimeo';
import type { QuizOption } from '@/lib/types';

const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const done = () => revalidatePath('/admin', 'layout');

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
// Loggor, märken och underskrifter får också vara SVG (vanligt för t.ex. ISO-märken). SVG visas bara via <img>
// och serveras med en CSP som stoppar skript.
const GRAPHIC_TYPES = [...IMAGE_TYPES, 'image/svg+xml'];

async function saveImage(file: FormDataEntryValue | null, allowSvg = false): Promise<string | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  if (!(allowSvg ? GRAPHIC_TYPES : IMAGE_TYPES).includes(file.type)) {
    throw new Error(allowSvg ? 'Bara PNG, JPG, WebP, GIF eller SVG är tillåtet.' : 'Bara PNG, JPG, WebP eller GIF är tillåtet.');
  }
  if (file.size > 5 * 1024 * 1024) throw new Error('Bilden får vara högst 5 MB.');
  const data = Buffer.from(await file.arrayBuffer());
  const [m] = await sql<{ id: string }[]>`
    insert into media (filename, mime, data) values (${file.name}, ${file.type}, ${data}) returning id`;
  return m.id;
}

export async function logout() {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  redirect('/admin/login');
}

/* ---------- Kunder ---------- */

export async function createCustomer(fd: FormData) {
  await requireAdmin();
  const name = s(fd, 'name');
  if (!name) return;
  const [c] = await sql<{ id: string }[]>`insert into customer (name) values (${name}) returning id`;
  done();
  redirect(`/admin/kunder/${c.id}`);
}

export async function updateCustomer(fd: FormData) {
  await requireAdmin();
  const id = s(fd, 'id');
  const retention = [12, 24, 36].includes(Number(fd.get('retention_months'))) ? Number(fd.get('retention_months')) : 24;
  const color = /^#[0-9a-fA-F]{6}$/.test(s(fd, 'color')) ? s(fd, 'color') : '#0E6B66';
  const logo = await saveImage(fd.get('logo'), true);
  await sql`update customer set
      name = ${s(fd, 'name')}, color = ${color},
      contact_name = ${s(fd, 'contact_name') || null}, contact_email = ${s(fd, 'contact_email') || null},
      retention_months = ${retention}
      ${logo ? sql`, logo_media_id = ${logo}` : sql``}
    where id = ${id}`;
  done();
}

const hexColor = (v: string, fallback: string) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback);

export async function updateCustomerCert(fd: FormData) {
  await requireAdmin();
  const template = ['klassisk', 'modern', 'minimal'].includes(s(fd, 'cert_template')) ? s(fd, 'cert_template') : 'klassisk';
  const size = ['S', 'M', 'L'].includes(s(fd, 'cert_logo_size')) ? s(fd, 'cert_logo_size') : 'M';
  await sql`update customer set
      cert_template = ${template}, cert_accent = ${hexColor(s(fd, 'cert_accent'), '#B08D57')}, cert_logo_size = ${size},
      cert_seal = ${fd.get('cert_seal') === 'on'}, cert_show_briondo = ${fd.get('cert_show_briondo') === 'on'}
    where id = ${s(fd, 'id')}`;
  done();
}

export async function addCertBadge(fd: FormData) {
  await requireAdmin();
  const customerId = s(fd, 'customer_id');
  const media = await saveImage(fd.get('badge'), true);
  if (!media) return;
  await sql`insert into cert_badge (customer_id, media_id, label, position)
    values (${customerId}, ${media}, ${s(fd, 'label').slice(0, 80)},
      (select coalesce(max(position), 0) + 1 from cert_badge where customer_id = ${customerId}))`;
  done();
}

export async function updateCertBadge(fd: FormData) {
  await requireAdmin();
  const id = s(fd, 'id');
  const op = s(fd, 'op');
  if (op === 'delete') {
    await sql`delete from media where id = (select media_id from cert_badge where id = ${id})`; // märket följer med (cascade)
  } else if (op === 'up' || op === 'down') {
    await sql.begin(async (tx) => {
      const [b] = await tx<{ customer_id: string; position: number }[]>`select customer_id, position from cert_badge where id = ${id}`;
      if (!b) return;
      const [other] = op === 'up'
        ? await tx<{ id: string; position: number }[]>`select id, position from cert_badge where customer_id = ${b.customer_id} and position < ${b.position} order by position desc limit 1`
        : await tx<{ id: string; position: number }[]>`select id, position from cert_badge where customer_id = ${b.customer_id} and position > ${b.position} order by position limit 1`;
      if (!other) return;
      await tx`update cert_badge set position = ${other.position} where id = ${id}`;
      await tx`update cert_badge set position = ${b.position} where id = ${other.id}`;
    });
  } else if (op === 'save') {
    await sql`update cert_badge set label = ${s(fd, 'label').slice(0, 80)} where id = ${id}`;
  }
  done();
}

/* ---------- Utbildningar ---------- */

export async function createCourse(fd: FormData) {
  await requireAdmin();
  const customerId = s(fd, 'customer_id');
  const title = s(fd, 'title') || 'Ny utbildning';
  const id = await sql.begin(async (tx) => {
    const [c] = await tx<{ id: string }[]>`
      insert into course (customer_id, title, slug) values (${customerId}, ${title}, ${slugify(title)}) returning id`;
    const [ch] = await tx<{ id: string }[]>`
      insert into chapter (course_id, position, title) values (${c.id}, 1, 'Introduktion') returning id`;
    await tx`insert into section (chapter_id, position, title) values (${ch.id}, 1, 'Välkommen')`;
    return c.id;
  });
  done();
  redirect(`/admin/utbildningar/${id}`);
}

export async function updateCourseSettings(fd: FormData) {
  await requireAdmin();
  const id = s(fd, 'id');
  const access = s(fd, 'access_mode') === 'name' ? 'name' : 'name_email';
  const nav = ['free', 'linear', 'sweep'].includes(s(fd, 'nav_mode')) ? s(fd, 'nav_mode') : 'linear';
  const pass = Math.min(100, Math.max(0, Number(fd.get('pass_percent')) || 0));
  const attempts = Math.min(10, Math.max(1, Number(fd.get('max_attempts')) || 3));
  const valid = Number(fd.get('cert_valid_months')) || null;
  const sig1 = fd.get('remove_signature') === 'on' ? null : await saveImage(fd.get('cert_signature'), true);
  const sig2 = fd.get('remove_signature2') === 'on' ? null : await saveImage(fd.get('cert_signature2'), true);
  // Kryssrutorna anger vilka märken som visas; övriga av kundens märken döljs för denna utbildning.
  const shown = new Set(fd.getAll('badge_show').map(String));
  const badges = await sql<{ id: string }[]>`select b.id from cert_badge b join course c on c.customer_id = b.customer_id where c.id = ${id}`;
  const hidden = badges.map((b) => b.id).filter((b) => !shown.has(b));
  await sql`update course set
      title = ${s(fd, 'title')}, description = ${s(fd, 'description')},
      access_mode = ${access}, nav_mode = ${nav}, pass_percent = ${pass}, max_attempts = ${attempts},
      show_answers = ${fd.get('show_answers') === 'on'}, certificate_enabled = ${fd.get('certificate_enabled') === 'on'},
      cert_signer = ${s(fd, 'cert_signer').slice(0, 80)}, cert_valid_months = ${valid},
      cert_signer_title = ${s(fd, 'cert_signer_title').slice(0, 80)},
      cert_signer2 = ${s(fd, 'cert_signer2').slice(0, 80)}, cert_signer2_title = ${s(fd, 'cert_signer2_title').slice(0, 80)},
      cert_title = ${s(fd, 'cert_title').slice(0, 40) || 'Certifikat'},
      cert_intro = ${s(fd, 'cert_intro').slice(0, 80)}, cert_body = ${s(fd, 'cert_body').slice(0, 100)},
      cert_note = ${s(fd, 'cert_note').slice(0, 160)}, cert_hidden_badges = ${hidden}::uuid[],
      ${fd.get('remove_signature') === 'on' ? sql`cert_signature_media_id = null,` : sig1 ? sql`cert_signature_media_id = ${sig1},` : sql``}
      ${fd.get('remove_signature2') === 'on' ? sql`cert_signature2_media_id = null,` : sig2 ? sql`cert_signature2_media_id = ${sig2},` : sql``}
      closes_at = ${s(fd, 'closes_at') || null}
    where id = ${id}`;
  done();
}

export async function setCourseStatus(fd: FormData) {
  await requireAdmin();
  const status = s(fd, 'status') === 'published' ? 'published' : 'draft';
  await sql`update course set status = ${status} where id = ${s(fd, 'id')}`;
  done();
}

export async function deleteCourse(fd: FormData) {
  await requireAdmin();
  if (s(fd, 'confirm') !== 'RADERA') return;
  const [c] = await sql<{ customer_id: string }[]>`delete from course where id = ${s(fd, 'id')} returning customer_id`;
  done();
  redirect(c ? `/admin/kunder/${c.customer_id}` : '/admin');
}

// Kopierar struktur och innehåll – inga elevdata.
export async function duplicateCourse(fd: FormData) {
  await requireAdmin();
  const srcId = s(fd, 'id');
  const targetCustomer = s(fd, 'customer_id');
  const newId = await sql.begin(async (tx) => {
    const [src] = await tx`select * from course where id = ${srcId}`;
    const title = `${src.title} (kopia)`;
    const [c] = await tx<{ id: string }[]>`
      insert into course (customer_id, title, slug, description, access_mode, nav_mode, pass_percent, max_attempts,
        show_answers, certificate_enabled, cert_signer, cert_valid_months, cert_title, cert_intro, cert_body, cert_note,
        cert_signer_title, cert_signature_media_id, cert_signer2, cert_signer2_title, cert_signature2_media_id, cert_hidden_badges)
      values (${targetCustomer || src.customer_id}, ${title}, ${slugify(title)}, ${src.description}, ${src.access_mode},
        ${src.nav_mode}, ${src.pass_percent}, ${src.max_attempts}, ${src.show_answers}, ${src.certificate_enabled},
        ${src.cert_signer}, ${src.cert_valid_months}, ${src.cert_title}, ${src.cert_intro}, ${src.cert_body}, ${src.cert_note},
        ${src.cert_signer_title}, ${src.cert_signature_media_id}, ${src.cert_signer2}, ${src.cert_signer2_title},
        ${src.cert_signature2_media_id}, ${src.cert_hidden_badges})
      returning id`;
    const chapters = await tx`select * from chapter where course_id = ${srcId} order by position`;
    for (const ch of chapters) {
      const [nch] = await tx<{ id: string }[]>`
        insert into chapter (course_id, position, title) values (${c.id}, ${ch.position}, ${ch.title}) returning id`;
      const secs = await tx`select * from section where chapter_id = ${ch.id} order by position`;
      for (const se of secs) {
        const [nse] = await tx<{ id: string }[]>`
          insert into section (chapter_id, position, title) values (${nch.id}, ${se.position}, ${se.title}) returning id`;
        await tx`insert into block (section_id, position, type, content)
          select ${nse.id}, position, type, content from block where section_id = ${se.id}`;
      }
    }
    return c.id;
  });
  done();
  redirect(`/admin/utbildningar/${newId}`);
}

/* ---------- Struktur ---------- */

type Table = 'chapter' | 'section' | 'block';
const parentCol: Record<Table, string> = { chapter: 'course_id', section: 'chapter_id', block: 'section_id' };

// Byter plats med grannen ovanför eller nedanför.
async function move(table: Table, id: string, dir: 'up' | 'down') {
  const parent = parentCol[table];
  await sql.begin(async (tx) => {
    const [row] = await tx`select ${tx(parent)} as parent, position from ${tx(table)} where id = ${id}`;
    if (!row) return;
    const [other] = dir === 'up'
      ? await tx`select id, position from ${tx(table)} where ${tx(parent)} = ${row.parent} and position < ${row.position} order by position desc limit 1`
      : await tx`select id, position from ${tx(table)} where ${tx(parent)} = ${row.parent} and position > ${row.position} order by position asc limit 1`;
    if (!other) return;
    await tx`update ${tx(table)} set position = ${other.position} where id = ${id}`;
    await tx`update ${tx(table)} set position = ${row.position} where id = ${other.id}`;
  });
}

export async function moveItem(fd: FormData) {
  await requireAdmin();
  const table = s(fd, 'table') as Table;
  if (!(table in parentCol)) return;
  await move(table, s(fd, 'id'), s(fd, 'dir') === 'up' ? 'up' : 'down');
  done();
}

export async function addChapter(fd: FormData) {
  await requireAdmin();
  const courseId = s(fd, 'course_id');
  const [ch] = await sql<{ id: string }[]>`
    insert into chapter (course_id, position, title)
    values (${courseId}, (select coalesce(max(position), 0) + 1 from chapter where course_id = ${courseId}), 'Nytt kapitel')
    returning id`;
  const [se] = await sql<{ id: string }[]>`
    insert into section (chapter_id, position, title) values (${ch.id}, 1, 'Nytt avsnitt') returning id`;
  done();
  redirect(`/admin/utbildningar/${courseId}?s=${se.id}`);
}

export async function addSection(fd: FormData) {
  await requireAdmin();
  const chapterId = s(fd, 'chapter_id');
  const [se] = await sql<{ id: string; course_id: string }[]>`
    insert into section (chapter_id, position, title)
    values (${chapterId}, (select coalesce(max(position), 0) + 1 from section where chapter_id = ${chapterId}), 'Nytt avsnitt')
    returning id, (select course_id from chapter where id = ${chapterId}) as course_id`;
  done();
  redirect(`/admin/utbildningar/${se.course_id}?s=${se.id}`);
}

export async function renameItem(fd: FormData) {
  await requireAdmin();
  const title = s(fd, 'title');
  if (!title) return;
  if (s(fd, 'table') === 'chapter') await sql`update chapter set title = ${title} where id = ${s(fd, 'id')}`;
  if (s(fd, 'table') === 'section') await sql`update section set title = ${title} where id = ${s(fd, 'id')}`;
  done();
}

export async function deleteItem(fd: FormData) {
  await requireAdmin();
  const id = s(fd, 'id');
  const table = s(fd, 'table');
  if (table === 'chapter') await sql`delete from chapter where id = ${id}`;
  if (table === 'section') await sql`delete from section where id = ${id}`;
  if (table === 'block') await sql`delete from block where id = ${id}`;
  done();
}

/* ---------- Block ---------- */

const defaults: Record<string, object> = {
  text: { markdown: '' },
  tip: { text: '' },
  image: {},
  video: { required_percent: 0 },
  quiz: {
    question: '',
    kind: 'single',
    options: [
      { id: 'a', text: '', correct: true },
      { id: 'b', text: '', correct: false },
    ],
  },
};

export async function addBlock(fd: FormData) {
  await requireAdmin();
  const type = s(fd, 'type');
  const sectionId = s(fd, 'section_id');
  if (!(type in defaults)) return;
  await sql`insert into block (section_id, position, type, content)
    values (${sectionId}, (select coalesce(max(position), 0) + 1 from block where section_id = ${sectionId}),
      ${type}, ${sql.json(defaults[type] as never)})`;
  done();
}

export async function updateBlock(fd: FormData) {
  await requireAdmin();
  const id = s(fd, 'id');
  const [b] = await sql<{ type: string; content: Record<string, unknown> }[]>`select type, content from block where id = ${id}`;
  if (!b) return;
  let content: Record<string, unknown> = {};
  switch (b.type) {
    case 'text':
      content = { markdown: String(fd.get('markdown') ?? '') };
      break;
    case 'tip':
      content = { text: s(fd, 'text') };
      break;
    case 'image': {
      const media = await saveImage(fd.get('image'));
      content = { media_id: media ?? b.content.media_id, alt: s(fd, 'alt'), caption: s(fd, 'caption') };
      break;
    }
    case 'video': {
      const v = parseVimeo(s(fd, 'vimeo'));
      content = {
        ...(v ?? {}),
        title: s(fd, 'title'),
        required_percent: Math.min(100, Math.max(0, Number(fd.get('required_percent')) || 0)),
      };
      break;
    }
    case 'quiz': {
      const options: QuizOption[] = [];
      for (let i = 0; i < 6; i++) {
        const text = s(fd, `opt_text_${i}`);
        if (text) options.push({ id: String.fromCharCode(97 + i), text, correct: fd.get(`opt_correct_${i}`) === 'on' });
      }
      const kind = s(fd, 'kind') === 'multi' ? 'multi' : 'single';
      // Vid "ett rätt svar" behålls bara första markerade som rätt.
      if (kind === 'single') {
        let found = false;
        for (const o of options) {
          if (o.correct && !found) found = true;
          else o.correct = false;
        }
      }
      content = { question: s(fd, 'question'), kind, options, explanation: s(fd, 'explanation') };
      break;
    }
  }
  await sql`update block set content = ${sql.json(content as never)} where id = ${id}`;
  done();
}
