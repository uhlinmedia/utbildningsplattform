import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb, degrees, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { sql } from './db';
import type { CertTemplate } from './types';

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

type Img = { mime: string; data: Buffer };

export type CertDesign = {
  template: CertTemplate;
  color: string;
  accent: string;
  logoSize: 'S' | 'M' | 'L';
  seal: boolean;
  showBriondo: boolean;
  customerName: string;
  courseTitle: string;
  title: string;
  intro: string;
  body: string;
  note: string;
  logo: Img | null;
  badges: { label: string; img: Img }[];
  signers: { name: string; title: string; signature: Img | null }[];
};

export type CertData = CertDesign & {
  id: string;
  learnerName: string | null;
  issuedAt: Date;
  validUntil: Date | null;
};

async function media(id: string | null): Promise<Img | null> {
  if (!id) return null;
  const [m] = await sql<Img[]>`select mime, data from media where id = ${id}`;
  return m ?? null;
}

const EXAMPLE_COURSE = {
  title: 'Exempelutbildning',
  cert_title: 'Certifikat',
  cert_intro: 'Härmed intygas att',
  cert_body: 'har genomfört och godkänts i utbildningen',
  cert_note: '',
  cert_signer: 'Förnamn Efternamn',
  cert_signer_title: 'Utbildningsansvarig',
  cert_signature_media_id: null,
  cert_signer2: '',
  cert_signer2_title: '',
  cert_signature2_media_id: null,
  cert_hidden_badges: [] as string[],
};

type CourseCertRow = typeof EXAMPLE_COURSE;

// Hämtar certifikatets utseende för en utbildning – eller för en kund med exempeltexter (förhandsvisning av kundprofil).
export async function loadCertDesign(opts: { courseId: string } | { customerId: string }): Promise<CertDesign | null> {
  let customerId: string;
  let course: CourseCertRow;
  if ('courseId' in opts) {
    const [c] = await sql<(CourseCertRow & { customer_id: string })[]>`
      select customer_id, title, cert_title, cert_intro, cert_body, cert_note, cert_signer, cert_signer_title,
        cert_signature_media_id, cert_signer2, cert_signer2_title, cert_signature2_media_id, cert_hidden_badges
      from course where id = ${opts.courseId}`;
    if (!c) return null;
    customerId = c.customer_id;
    course = c;
  } else {
    customerId = opts.customerId;
    course = EXAMPLE_COURSE;
  }
  const [cu] = await sql<{
    name: string; color: string; logo_media_id: string | null; cert_template: CertTemplate; cert_accent: string;
    cert_logo_size: 'S' | 'M' | 'L'; cert_seal: boolean; cert_show_briondo: boolean;
  }[]>`select name, color, logo_media_id, cert_template, cert_accent, cert_logo_size, cert_seal, cert_show_briondo
    from customer where id = ${customerId}`;
  if (!cu) return null;
  const hidden = new Set(course.cert_hidden_badges ?? []);
  const badgeRows = await sql<{ id: string; label: string; mime: string; data: Buffer }[]>`
    select b.id, b.label, m.mime, m.data from cert_badge b join media m on m.id = b.media_id
    where b.customer_id = ${customerId} order by b.position, b.created_at`;
  const signers = [
    { name: course.cert_signer, title: course.cert_signer_title, signature: await media(course.cert_signature_media_id) },
    { name: course.cert_signer2, title: course.cert_signer2_title, signature: await media(course.cert_signature2_media_id) },
  ].filter((s) => s.name.trim() || s.signature);
  return {
    template: cu.cert_template,
    color: cu.color,
    accent: cu.cert_accent,
    logoSize: cu.cert_logo_size,
    seal: cu.cert_seal,
    showBriondo: cu.cert_show_briondo,
    customerName: cu.name,
    courseTitle: course.title,
    title: course.cert_title || 'Certifikat',
    intro: course.cert_intro,
    body: course.cert_body,
    note: course.cert_note,
    logo: await media(cu.logo_media_id),
    badges: badgeRows.filter((b) => !hidden.has(b.id)).map((b) => ({ label: b.label, img: { mime: b.mime, data: b.data } })),
    signers,
  };
}

