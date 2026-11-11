import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCourseBySlug, getCustomer, getStructure } from '@/lib/course';
import { getEnrollment } from '@/lib/learner';
import { finalize } from '@/lib/completion';
import { retryCourse } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function DonePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const course = await getCourseBySlug(slug);
  if (!course) notFound();
  const enrollment = await getEnrollment(course.id);
  if (!enrollment) redirect(`/k/${slug}`);
  const customer = await getCustomer(course.customer_id);
  const { progress, certificateId } = await finalize(course.id, enrollment.id);
  if (!progress.allComplete) redirect(`/k/${slug}/kurs`);
  const firstSection = (await getStructure(course.id))[0]?.sections[0]?.id ?? '';

  return (
    <main className="center-page" style={{ ['--brand' as string]: customer?.color }}>
      <div className="card stack" style={{ maxWidth: 520, width: '100%', textAlign: 'center', alignItems: 'center' }}>
        {progress.passed ? (
          <>
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#1F7A3D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M8 12.5l2.8 2.8L16 10" /></svg>
            <h1>Bra jobbat, {enrollment.name}!</h1>
            <p style={{ margin: 0 }}>Du har genomfört och blivit godkänd i <strong>{course.title}</strong>.</p>
            <p className="muted" style={{ margin: 0 }}>Resultat: {progress.scorePercent} % rätt (gräns {course.pass_percent} %)</p>
            {certificateId && (
              <a className="btn btn-primary" href={`/certifikat/${certificateId}`} style={{ minHeight: 52 }}>
                {enrollment.is_preview ? 'Ladda ner testcertifikat (PDF)' : 'Ladda ner certifikat (PDF)'}
              </a>
            )}
            {certificateId && <p className="small muted" style={{ margin: 0 }}>Certifikat-ID: {certificateId}</p>}
          </>
        ) : (
          <>
            <h1>Du är nästan där</h1>
            <p style={{ margin: 0 }}>
              Du fick {progress.scorePercent} % rätt. För att bli godkänd behövs {course.pass_percent} %.
            </p>
            <form action={retryCourse}>
              <input type="hidden" name="slug" value={slug} />
              <button className="btn btn-primary" type="submit">Gör om utbildningen</button>
            </form>
          </>
        )}
        <Link href={`/k/${slug}/kurs?s=${firstSection}`} className="small">Tillbaka till innehållet</Link>
        {course.access_mode === 'register' && !enrollment.is_preview && <Link href="/mina" className="small">Till Mina utbildningar</Link>}
      </div>
    </main>
  );
}
