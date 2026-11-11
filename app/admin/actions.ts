'use server';

import { randomBytes } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { TransactionSql } from 'postgres';
import { sql } from '@/lib/db';
import { audit, authorize, authorizeRole, type Kind } from '@/lib/access';
import { slugify } from '@/lib/course';
import { parseVimeo } from '@/lib/vimeo';
import { parseYouTube } from '@/lib/youtube';
import type { QuizOption, Slide } from '@/lib/types';

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

/* ---------- Kunder ---------- */

export async function createCustomer(fd: FormData) {
  const user = await authorizeRole('super');
  const name = s(fd, 'name');
  if (!name) return;
  const [c] = await sql<{ id: string }[]>`insert into customer (name) values (${name}) returning id`;
  await audit(user, c.id, 'kund_skapad', { name });
  done();
  redirect(`/admin/kunder/${c.id}`);
}

export async function updateCustomer(fd: FormData) {
  const { user } = await authorize('customer', s(fd, 'id'), 'admin');
  const id = s(fd, 'id');
  const retention = [12, 24, 36].includes(Number(fd.get('retention_months'))) ? Number(fd.get('retention_months')) : 24;
  const color = /^#[0-9a-fA-F]{6}$/.test(s(fd, 'color')) ? s(fd, 'color') : '#0E6B66';
  const logo = await saveImage(fd.get('logo'), true);
  await sql`update customer set
      name = ${s(fd, 'name')}, color = ${color},
      contact_name = ${s(fd, 'contact_name') || null}, contact_email = ${s(fd, 'contact_email') || null},
      ${user.role === 'superadmin' ? sql`retention_months = ${retention},` : sql``}
      id = id
      ${logo ? sql`, logo_media_id = ${logo}` : sql``}
    where id = ${id}`;
  await audit(user, id, 'kundprofil_sparad');
  done();
}

const hexColor = (v: string, fallback: string) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback);

export async function updateCustomerCert(fd: FormData) {
  await authorize('customer', s(fd, 'id'), 'admin');
  const template = ['klassisk', 'modern', 'minimal'].includes(s(fd, 'cert_template')) ? s(fd, 'cert_template') : 'klassisk';
  const size = ['S', 'M', 'L'].includes(s(fd, 'cert_logo_size')) ? s(fd, 'cert_logo_size') : 'M';
  await sql`update customer set
      cert_template = ${template}, cert_accent = ${hexColor(s(fd, 'cert_accent'), '#B08D57')}, cert_logo_size = ${size},
      cert_seal = ${fd.get('cert_seal') === 'on'}, cert_show_briondo = ${fd.get('cert_show_briondo') === 'on'}
    where id = ${s(fd, 'id')}`;
  done();
}

export async function addCertBadge(fd: FormData) {
  await authorize('customer', s(fd, 'customer_id'), 'admin');
  const customerId = s(fd, 'customer_id');
  const media = await saveImage(fd.get('badge'), true);
  if (!media) return;
  await sql`insert into cert_badge (customer_id, media_id, label, position)
    values (${customerId}, ${media}, ${s(fd, 'label').slice(0, 80)},
      (select coalesce(max(position), 0) + 1 from cert_badge where customer_id = ${customerId}))`;
  done();
}

export async function updateCertBadge(fd: FormData) {
  await authorize('badge', s(fd, 'id'), 'admin');
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
  const { user } = await authorize('customer', s(fd, 'customer_id'), 'edit');
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
  await audit(user, customerId, 'utbildning_skapad', { course_id: id, title });
  done();
  redirect(`/admin/utbildningar/${id}`);
}

export async function updateCourseSettings(fd: FormData) {
  await authorize('course', s(fd, 'id'), 'edit');
  const id = s(fd, 'id');
  const access = ['name', 'name_email', 'register'].includes(s(fd, 'access_mode')) ? s(fd, 'access_mode') : 'name_email';
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
  const { user, customerId } = await authorize('course', s(fd, 'id'), 'edit');
  const status = s(fd, 'status') === 'published' ? 'published' : 'draft';
  await sql`update course set status = ${status} where id = ${s(fd, 'id')}`;
  await audit(user, customerId, status === 'published' ? 'utbildning_publicerad' : 'utbildning_avpublicerad', { course_id: s(fd, 'id') });
  done();
}

