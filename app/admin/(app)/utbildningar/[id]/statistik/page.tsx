import Link from 'next/link';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { getCourseById, getCustomer } from '@/lib/course';
import { can, requireUser } from '@/lib/access';
import { getCourseStats, learnerStatus } from '@/lib/stats';
import { setReviewLink } from '@/app/admin/actions';
import { CopyLink } from './CopyLink';

export const dynamic = 'force-dynamic';

const fmt = (d: Date | null) => (d ? new Date(d).toLocaleDateString('sv-SE') : '–');

export default async function StatsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const course = /^[0-9a-f-]{36}$/i.test(id) ? await getCourseById(id) : null;
  if (!course || !can(user, course.customer_id, 'read')) notFound();
  const canEdit = can(user, course.customer_id, 'edit');
  const customer = await getCustomer(course.customer_id);
  const { kpi, funnel, questions, learners, sectionCount } = await getCourseStats(id);
  const link = `${process.env.APP_URL ?? ''}/k/${course.slug}`;
  const qr = await QRCode.toDataURL(link, { margin: 1, width: 360 });
  const reviewLink = course.preview_token ? `${link}?granska=${course.preview_token}` : null;
  const max = Math.max(1, kpi.started);

  return (
    <>
      <div className="row between">
        <div className="stack" style={{ gap: 4 }}>
          {canEdit
            ? <Link href={`/admin/utbildningar/${id}`} className="small">← Tillbaka till editorn</Link>
            : <Link href={`/admin/kunder/${course.customer_id}`} className="small">← {customer?.name}</Link>}
          <span className="small muted">{customer?.name} · Statistik</span>
          <h1>{course.title}</h1>
        </div>
        <a className="btn" href={`/admin/utbildningar/${id}/export`}>Exportera till Excel</a>
      </div>

      <div className="kpis">
        <div className="card kpi"><div className="small muted">Startade</div><div className="v">{kpi.started}</div></div>
        <div className="card kpi"><div className="small muted">Slutförda</div><div className="v">{kpi.completed}</div></div>
        <div className="card kpi"><div className="small muted">Godkända</div><div className="v">{kpi.passed}</div></div>
        <div className="card kpi"><div className="small muted">Genomsnittlig tid</div><div className="v">{kpi.avg_minutes ?? '–'}{kpi.avg_minutes != null && <span className="small"> min</span>}</div></div>
      </div>

      <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
        <div className="stack" style={{ flex: '999 1 520px', minWidth: 0 }}>
          <section className="card stack" style={{ gap: 12 }}>
            <h2 style={{ fontSize: 16 }}>Hur långt kommer eleverna? (andel som klarat varje kapitel)</h2>
            {funnel.map((f, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 200px) minmax(0, 1fr) 56px', gap: 12, alignItems: 'center', fontSize: 14 }}>
                <span>{i + 1}. {f.title}</span>
                <div style={{ height: 14, background: 'var(--line)', borderRadius: 3 }}>
                  <div style={{ height: '100%', width: `${(f.learners / max) * 100}%`, background: 'var(--brand)', borderRadius: 3 }} />
                </div>
                <span className="small" style={{ textAlign: 'right' }}>{kpi.started ? Math.round((f.learners / max) * 100) : 0} %</span>
              </div>
            ))}
          </section>

          <section className="card stack" style={{ gap: 6 }}>
            <h2 style={{ fontSize: 16 }}>Kontrollfrågor – andel rätt på första försöket</h2>
            {questions.length === 0 && <p className="muted">Utbildningen har inga kontrollfrågor.</p>}
            {questions.map((q) => (
              <div key={q.id} className="row between" style={{ padding: '10px 0', borderTop: '1px solid #eef1f4', fontSize: 14, flexWrap: 'nowrap' }}>
                <span><span className="muted">{q.section}</span> {q.question || '(fråga utan text)'}</span>
                <strong style={{ whiteSpace: 'nowrap', color: q.percent != null && q.percent < 60 ? 'var(--bad)' : undefined }}>
                  {q.percent == null ? 'Inga svar' : `${q.percent} % (${q.answered})`}
                </strong>
              </div>
            ))}
          </section>

          <section className="card" style={{ padding: 0 }}>
            <h2 style={{ fontSize: 16, padding: '16px 20px' }}>Elever ({learners.length})</h2>
            <div className="scroll-x">
              <table className="table" style={{ minWidth: 640 }}>
                <thead><tr><th>Namn</th><th>E-post</th><th>Status</th><th>Resultat</th><th>Start</th><th>Klar</th><th>Certifikat</th></tr></thead>
                <tbody>
                  {learners.map((l, i) => {
                    const st = learnerStatus(l, sectionCount);
                    return (
                      <tr key={i}>
                        <td>{l.name}</td>
                        <td>{l.email ?? '–'}</td>
                        <td><span className={`badge ${st === 'Godkänd' ? 'badge-ok' : st.startsWith('Pågår') ? 'badge-warn' : ''}`}>{st}</span></td>
                        <td>{l.score_percent != null ? `${l.score_percent} %` : '–'}</td>
                        <td className="nowrap">{fmt(l.started_at)}</td>
                        <td className="nowrap">{fmt(l.completed_at)}</td>
                        <td className="nowrap">{l.certificate_id ? <a href={`/certifikat/${l.certificate_id}`}>{l.certificate_id}</a> : '–'}</td>
                      </tr>
                    );
                  })}
                  {learners.length === 0 && <tr><td colSpan={7} className="muted">Inga elever än.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="card stack" style={{ flex: '1 1 280px' }} aria-label="Dela utbildningen">
          <h2 style={{ fontSize: 16 }}>Dela utbildningen</h2>
          {course.status !== 'published' && (
            <p className="error small" style={{ margin: 0 }}>Utbildningen är inte publicerad – eleverna kan inte starta den än.</p>
          )}
          <CopyLink link={link} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={`QR-kod till ${link}`} width={160} height={160} />
          <a href={qr} download={`qr-${course.slug}.png`} className="small">Ladda ner QR-kod</a>

          <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '8px 0' }} />
          <h2 style={{ fontSize: 16 }}>Förhandsvisning för kund</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Hemlig länk så att kunden kan gå igenom utbildningen innan den publiceras. Fungerar även för utkast,
            räknas inte i statistiken och ger bara testcertifikat.
          </p>
          {!canEdit ? (
            <p className="small muted" style={{ margin: 0 }}>{reviewLink ? 'Förhandsvisningslänk är aktiv.' : 'Ingen förhandsvisningslänk.'}</p>
          ) : reviewLink ? (
            <>
              <CopyLink link={reviewLink} label="Länk till kunden" />
              <div className="row" style={{ gap: 8 }}>
                <form action={setReviewLink}>
                  <input type="hidden" name="id" value={id} />
                  <button className="btn btn-sm" type="submit">Byt länk</button>
                </form>
                <form action={setReviewLink}>
                  <input type="hidden" name="id" value={id} /><input type="hidden" name="action" value="off" />
                  <button className="btn btn-sm btn-danger" type="submit">Stäng av</button>
                </form>
              </div>
              <p className="small muted" style={{ margin: 0 }}>Byt länk eller stäng av när granskningen är klar – den gamla länken slutar då fungera.</p>
            </>
          ) : (
            <form action={setReviewLink}>
              <input type="hidden" name="id" value={id} />
              <button className="btn btn-sm" type="submit">Skapa förhandsvisningslänk</button>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}
