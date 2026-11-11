import { cookies } from 'next/headers';
import { sql } from '@/lib/db';
import { canReadCustomer } from '@/lib/auth';
import { getCourseById } from '@/lib/course';
import { enrollmentCookie } from '@/lib/learner';
import { sessionPerson } from '@/lib/person';
import { getCertificate, renderCertificatePdf } from '@/lib/certificate';

// Certifikatet kan laddas ner av eleven själv (samma webbläsare) eller av superadmin.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cert = await getCertificate(id);
  if (!cert) return new Response('Hittades inte', { status: 404 });
  let allowed = await canReadCustomer((await getCourseById(cert.course_id))?.customer_id);
  if (!allowed && cert.enrollment_id) {
    const token = (await cookies()).get(enrollmentCookie(cert.course_id))?.value;
    if (token) {
      const [e] = await sql`select 1 from enrollment where id = ${cert.enrollment_id} and token = ${token}`;
      allowed = !!e;
    }
  }
  if (!allowed && cert.enrollment_id) {
    const person = await sessionPerson();
    if (person) {
      const [e] = await sql`select 1 from enrollment e join learner l on l.id = e.learner_id
        where e.id = ${cert.enrollment_id} and l.person_id = ${person.id}`;
      allowed = !!e;
    }
  }
  if (!allowed) return new Response('Ingen behörighet', { status: 403 });
  const bytes = await renderCertificatePdf(cert.data);
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="certifikat-${cert.id}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