// Förhandsvisningslänk för kund: skapa/byt ut (ny hemlig nyckel) eller stäng av.
export async function setReviewLink(fd: FormData) {
  await authorize('course', s(fd, 'id'), 'edit');
  const id = s(fd, 'id');
  const token = s(fd, 'action') === 'off' ? null : randomBytes(18).toString('base64url');
  await sql`update course set preview_token = ${token} where id = ${id}`;
  done();
}

export async function deleteCourse(fd: FormData) {
  // Raderar även all elevdata och alla certifikat för utbildningen – därför kundadmin.
  const { user, customerId } = await authorize('course', s(fd, 'id'), 'admin');
  if (s(fd, 'confirm') !== 'RADERA') return;
  const [c] = await sql<{ customer_id: string; title: string }[]>`delete from course where id = ${s(fd, 'id')} returning customer_id, title`;
  await audit(user, customerId, 'utbildning_raderad', { course_id: s(fd, 'id'), title: c?.title });
  done();
  redirect(c ? `/admin/kunder/${c.customer_id}` : '/admin');
}

// Kopierar struktur och innehåll – inga elevdata.
export async function duplicateCourse(fd: FormData) {
  // Källan måste gå att läsa och målkunden att redigera (kundanvändare: bara inom den egna kunden).
  const { user } = await authorize('course', s(fd, 'id'), 'read');
  const target = s(fd, 'customer_id');
  await authorize('customer', target, 'edit');
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
  await audit(user, target, 'utbildning_kopierad', { from: srcId, course_id: newId });
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
    if (!other) {
      // Avsnitt överst/nederst i ett kapitel flyttas vidare till föregående/nästa kapitel.
      if (table === 'section') await moveSectionAcross(tx, id, row.parent, dir);
      return;
    }
    await tx`update ${tx(table)} set position = ${other.position} where id = ${id}`;
    await tx`update ${tx(table)} set position = ${row.position} where id = ${other.id}`;
  });
}

async function moveSectionAcross(tx: TransactionSql, id: string, chapterId: string, dir: 'up' | 'down') {
  const [ch] = await tx`select course_id, position from chapter where id = ${chapterId}`;
  if (!ch) return;
  const [target] = dir === 'up'
    ? await tx`select id from chapter where course_id = ${ch.course_id} and position < ${ch.position} order by position desc limit 1`
    : await tx`select id from chapter where course_id = ${ch.course_id} and position > ${ch.position} order by position asc limit 1`;
  if (!target) return;
  // Uppåt: sist i föregående kapitel. Nedåt: först i nästa kapitel.
  if (dir === 'up') {
    await tx`update section set chapter_id = ${target.id},
      position = (select coalesce(max(position), 0) + 1 from section where chapter_id = ${target.id}) where id = ${id}`;
  } else {
    await tx`update section set chapter_id = ${target.id},
      position = (select coalesce(min(position), 1) - 1 from section where chapter_id = ${target.id}) where id = ${id}`;
  }
}

// Flyttar ett avsnitt (med alla block och elevernas framsteg) sist i ett annat kapitel i samma utbildning.
export async function moveSectionToChapter(fd: FormData) {
  await authorize('section', s(fd, 'section_id'), 'edit');
  const id = s(fd, 'section_id');
  const chapterId = s(fd, 'chapter_id');
  await sql`update section set chapter_id = ${chapterId},
      position = (select coalesce(max(position), 0) + 1 from section where chapter_id = ${chapterId})
    where id = ${id} and chapter_id <> ${chapterId}
      and (select course_id from chapter where id = ${chapterId}) =
          (select c.course_id from chapter c join section s2 on s2.chapter_id = c.id where s2.id = ${id})`;
  done();
}

export async function moveItem(fd: FormData) {
  const table0 = s(fd, 'table') as Table;
  if (!(table0 in parentCol)) return;
  await authorize(table0 as Kind, s(fd, 'id'), 'edit');
  const table = s(fd, 'table') as Table;
  if (!(table in parentCol)) return;
  await move(table, s(fd, 'id'), s(fd, 'dir') === 'up' ? 'up' : 'down');
  done();
}

export async function addChapter(fd: FormData) {
  await authorize('course', s(fd, 'course_id'), 'edit');
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
  await authorize('chapter', s(fd, 'chapter_id'), 'edit');
  const chapterId = s(fd, 'chapter_id');
  const [se] = await sql<{ id: string; course_id: string }[]>`
    insert into section (chapter_id, position, title)
    values (${chapterId}, (select coalesce(max(position), 0) + 1 from section where chapter_id = ${chapterId}), 'Nytt avsnitt')
    returning id, (select course_id from chapter where id = ${chapterId}) as course_id`;
  done();
  redirect(`/admin/utbildningar/${se.course_id}?s=${se.id}`);
}