export async function getCertificate(id: string) {
  const [c] = await sql<
    { id: string; learner_name: string | null; issued_at: Date; valid_until: Date | null; enrollment_id: string | null; course_id: string }[]
  >`select id, learner_name, issued_at, valid_until, enrollment_id, course_id from certificate where id = ${id}`;
  if (!c) return null;
  const design = await loadCertDesign({ courseId: c.course_id });
  if (!design) return null;
  const data: CertData = { ...design, id: c.id, learnerName: c.learner_name, issuedAt: c.issued_at, validUntil: c.valid_until };
  return { ...c, data };
}

export function exampleCertificate(design: CertDesign, validMonths?: number | null): CertData {
  const issuedAt = new Date();
  const validUntil = validMonths ? new Date(new Date().setMonth(issuedAt.getMonth() + validMonths)) : null;
  return { ...design, id: 'EXEMPEL', learnerName: 'Anna Andersson', issuedAt, validUntil };
}

/* ------------------------------------------------------------------ */
/* Ritverktyg                                                          */
/* ------------------------------------------------------------------ */

const W = 841.89; // A4 liggande
const H = 595.28;
const INK = rgb(0.106, 0.141, 0.188);
const MUTED = rgb(0.36, 0.4, 0.45);
const WHITE = rgb(1, 1, 1);
const BRIONDO = rgb(0.055, 0.486, 0.455);

const FONT_FILES = {
  serif: 'CormorantGaramond-SemiBold.ttf',
  serifBold: 'CormorantGaramond-Bold.ttf',
  serifItalic: 'CormorantGaramond-MediumItalic.ttf',
  sans: 'Outfit-Regular.ttf',
  sansSemi: 'Outfit-SemiBold.ttf',
  sansBold: 'Outfit-Bold.ttf',
} as const;
type FontKey = keyof typeof FONT_FILES;
let fontBytes: Record<FontKey, Buffer> | null = null;
function loadFonts() {
  if (!fontBytes) {
    const dir = join(process.cwd(), 'lib', 'fonts');
    fontBytes = Object.fromEntries(
      Object.entries(FONT_FILES).map(([k, f]) => [k, readFileSync(join(dir, f))]),
    ) as Record<FontKey, Buffer>;
  }
  return fontBytes;
}

function hex(h: string): RGB {
  const n = parseInt(h.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
function mix(a: RGB, b: RGB, t: number): RGB {
  return rgb(a.red + (b.red - a.red) * t, a.green + (b.green - a.green) * t, a.blue + (b.blue - a.blue) * t);
}
// Relativ luminans – används för att välja vit eller mörk text på kundens färg.
function luminance(c: RGB) {
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c.red) + 0.7152 * f(c.green) + 0.0722 * f(c.blue);
}
const fmt = (d: Date) => new Date(d).toLocaleDateString('sv-SE');

// Gör om alla bildformat (WebP, GIF, SVG, CMYK-JPEG …) till något PDF:en kan bädda in, i rimlig upplösning.
async function embed(pdf: PDFDocument, img: Img | null): Promise<PDFImage | null> {
  if (!img) return null;
  try {
    const isSvg = img.mime === 'image/svg+xml';
    const pipeline = sharp(img.data, { density: isSvg ? 600 : 72 })
      .rotate()
      .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: !isSvg })
      .toColorspace('srgb');
    if (img.mime === 'image/jpeg') return await pdf.embedJpg(await pipeline.jpeg({ quality: 90 }).toBuffer());
    return await pdf.embedPng(await pipeline.png().toBuffer());
  } catch {
    return null; // trasig eller okänd bild hoppas över
  }
}

type Align = 'left' | 'center' | 'right';

class Canvas {
  constructor(public page: PDFPage, public f: Record<FontKey, PDFFont>) {}

  width(text: string, font: FontKey, size: number, tracking = 0) {
    return this.f[font].widthOfTextAtSize(text, size) + tracking * Math.max(0, [...text].length - 1);
  }

  text(text: string, x: number, y: number, o: { font: FontKey; size: number; color?: RGB; align?: Align; tracking?: number; opacity?: number }) {
    if (!text) return;
    const { font, size, color = INK, align = 'left', tracking = 0, opacity } = o;
    const w = this.width(text, font, size, tracking);
    let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    if (!tracking) {
      this.page.drawText(text, { x: cx, y, size, font: this.f[font], color, opacity });
      return;
    }
    for (const ch of text) {
      this.page.drawText(ch, { x: cx, y, size, font: this.f[font], color, opacity });
      cx += this.f[font].widthOfTextAtSize(ch, size) + tracking;
    }
  }

