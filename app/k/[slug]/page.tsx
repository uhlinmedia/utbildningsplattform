import { notFound, redirect } from 'next/navigation';
import { getCourseBySlug, getCustomer, getStructure } from '@/lib/course';
import { getEnrollment, resetPreviewProgress } from '@/lib/learner';
import { canReadCustomer } from '@/lib/auth';
import { courseIsOpen } from '@/lib/completion';
import { personLogout, requestCourseLogin, startCourse } from '../actions';
import { sessionPerson } from '@/lib/person';
import { Wordmark } from '../../Wordmark';
import { AudioUnlock } from './kurs/SectionAudio';

export const dynamic = 'force-dynamic';

export default async function StartPage({
  params, searchParams,
}: { params: Promise<{ slug: string }>; searchParams: Promise<{ fel?: string; forhandsvisning?: string; granska?: string; skickad?: string }> }) {
  const { slug } = await params;
  const { fel, forhandsvisning, granska, skickad } = await searchParams;
  const course = await getCourseBySlug(slug);
  if (!course) notFound();
  // Kund med förhandsvisningslänk (?granska=…) eller superadmin från admin (?forhandsvisning=1).
  const review = !!granska && granska === course.preview_token;
  const reviewInvalid = !!granska && !review;
  const adminPreview = forhandsvisning === '1' && (await canReadCustomer(course.customer_id));
  const preview = review || adminPreview;
  const open = courseIsOpen(course);
  const existing = open || preview ? await getEnrollment(course.id) : null;
  if (existing) {
    // Från admin ("Förhandsvisa som elev") börjar förhandsvisningen alltid om från första avsnittet.
    if (adminPreview && existing.is_preview) await resetPreviewProgress(existing.id);
    redirect(`/k/${slug}/kurs`);
  }
  const customer = await getCustomer(course.customer_id);
  const chapters = await getStructure(course.id);
  const register = course.access_mode === 'register' && !preview;
  const person = register ? await sessionPerson() : null;
  const me = person && person.customer_id === course.customer_id ? person : null;

  return (
    <main className="center-page" style={{ ['--brand' as string]: customer?.color }}>
      {course.audio_autoplay && <AudioUnlock />}
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
          {reviewInvalid ? (
            <p className="error" role="alert">Förhandsvisningslänken är inte längre aktiv. Kontakta den som skickade länken.</p>
          ) : !open && !preview ? (
            <p className="error" role="alert">Utbildningen är inte öppen just nu. Kontakta den som skickade länken.</p>
          ) : (
            <>
              {preview && (
                <p className="notice">
                  Förhandsvisning – räknas inte i statistiken.{course.certificate_enabled && ' Certifikatet blir ett testcertifikat.'}
                </p>
              )}
              <div className="row" style={{ gap: 8 }}>
                <span className="chip">{chapters.length} {chapters.length === 1 ? 'kapitel' : 'kapitel'}</span>
                {course.certificate_enabled && <span className="chip">Certifikat</span>}
              </div>
              {course.description && <p style={{ margin: 0 }}>{course.description}</p>}
              {register ? (
                me ? (
                  <div className="stack" style={{ gap: 12 }}>
                    <p style={{ margin: 0 }}>Inloggad som <strong>{me.name}</strong>.</p>
                    <form action={startCourse}>
                      <input type="hidden" name="slug" value={slug} />
                      <button className="btn btn-primary" type="submit" style={{ minHeight: 52, width: '100%' }}>Starta utbildningen</button>
                    </form>
                    <div className="row between small">
                      <a href="/mina">Mina utbildningar</a>
                      <form action={personLogout}>
                        <input type="hidden" name="back" value={`/k/${slug}`} />
                        <button className="btn-link" type="submit">Inte du? Logga ut</button>
                      </form>
                    </div>
                  </div>
                ) : skickad ? (
                  <p className="notice" role="status" style={{ margin: 0 }}>
                    Om adressen finns i registret hos {customer?.name} har vi skickat en inloggningslänk. Öppna mejlet och klicka på länken
                    (gäller i 30 minuter). Kolla skräpposten om det inte kommer.
                  </p>
                ) : (
                  <form action={requestCourseLogin} className="stack" style={{ gap: 14 }}>
                    <input type="hidden" name="slug" value={slug} />
                    {fel && <p className="error" role="alert">Skriv en giltig e-postadress.</p>}
                    <label className="field">Din e-post på jobbet
                      <span className="hint">Vi skickar en inloggningslänk. Du behöver inget lösenord.</span>
                      <input type="email" name="email" autoComplete="email" required placeholder="namn@exempel.se" />
                    </label>
                    <button className="btn btn-primary" type="submit" style={{ minHeight: 52 }}>Skicka inloggningslänk</button>
                    <p className="small muted" style={{ margin: 0 }}>Har du fått en personlig länk kan du använda den i stället.</p>
                  </form>
                )
              ) : (
              <form action={startCourse} className="stack" style={{ gap: 14 }}>
                  <input type="hidden" name="slug" value={slug} />
                  {adminPreview && <input type="hidden" name="preview" value="1" />}
                  {review && <input type="hidden" name="granska" value={granska} />}
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
              )}
              <p className="small muted" style={{ margin: 0 }}>
                {register
                  ? <>Genomförda utbildningar registreras hos {customer?.name}. Uppgifterna hanteras enligt deras rutiner för personuppgifter.</>
                  : <>Dina uppgifter används bara för att registrera genomförd utbildning åt {customer?.name}, och raderas
                automatiskt efter {customer?.retention_months} månader.</>}
              </p>
            </>
          )}
          <div className="powered">Drivs av <Wordmark size={14} /></div>
        </div>
      </div>
    </main>
  );
}
