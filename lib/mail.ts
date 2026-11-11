import 'server-only';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';

// Utskick via SMTP (Broadview, noreply@briondo.se). Inställningar i miljövariabler:
//   SMTP_HOST, SMTP_PORT (465 = SSL, 587 = STARTTLS), SMTP_USER, SMTP_PASS,
//   MAIL_FROM (t.ex. "Briondo <noreply@briondo.se>"), MAIL_REPLY_TO (valfri).
// Utan SMTP_HOST men med MAIL_DIR sparas mejlen som filer (lokalt och i tester).

export type Mail = { to: string; subject: string; text: string; html: string };

let transport: nodemailer.Transporter | null = null;

export function mailConfigured() {
  return !!process.env.SMTP_HOST || !!process.env.MAIL_DIR;
}

export async function sendMail(m: Mail) {
  const from = process.env.MAIL_FROM || 'Briondo <noreply@briondo.se>';
  if (!process.env.SMTP_HOST) {
    const dir = process.env.MAIL_DIR;
    if (!dir) throw new Error('E-post är inte inställd (SMTP_HOST saknas).');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    await writeFile(file, JSON.stringify({ from, ...m }, null, 2));
    return;
  }
  const port = Number(process.env.SMTP_PORT) || 587;
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  await transport.sendMail({ from, replyTo: process.env.MAIL_REPLY_TO || undefined, ...m });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// Enkel mall: rubrik, stycken, en knapp och en rad om varför man fått mejlet.
export function mailTemplate(o: {
  to: string;
  subject: string;
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  footer: string;
  brand?: string; // kundens färg
}): Mail {
  const color = /^#[0-9a-f]{6}$/i.test(o.brand ?? '') ? o.brand! : '#0E7C74';
  const text = [
    o.heading, '',
    ...o.paragraphs.flatMap((p) => [p, '']),
    ...(o.button ? [`${o.button.label}: ${o.button.url}`, ''] : []),
    '—', o.footer, 'Briondo · briondo.se',
  ].join('\n');
  const html = `<!doctype html><html lang="sv"><body style="margin:0;background:#f4f6f8;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#14202B">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="height:6px;background:${color}"></td></tr>
<tr><td style="padding:28px 28px 8px"><h1 style="margin:0 0 16px;font-size:21px;line-height:1.3">${esc(o.heading)}</h1>
${o.paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55">${esc(p)}</p>`).join('')}
${o.button ? `<p style="margin:22px 0 10px"><a href="${esc(o.button.url)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px;font-size:15px">${esc(o.button.label)}</a></p>
<p style="margin:0 0 14px;font-size:12px;color:#5b6b7a;word-break:break-all">Fungerar inte knappen? Kopiera länken: ${esc(o.button.url)}</p>` : ''}
</td></tr>
<tr><td style="padding:14px 28px 24px;border-top:1px solid #e6eaee;font-size:12px;color:#5b6b7a;line-height:1.5">${esc(o.footer)}<br>Briondo · briondo.se</td></tr>
</table></td></tr></table></body></html>`;
  return { to: o.to, subject: o.subject, text, html };
}

export const appUrl = (p: string) => `${(process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')}${p}`;