export async function renameItem(fd: FormData) {
  const tbl = s(fd, 'table');
  if (tbl !== 'chapter' && tbl !== 'section') return;
  await authorize(tbl, s(fd, 'id'), 'edit');
  const title = s(fd, 'title');
  if (!title) return;
  if (s(fd, 'table') === 'chapter') await sql`update chapter set title = ${title} where id = ${s(fd, 'id')}`;
  if (s(fd, 'table') === 'section') await sql`update section set title = ${title} where id = ${s(fd, 'id')}`;
  done();
}

export async function deleteItem(fd: FormData) {
  const tbl = s(fd, 'table');
  if (!['chapter', 'section', 'block'].includes(tbl)) return;
  await authorize(tbl as Kind, s(fd, 'id'), 'edit');
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
  slides: { slides: [], require_all: false },
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
  await authorize('section', s(fd, 'section_id'), 'edit');
  const type = s(fd, 'type');
  const sectionId = s(fd, 'section_id');
  if (!(type in defaults)) return;
  await sql`insert into block (section_id, position, type, content)
    values (${sectionId}, (select coalesce(max(position), 0) + 1 from block where section_id = ${sectionId}),
      ${type}, ${sql.json(defaults[type] as never)})`;
  done();
}

export async function updateBlock(fd: FormData) {
  await authorize('block', s(fd, 'block_id') || s(fd, 'id'), 'edit');
  const id = s(fd, 'block_id') || s(fd, 'id');
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
      // Två fält under samma block: Vimeo och YouTube. Finns båda används Vimeo i elevvyn.
      const v = parseVimeo(s(fd, 'vimeo'));
      const y = parseYouTube(s(fd, 'youtube'));
      content = {
        ...(v ?? {}),
        ...(y ?? {}),
        title: s(fd, 'title'),
        required_percent: Math.min(100, Math.max(0, Number(fd.get('required_percent')) || 0)),
      };
      break;
    }
    case 'slides': {
      // Bildtexter per bild, ordning och borttagning sparas i samma formulär (knapparna skickar op=up:3 osv.).
      let slides: Slide[] = ((b.content.slides as Slide[] | undefined) ?? []).map((x, i) => ({
        media_id: x.media_id,
        alt: fd.has(`alt_${i}`) ? s(fd, `alt_${i}`).slice(0, 300) : x.alt ?? '',
      }));
      const [op, idxStr] = s(fd, 'op').split(':');
      const idx = Number(idxStr);
      if (Number.isInteger(idx) && idx >= 0 && idx < slides.length) {
        if (op === 'up' && idx > 0) [slides[idx - 1], slides[idx]] = [slides[idx], slides[idx - 1]];
        if (op === 'down' && idx < slides.length - 1) [slides[idx + 1], slides[idx]] = [slides[idx], slides[idx + 1]];
        if (op === 'remove') slides = slides.filter((_, i) => i !== idx);
      }
      if (op === 'clear') slides = [];
      content = { slides, title: s(fd, 'title'), caption: s(fd, 'caption'), require_all: fd.get('require_all') === 'on' };
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

// Lägger till en bild sist i ett bildspel. Anropas en bild i taget från editorn (även för PDF-sidor som
// webbläsaren gjort om till bilder), så att varje anrop håller sig under storleksgränsen.
export async function addSlide(fd: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  await authorize('block', s(fd, 'block_id'), 'edit');
  const id = s(fd, 'block_id');
  try {
    const media = await saveImage(fd.get('image'));
    if (!media) return { ok: false, error: 'Ingen bild.' };
    const slide: Slide = { media_id: media, alt: s(fd, 'alt').slice(0, 300) };
    const [r] = await sql<{ id: string }[]>`
      update block set content = jsonb_set(content, '{slides}', coalesce(content->'slides', '[]'::jsonb) || ${sql.json([slide] as never)})
      where id = ${id} and type = 'slides' returning id`;
    if (!r) {
      await sql`delete from media where id = ${media}`;
      return { ok: false, error: 'Blocket finns inte längre.' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Uppladdningen misslyckades.' };
  }
}

export async function refreshAdmin() {
  await authorizeRole('read');
  done();
}
