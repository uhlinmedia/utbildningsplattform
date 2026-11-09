import 'server-only';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import { sql } from './db';

function hexToRgb(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export async function getCertificate(id: string) {
  const [c] = await sql<
    {
      id: string; learner_name: string | null; issued_at: Date; valid_until: Date | null; enrollment_id: string | null;
      course_title: string; cert_signer: string; customer_name: string; color: string; logo_media_id: string | null; course_id: string;
    }[]
  >`select ce.id, ce.learner_name, ce.issued_at, ce.valid_until, ce.enrollment_id, ce.course_id,
      co.title as course_title, co.cert_signer, cu.name as customer_name, cu.color, cu.logo_media_id
    from certificate ce join course co on co.id = ce.course_id join customer cu on cu.id = co.customer_id
    where ce.id = ${id}`;
  return c ?? null;
}

const fmt = (d: Date) => new Date(d).toLocaleDateString('sv-SE');

export async function renderCertificatePdf(cert: NonNullable<Awaited<ReturnType<typeof getCertificate>>>) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Certifikat – ${cert.course_title}`);
  const page = pdf.addPage([841.89, 595.28]); // A4 liggande
  const { width, height } = page.getSize();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.106, 0.141, 0.188);
  const muted = rgb(0.36, 0.4, 0.45);
  const brand = hexToRgb(cert.color);

  page.drawRectangle({ x: 28, y: 28, width: width - 56, height: height - 56, borderColor: brand, borderWidth: 2 });

  const center = (text: string, y: number, size: number, font = regular, color = ink) => {
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (width - w) / 2, y, size, font, color });
  };
  // Krymper långa namn/titlar så att de får plats.
  const fit = (text: string, max: number, font = bold) => {
    let size = max;
    while (size > 14 && font.widthOfTextAtSize(text, size) > width - 160) size -= 1;
    return size;
  };

  let top = height - 70;
  if (cert.logo_media_id) {
    const [m] = await sql<{ mime: string; data: Buffer }[]>`select mime, data from media where id = ${cert.logo_media_id}`;
    try {
      const img = m?.mime === 'image/png' ? await pdf.embedPng(m.data) : m?.mime === 'image/jpeg' ? await pdf.embedJpg(m.data) : null;
      if (img) {
        const scale = Math.min(160 / img.width, 54 / img.height);
        const w = img.width * scale, h = img.height * scale;
        page.drawImage(img, { x: (width - w) / 2, y: top - h, width: w, height: h });
        top -= h + 16;
      }
    } catch { /* logga i format som inte kan bäddas in hoppas över */ }
  }
  if (top === height - 70) {
    center(cert.customer_name, top - 20, 16, bold, muted);
    top -= 40;
  }

  center('CERTIFIKAT', top - 40, 14, bold, brand);
  center('Härmed intygas att', top - 80, 16, regular, muted);
  const name = cert.learner_name ?? '[Uppgift gallrad]';
  center(name, top - 130, fit(name, 40), bold);
  page.drawLine({ start: { x: width / 2 - 170, y: top - 148 }, end: { x: width / 2 + 170, y: top - 148 }, thickness: 0.8, color: rgb(0.8, 0.82, 0.85) });
  center('har genomfört och godkänts i utbildningen', top - 180, 16, regular, muted);
  center(cert.course_title, top - 218, fit(cert.course_title, 24), bold);

  // Nederkant: underskrift, datum/ID, QR
  const base = 70;
  if (cert.cert_signer) {
    page.drawLine({ start: { x: 70, y: base + 30 }, end: { x: 270, y: base + 30 }, thickness: 0.8, color: ink });
    page.drawText(cert.cert_signer, { x: 70, y: base + 12, size: 11, font: regular, color: ink });
  }
  const lines = [`Datum: ${fmt(cert.issued_at)}`, ...(cert.valid_until ? [`Giltigt till: ${fmt(cert.valid_until)}`] : []), `Certifikat-ID: ${cert.id}`];
  lines.forEach((l, i) => {
    const w = regular.widthOfTextAtSize(l, 11);
    page.drawText(l, { x: (width - w) / 2, y: base + 30 - i * 16, size: 11, font: regular, color: muted });
  });
  const verifyUrl = `${process.env.APP_URL ?? ''}/verifiera/${cert.id}`;
  const qr = await pdf.embedPng(await QRCode.toBuffer(verifyUrl, { margin: 1, width: 240 }));
  page.drawImage(qr, { x: width - 70 - 76, y: base - 6, width: 76, height: 76 });
  page.drawText('Verifiera', { x: width - 70 - 76, y: base - 20, size: 9, font: regular, color: muted });

  return pdf.save();
}
