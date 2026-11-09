import { notFound, redirect } from 'next/navigation';
import { getCourseBySlug, getCustomer, getStructure } from '@/lib/course';
import { getEnrollment } from '@/lib/learner';
import { isAdmin } from '@/lib/auth';
import { courseIsOpen } from '@/lib/completion';
import { startCourse } from '../actions';

export const dynamic = 'force-dynamic';

export default async function StartPage({
  params, searchParams,
}: { params: Promise<{ slug: string }>; searchParams: Promise<{ fel?: string; forhandsvisning?: string }> }) {
  const { slug } = await params;
  const { fel, forhandsvisning } = await searchParams;
  const course = await getCourseBySlug(slug);
  if (!course) notFound();
  const preview = forhandsvisning === '1' && (await isAdmin());
  const open = courseIsOpen(course);
  if ((open || preview) && (await getEnrollment(course.id))) redirect(`/k/${slug}/kurs`);
  const customer = await getCustomer(course.customer_id);
  const chapters = await getStructure(course.id);

  return (
    <main className="center-page" style={{ ['--brand' as string]: customer?.color }}>
      <div className="start-card">
        <div className="start-hero">
          {customer?.logo_media_id && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/media/${customer.logo_media_id}`} alt={customer.name} />
          )}
          <div>
            <div className="small" style={{ opacity: 0.85 }}>Välkommen till utbildningen</div>
            <h1 style={{ marginTop: 4 }}>{course.title}</h1>
          </div>
        </div>
        <div className="start-body">
          {!open && !preview ? (
            <p className="error" role="alert">Utbildningen är inte öppen just nu. Kontakta den som skickade länken.</p>
          ) : (
            <>
              {preview && <p className="notice">Förhandsvisning – räknas inte i statistiken.</p>}
              <div className="row" style={{ gap: 8 }}>
                <span className="chip">{chapters.length} {chapters.length === 1 ? 'kapitel' : 'kapitel'}</span>
                {course.certificate_enabled && <span className="chip">Certifikat</span>}
              </div>
              {course.description && <p style={{ margin: 0 }}>{course.description}</p>}
              <form action={startCourse} className="stack" style={{ gap: 14 }}>
                <input type="hidden" name="slug" value={slug} />
                {preview && <input type="hidden" name="preview" value="1" />}
                {fel && (
                  <p className="error" role="alert">
                    {fel === 'epost' ? 'Skriv en giltig e-postadress.' : 'Skriv ditt namn.'}
                  </p>
                )}
                <label className="field">Ditt namn
                  <input type="text" name="name" autoComplete="name" required maxLength={120} placeholder="För- och efternamn" />
                </label>
                {course.access_mode === 'name_email' && (
                  <label className="field">E-post
                    <span className="hint">Används för ditt certifikat.</span>
                    <input type="email" name="email" autoComplete="email" required placeholder="namn@exempel.se" />
                  </label>
                )}
                <button className="btn btn-primary" type="submit" style={{ minHeight: 52 }}>Starta utbildningen</button>
              </form>
              <p className="small muted" style={{ margin: 0 }}>
                Dina uppgifter används bara för att registrera genomförd utbildning åt {customer?.name}, och raderas
                automatiskt efter {customer?.retention_months} månader.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