  // Största storlek (ned till min) där texten ryms på högst `lines` rader.
  fit(text: string, font: FontKey, max: number, min: number, maxWidth: number, lines = 1) {
    for (let size = max; size >= min; size -= 0.5) {
      const rows = this.wrap(text, font, size, maxWidth);
      if (rows.length <= lines) return { size, rows };
    }
    const rows = this.wrap(text, font, min, maxWidth);
    return { size: min, rows: rows.slice(0, lines) };
  }

  wrap(text: string, font: FontKey, size: number, maxWidth: number) {
    const words = text.split(/\s+/).filter(Boolean);
    const rows: string[] = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (this.width(next, font, size) <= maxWidth || !cur) cur = next;
      else { rows.push(cur); cur = w; }
    }
    if (cur) rows.push(cur);
    return rows;
  }

  // Ritar en SVG-bana angiven i sidans koordinater (y uppåt).
  path(d: string, o: { fill?: RGB; stroke?: RGB; width?: number; opacity?: number }) {
    this.page.drawSvgPath(d, {
      x: 0, y: H,
      color: o.fill, borderColor: o.stroke, borderWidth: o.stroke ? (o.width ?? 1) : 0,
      opacity: o.opacity, borderOpacity: o.opacity,
    });
  }

  image(img: PDFImage, box: { x: number; y: number; w: number; h: number }, align: Align = 'center', valign: 'top' | 'middle' | 'bottom' = 'middle') {
    const s = Math.min(box.w / img.width, box.h / img.height);
    const w = img.width * s, h = img.height * s;
    const x = align === 'left' ? box.x : align === 'right' ? box.x + box.w - w : box.x + (box.w - w) / 2;
    const y = valign === 'top' ? box.y + box.h - h : valign === 'bottom' ? box.y : box.y + (box.h - h) / 2;
    this.page.drawImage(img, { x, y, width: w, height: h });
    return { x, y, w, h };
  }
}

const pt = (x: number, y: number) => `${x.toFixed(2)} ${(H - y).toFixed(2)}`;
const poly = (points: [number, number][], close = false) =>
  `M ${points.map(([x, y]) => pt(x, y)).join(' L ')}${close ? ' Z' : ''}`;
function roundRect(x: number, y: number, w: number, h: number, r: number) {
  return `M ${pt(x + r, y)} L ${pt(x + w - r, y)} Q ${pt(x + w, y)} ${pt(x + w, y + r)} L ${pt(x + w, y + h - r)} `
    + `Q ${pt(x + w, y + h)} ${pt(x + w - r, y + h)} L ${pt(x + r, y + h)} Q ${pt(x, y + h)} ${pt(x, y + h - r)} `
    + `L ${pt(x, y + r)} Q ${pt(x, y)} ${pt(x + r, y)} Z`;
}

/* ---------- Dekor ---------- */

// Guillochémönster (sammanflätade vågor) längs en sträcka – klassisk värdepappersdekor.
function guillocheEdge(c: Canvas, from: [number, number], to: [number, number], amp: number, color: RGB) {
  const [x0, y0] = from, [x1, y1] = to;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
  const nx = -uy, ny = ux;
  const period = 16;
  const steps = Math.ceil(len / 1.5);
  for (let k = 0; k < 4; k++) {
    const phase = (k * Math.PI) / 4;
    const pts: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * len;
      const off = amp * Math.sin((2 * Math.PI * t) / period + phase) * (k % 2 ? 1 : 0.6);
      pts.push([x0 + ux * t + nx * off, y0 + uy * t + ny * off]);
    }
    c.path(poly(pts), { stroke: color, width: 0.45 });
  }
}

// Rosett (spirograf) som svag vattenstämpel.
function rosette(c: Canvas, cx: number, cy: number, r: number, color: RGB, opacity: number) {
  const R = r, rr = r * 0.38, d = r * 0.62;
  const pts: [number, number][] = [];
  const n = 1400;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2 * 19;
    const x = (R - rr) * Math.cos(t) + d * Math.cos(((R - rr) / rr) * t);
    const y = (R - rr) * Math.sin(t) - d * Math.sin(((R - rr) / rr) * t);
    pts.push([cx + x * 0.62, cy + y * 0.62]);
  }
  c.path(poly(pts), { stroke: color, width: 0.35, opacity });
}

