import { canReadCustomer } from '@/lib/auth';
import { customerOf } from '@/lib/access';
import { sql } from '@/lib/db';
import { exampleCertificate, loadCertDesign, renderCertificatePdf } from '@/lib/certificate';

// Förhandsvisning av certifikatet med exempelnamn: ?utbildning=<id> eller ?kund=<id>.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const courseId = url.searchParams.get('utbildning');
  const customerId = url.searchParams.get('kund');
  const owner = courseId ? await customerOf('course', courseId) : customerId ? await customerOf('customer', customerId) : null;
  if (!(await canReadCustomer(owner))) return new Response('Ingen behörighet', { status: 403 });
  const uuid = /^[0-9a-f-]{36}$/i;
  let validMonths: number | null = null;
  let design = null;
  if (courseId && uuid.test(courseId)) {
    design = await loadCertDesign({ courseId });
    const [c] = await sql<{ cert_valid_months: number | null }[]>`select cert_valid_months from course where id = ${courseId}`;
    validMonths = c?.cert_valid_months ?? null;
  } else if (customerId && uuid.test(customerId)) {
    design = await loadCertDesign({ customerId });
  }
  if (!design) return new Response('Hittades inte', { status: 404 });
  const bytes = await renderCertificatePdf(exampleCertificate(design, validMonths));
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="certifikat-forhandsvisning.pdf"',
      'Cache-Control': 'private, no-store',
    },
  });
}