// Sigill: tandad rosett med text runt om och årtal i mitten.
function seal(c: Canvas, cx: number, cy: number, R: number, fill: RGB, fg: RGB, ring: string, center: string) {
  const outer: [number, number][] = [];
  for (let i = 0; i <= 360; i++) {
    const a = (i / 360) * Math.PI * 2;
    const r = R + 2.2 * Math.cos(a * 30);
    outer.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  c.path(poly(outer, true), { fill });
  const circle = (r: number, width: number) => {
    const p: [number, number][] = [];
    for (let i = 0; i <= 120; i++) { const a = (i / 120) * Math.PI * 2; p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    c.path(poly(p, true), { stroke: fg, width });
  };
  circle(R - 5, 0.9);
  circle(R - 18, 0.6);

  // Texten fördelas jämnt runt hela ringen, medurs med början högst upp.
  const size = R * 0.15;
  const r = R - 11.5 - size * 0.36; // baslinje så att versalerna hamnar mitt i bandet
  const chars = [...ring];
  const widths = chars.map((ch) => c.f.sansSemi.widthOfTextAtSize(ch, size));
  const gap = Math.max(0, (2 * Math.PI * r - widths.reduce((a, b) => a + b, 0)) / chars.length);
  let arc = 0;
  chars.forEach((ch, i) => {
    const mid = arc + widths[i] / 2;
    const theta = Math.PI / 2 - mid / r;
    const sx = cx + r * Math.cos(theta) - (widths[i] / 2) * Math.sin(theta);
    const sy = cy + r * Math.sin(theta) + (widths[i] / 2) * Math.cos(theta);
    c.page.drawText(ch, { x: sx, y: sy, size, font: c.f.sansSemi, color: fg, rotate: degrees((theta * 180) / Math.PI - 90) });
    arc += widths[i] + gap;
  });
  // Stjärnor och årtal i mitten
  c.text(center, cx, cy - R * 0.12, { font: 'serifBold', size: R * 0.34, color: fg, align: 'center' });
  const star = (sx: number, sy: number, s: number) => {
    const p: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 ? s * 0.42 : s;
      p.push([sx + rad * Math.cos(a), sy + rad * Math.sin(a)]);
    }
    c.path(poly(p, true), { fill: fg });
  };
  star(cx, cy + R * 0.3, R * 0.07);
  star(cx - R * 0.17, cy + R * 0.27, R * 0.05);
  star(cx + R * 0.17, cy + R * 0.27, R * 0.05);
}

function divider(c: Canvas, cx: number, y: number, half: number, color: RGB) {
  c.page.drawLine({ start: { x: cx - half, y }, end: { x: cx - 8, y }, thickness: 0.7, color });
  c.page.drawLine({ start: { x: cx + 8, y }, end: { x: cx + half, y }, thickness: 0.7, color });
  c.path(poly([[cx, y + 4], [cx + 4, y], [cx, y - 4], [cx - 4, y]], true), { fill: color });
}

/* ---------- Gemensamma delar ---------- */

type Ctx = {
  c: Canvas; pdf: PDFDocument; d: CertData; brand: RGB; accent: RGB; brandText: RGB;
  logo: PDFImage | null; badges: { img: PDFImage; label: string }[]; signatures: (PDFImage | null)[]; qr: PDFImage;
};

const LOGO_BOX = { S: { w: 150, h: 40 }, M: { w: 210, h: 58 }, L: { w: 280, h: 80 } } as const;

function signers(ctx: Ctx, slots: { x: number; w: number }[], lineY: number, color = INK, muted = MUTED) {
  const { c, d } = ctx;
  d.signers.forEach((s, i) => {
    const slot = slots[i];
    if (!slot) return;
    const sig = ctx.signatures[i];
    if (sig) c.image(sig, { x: slot.x + 10, y: lineY + 3, w: slot.w - 20, h: 40 }, 'center', 'bottom');
    c.page.drawLine({ start: { x: slot.x, y: lineY }, end: { x: slot.x + slot.w, y: lineY }, thickness: 0.7, color });
    const name = c.fit(s.name, 'sansSemi', 10.5, 8, slot.w);
    c.text(name.rows[0] ?? '', slot.x + slot.w / 2, lineY - 14, { font: 'sansSemi', size: name.size, color, align: 'center' });
    if (s.title) {
      const t = c.fit(s.title, 'sans', 9, 7, slot.w);
      c.text(t.rows[0], slot.x + slot.w / 2, lineY - 26, { font: 'sans', size: t.size, color: muted, align: 'center' });
    }
  });
}

// Märkesrad (ISO m.fl.). Returnerar använd bredd.
function badgeRow(ctx: Ctx, x: number, y: number, h: number, maxTotal: number, align: Align) {
  const list = ctx.badges.slice(0, 6);
  if (!list.length) return 0;
  const gap = 14;
  let scale = 1;
  const widths = () => list.map((b) => Math.min((b.img.width / b.img.height) * h * scale, h * 2.4 * scale));
  let total = widths().reduce((a, b) => a + b, 0) + gap * (list.length - 1);
  if (total > maxTotal) { scale = (maxTotal - gap * (list.length - 1)) / (total - gap * (list.length - 1)); total = maxTotal; }
  let cx = align === 'left' ? x : align === 'right' ? x - total : x - total / 2;
  widths().forEach((w, i) => {
    ctx.c.image(list[i].img, { x: cx, y, w, h: h * scale }, 'center', 'middle');
    cx += w + gap;
  });
  return total;
}

function metaLines(d: CertData) {
  return [
    `Utfärdat ${fmt(d.issuedAt)}`,
    ...(d.validUntil ? [`Giltigt t.o.m. ${fmt(d.validUntil)}`] : []),
    `Certifikat-ID ${d.id}`,
  ];
}

function briondoLine(c: Canvas, x: number, y: number, align: Align, color = MUTED, ink = INK, accent = BRIONDO) {
  const by = 'Utfärdat via ';
  const w = c.width(by, 'sans', 7.5) + c.width('Briondo', 'sansBold', 7.5);
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  c.text(by, x0, y, { font: 'sans', size: 7.5, color });
  const bw = c.width(by, 'sans', 7.5);
  c.text('Brion', x0 + bw, y, { font: 'sansBold', size: 7.5, color: ink });
  c.text('do', x0 + bw + c.width('Brion', 'sansBold', 7.5), y, { font: 'sansBold', size: 7.5, color: accent });
}

const sealRing = (d: CertData) => {
  const name = d.customerName.toUpperCase().slice(0, 30);
  return `${name} • ${d.title.toUpperCase().slice(0, 20)} • `;
};

/* ------------------------------------------------------------------ */
/* Mallar                                                              */
/* ------------------------------------------------------------------ */

function classic(ctx: Ctx) {
  const { c, d, brand, accent } = ctx;
  const cx = W / 2;

  // Ram: yttre linje, guillochéband, inre dubbellinje och hörnornament
  const o = 20, i = 40, mid = (o + i) / 2;
  c.page.drawRectangle({ x: o, y: o, width: W - 2 * o, height: H - 2 * o, borderColor: brand, borderWidth: 1.6 });
  c.page.drawRectangle({ x: i, y: i, width: W - 2 * i, height: H - 2 * i, borderColor: brand, borderWidth: 0.8 });
  c.page.drawRectangle({ x: i + 5, y: i + 5, width: W - 2 * (i + 5), height: H - 2 * (i + 5), borderColor: accent, borderWidth: 0.5 });
  const g = mix(accent, WHITE, 0.15);
  guillocheEdge(c, [i, mid], [W - i, mid], 6.5, g);
  guillocheEdge(c, [i, H - mid], [W - i, H - mid], 6.5, g);
  guillocheEdge(c, [mid, i], [mid, H - i], 6.5, g);
  guillocheEdge(c, [W - mid, i], [W - mid, H - i], 6.5, g);
  for (const [x, y] of [[mid, mid], [W - mid, mid], [mid, H - mid], [W - mid, H - mid]] as [number, number][]) {
    c.page.drawRectangle({ x: x - 10, y: y - 10, width: 20, height: 20, color: WHITE, borderColor: brand, borderWidth: 0.8 });
    c.path(poly([[x, y + 7], [x + 7, y], [x, y - 7], [x - 7, y]], true), { fill: accent });
    c.path(poly([[x, y + 3], [x + 3, y], [x, y - 3], [x - 3, y]], true), { fill: WHITE });
  }
  rosette(c, cx, 318, 185, accent, 0.09);

  // Textblocket ritas i en skala som gör att det alltid slutar ovanför underskrifter och sigill.
  const layout = (k: number, draw: boolean) => {
    const t = (str: string, y: number, o: Parameters<Canvas['text']>[3]) => { if (draw) c.text(str, cx, y, { ...o, align: 'center' }); };
    let top = H - 66;
    const box = LOGO_BOX[d.logoSize];
    if (ctx.logo) {
      const lb = { w: box.w * k, h: box.h * k };
      const s = Math.min(lb.w / ctx.logo.width, lb.h / ctx.logo.height);
      if (draw) c.image(ctx.logo, { x: cx - lb.w / 2, y: top - lb.h, w: lb.w, h: lb.h }, 'center', 'top');
      top -= ctx.logo.height * s + 26 * k;
    } else {
      t(d.customerName.toUpperCase(), top - 16, { font: 'sansSemi', size: 12, color: MUTED, tracking: 2.5 });
      top -= 44;
    }
    const titleSize = c.fit(d.title.toUpperCase(), 'serifBold', 44 * k, 24, 560).size;
    t(d.title.toUpperCase(), top - titleSize * 0.8, { font: 'serifBold', size: titleSize, color: ctx.brandText, tracking: titleSize * 0.16 });
    top -= titleSize * 0.8 + 18 * k;
    if (draw) divider(c, cx, top, 120, accent);
    top -= 32 * k;
    t(d.intro, top, { font: 'serifItalic', size: 17 * k, color: MUTED });
    const name = d.learnerName ?? '[Uppgift gallrad]';
    const ns = c.fit(name, 'serifBold', 46 * k, 22, 600).size;
    top -= ns + 6 * k;
    t(name, top, { font: 'serifBold', size: ns, color: INK });
    top -= 14 * k;
    if (draw) c.page.drawLine({ start: { x: cx - 190, y: top }, end: { x: cx + 190, y: top }, thickness: 0.6, color: accent });
    top -= 24 * k;
    t(d.body, top, { font: 'serifItalic', size: 15 * k, color: MUTED });
    const ct = c.fit(d.courseTitle, 'serifBold', 26 * k, 14, 600, 2);
    ct.rows.forEach((row) => {
      top -= ct.size + 4 * k;
      t(row, top, { font: 'serifBold', size: ct.size, color: ctx.brandText });
    });
    if (d.note) {
      top -= 20 * k;
      const n = c.fit(d.note, 'sans', 10.5, 8, 640);
      t(n.rows[0], top, { font: 'sans', size: n.size, color: MUTED });
    }
    return top;
  };
  const floor = d.seal ? 198 : d.signers.some((x) => x.signature) ? 186 : 160;
  let k = 1;
  while (k > 0.7 && layout(k, false) < floor) k -= 0.03;
  layout(k, true);

  // Underskrifter och sigill
  const lineY = 134;
  const slotW = 190;
  const left = { x: 96, w: slotW }, right = { x: W - 96 - slotW, w: slotW }, center = { x: cx - slotW / 2, w: slotW };
  const n = d.signers.length;
  const slots = d.seal || n === 2 ? (n === 1 ? [left] : [left, right]) : [center];
  signers(ctx, slots, lineY);
  if (d.seal) seal(c, cx, lineY + 6, 44, accent, WHITE, sealRing(d), String(new Date(d.issuedAt).getFullYear()));

  // Fot: datum/ID till vänster, märken i mitten, QR till höger
  const footY = 58;
  metaLines(d).forEach((l, k) => c.text(l, 62, footY + 30 - k * 11, { font: 'sans', size: 8.5, color: MUTED }));
  if (d.showBriondo) briondoLine(c, 62, footY + 30 - metaLines(d).length * 11 - 2, 'left');
  badgeRow(ctx, cx, footY - 2, 40, 380, 'center');
  c.page.drawImage(ctx.qr, { x: W - 62 - 50, y: footY - 6, width: 50, height: 50 });
  c.text('Skanna för att verifiera', W - 62 - 56, footY + 2, { font: 'sans', size: 7.5, color: MUTED, align: 'right' });
}

function modern(ctx: Ctx) {
  const { c, d, brand, accent } = ctx;
  const panel = 256;
  const onBrand = luminance(brand) > 0.45 ? INK : WHITE;
  const onBrandMuted = mix(onBrand, brand, 0.3);

  c.page.drawRectangle({ x: 0, y: 0, width: panel, height: H, color: brand });
  rosette(c, panel / 2, H / 2 - 10, 150, onBrand, 0.1);
  c.page.drawRectangle({ x: panel, y: 0, width: 5, height: H, color: accent });

  // Logga på vit platta
  const box = LOGO_BOX[d.logoSize];
  const lw = Math.min(box.w, panel - 56), lh = box.h;
  if (ctx.logo) {
    const s = Math.min(lw / ctx.logo.width, lh / ctx.logo.height);
    const w = ctx.logo.width * s, h = ctx.logo.height * s;
    const px = 28, pw = panel - 56, ph = h + 36, py = H - 40 - ph;
    c.path(roundRect(px, py, pw, ph, 10), { fill: WHITE });
    c.page.drawImage(ctx.logo, { x: px + (pw - w) / 2, y: py + 18, width: w, height: h });
  } else {
    const r = c.fit(d.customerName, 'sansBold', 22, 12, panel - 56, 3);
    r.rows.forEach((row, k) => c.text(row, 28, H - 62 - k * (r.size + 4), { font: 'sansBold', size: r.size, color: onBrand }));
  }
  if (d.seal) seal(c, panel / 2, H / 2 - 10, 50, accent, luminance(accent) > 0.45 ? INK : WHITE, sealRing(d), String(new Date(d.issuedAt).getFullYear()));

  // QR på vit platta + meta
  c.path(roundRect(28, 44, 74, 74, 8), { fill: WHITE });
  c.page.drawImage(ctx.qr, { x: 33, y: 49, width: 64, height: 64 });
  const meta = metaLines(d);
  meta.forEach((l, k) => c.text(l, 114, 104 - k * 12, { font: 'sans', size: 8.5, color: onBrand }));
  c.text('Skanna för att verifiera', 114, 104 - meta.length * 12, { font: 'sans', size: 8.5, color: onBrandMuted });

  // Text
  const x = panel + 52, maxW = W - x - 56;
  let top = H - 92;
  c.page.drawRectangle({ x, y: top + 20, width: 42, height: 4, color: accent });
  c.text(d.title.toUpperCase(), x, top, { font: 'sansSemi', size: 14, color: ctx.brandText, tracking: 4 });
  top -= 46;
  c.text(d.intro, x, top, { font: 'sans', size: 14, color: MUTED });
  const name = d.learnerName ?? '[Uppgift gallrad]';
  const ns = c.fit(name, 'sansBold', 44, 22, maxW).size;
  top -= ns + 8;
  c.text(name, x, top, { font: 'sansBold', size: ns, color: INK });
  top -= 30;
  c.text(d.body, x, top, { font: 'sans', size: 14, color: MUTED });
  const ct = c.fit(d.courseTitle, 'sansSemi', 24, 14, maxW, 2);
  ct.rows.forEach((row) => {
    top -= ct.size + 6;
    c.text(row, x, top, { font: 'sansSemi', size: ct.size, color: ctx.brandText });
  });
  if (d.note) {
    top -= 22;
    const n = c.fit(d.note, 'sans', 10.5, 8.5, maxW);
    c.text(n.rows[0], x, top, { font: 'sans', size: n.size, color: MUTED });
  }

  // Underskrifter och märken längst ner
  const slotW = 180;
  signers(ctx, d.signers.map((_, k) => ({ x: x + k * (slotW + 30), w: slotW })), 120);
  badgeRow(ctx, W - 56, 44, 36, maxW, 'right');
  if (d.showBriondo) briondoLine(c, x, 44, 'left');
}

function minimal(ctx: Ctx) {
  const { c, d, brand, accent } = ctx;
  const m = 30;
  c.page.drawRectangle({ x: m, y: m, width: W - 2 * m, height: H - 2 * m, borderColor: brand, borderWidth: 0.75 });
  const x = 76, right = W - 76;

  const box = LOGO_BOX[d.logoSize];
  const topY = H - 66;
  if (ctx.logo) c.image(ctx.logo, { x, y: topY - box.h, w: box.w, h: box.h }, 'left', 'top');
  else c.text(d.customerName, x, topY - 18, { font: 'sansBold', size: 18, color: INK });
  badgeRow(ctx, right, topY - 38, 38, 330, 'right');

  let top = 410;
  c.text(d.title.toUpperCase(), x, top, { font: 'sansSemi', size: 12, color: ctx.brandText, tracking: 3.5 });
  c.page.drawLine({ start: { x, y: top - 12 }, end: { x: x + 36, y: top - 12 }, thickness: 1.5, color: accent });
  top -= 42;
  c.text(d.intro, x, top, { font: 'sans', size: 13, color: MUTED });
  const name = d.learnerName ?? '[Uppgift gallrad]';
  const maxW = d.seal ? 500 : right - x;
  const ns = c.fit(name, 'serifBold', 52, 24, maxW).size;
  top -= ns + 4;
  c.text(name, x, top, { font: 'serifBold', size: ns, color: INK });
  top -= 28;
  c.text(d.body, x, top, { font: 'sans', size: 13, color: MUTED });
  const ct = c.fit(d.courseTitle, 'sansSemi', 22, 13, maxW, 2);
  ct.rows.forEach((row) => {
    top -= ct.size + 6;
    c.text(row, x, top, { font: 'sansSemi', size: ct.size, color: INK });
  });
  if (d.note) {
    top -= 20;
    const n = c.fit(d.note, 'sans', 10, 8.5, maxW);
    c.text(n.rows[0], x, top, { font: 'sans', size: n.size, color: MUTED });
  }
  if (d.seal) seal(c, right - 56, 300, 52, accent, luminance(accent) > 0.45 ? INK : WHITE, sealRing(d), String(new Date(d.issuedAt).getFullYear()));

  const slotW = 180;
  signers(ctx, d.signers.map((_, k) => ({ x: x + k * (slotW + 30), w: slotW })), 116);
  c.page.drawImage(ctx.qr, { x: right - 54, y: 56, width: 54, height: 54 });
  const meta = metaLines(d);
  meta.forEach((l, k) => c.text(l, right - 66, 98 - k * 11, { font: 'sans', size: 8.5, color: MUTED, align: 'right' }));
  if (d.showBriondo) briondoLine(c, right - 66, 98 - meta.length * 11 - 2, 'right');
}

/* ------------------------------------------------------------------ */

export async function renderCertificatePdf(d: CertData) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`${d.title} – ${d.courseTitle}`);
  pdf.setAuthor(d.customerName);
  pdf.setCreator('Briondo');
  pdf.setProducer('Briondo');
  const page = pdf.addPage([W, H]);
  const bytes = loadFonts();
  const fonts = {} as Record<FontKey, PDFFont>;
  for (const k of Object.keys(bytes) as FontKey[]) fonts[k] = await pdf.embedFont(bytes[k], { subset: true });
  const c = new Canvas(page, fonts);

  const brand = hex(d.color);
  const accent = hex(d.accent);
  const verifyUrl = `${process.env.APP_URL ?? ''}/verifiera/${d.id}`;
  const qr = await pdf.embedPng(await QRCode.toBuffer(verifyUrl, { margin: 0, width: 300, color: { dark: '#1b2430', light: '#ffffff' } }));
  const badges: { img: PDFImage; label: string }[] = [];
  for (const b of d.badges) {
    const img = await embed(pdf, b.img);
    if (img) badges.push({ img, label: b.label });
  }
  // Ljusa profilfärger (t.ex. gult) mörkas av när de används som text, så att kontrasten räcker.
  const brandText = luminance(brand) > 0.3 ? mix(brand, INK, 0.6) : brand;
  const ctx: Ctx = {
    c, pdf, d, brand, accent, brandText, qr, badges,
    logo: await embed(pdf, d.logo),
    signatures: await Promise.all(d.signers.map((s) => embed(pdf, s.signature))),
  };
  const templates = { klassisk: classic, modern, minimal } as const;
  (templates[d.template] ?? classic)(ctx);
  return pdf.save();
}
