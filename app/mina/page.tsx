import Link from 'next/link';
import { sql } from '@/lib/db';
import { sessionPerson } from '@/lib/person';
import { getCustomer } from '@/lib/course';
import { personLogout } from '../k/actions';
import { Wordmark } from '../Wordmark';

export const dynamic = 'force-dynamic';

const fmt = (d: Date | null) => (d ? new Date(d).toLocaleDateString('sv-SE') : '');

// Elevens egen sida: utbildningar hos kunden och egna certifikat.
export default async function MyCoursesPage({ searchParams }: { searchParams: Promise<{ ogiltig?: string }> }) {
  const { ogiltig } = await searchParams;
  const p = await sessionPerson();
  if (!p) {
    return (
      <main className="center-page">
        <div className="card stack auth-card">
          <Wordmark size={30} />
          <h1 style={{ fontSize: 20 }}>Mina utbildningar</h1>
          <p style={{ margin: 0 }}>
            {ogiltig ? 'Den personliga länken fungerar inte längre. ' : ''}
            Logga in via länken du fått från din arbetsgivare, eller öppna utbildningens länk och be om en inloggningslänk via e-post.
          </p>
        </div>
      </main>
    );
  }
  const customer = await getCustomer(p.customer_id);
  const courses = await sql<{
    id: string; slug: string; title: string; description: string; status: string;
    started_at: Date | null; completed_at: Date | null; passed: boolean | null; cert_id: string | null; valid_until: Date | null;
  }[]>`
    select c.id, c.slug, c.title, c.description, c.status, e.started_at, e.completed_at, e.passed, ce.id as cert_id, ce.valid_until
    from course c
    left join lateral (
      select e.* from enrollment e join learner l on l.id = e.learner_id
      where l.person_id = ${p.id} and e.course_id = c.id and not e.is_preview order by e.started_at desc limit 1
    ) e on true
    left join certificate ce on ce.enrollment_id = e.id
    where c.customer_id = ${p.customer_id}
      and ((c.status = 'published' and c.access_mode = 'register' and (c.closes_at is null or c.closes_at >= current_date)) or e.id is not null)
    order by (e.passed is true), c.title`;
  return (
    <main className="mina" style={{ ['--brand' as string]: customer?.color }}>
      <header className="mina-head">
        {customer?.logo_media_id
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={`/media/${customer.logo_media_id}`} alt={customer.name} />
          : <strong>{customer?.name}</strong>}
        <form action={personLogout}><button className="btn btn-sm" type="submit">Logga ut</button></form>
      </header>
      <div className="mina-body stack">
        <div className="stack" style={{ gap: 4 }}>
          <span className="small muted">Inloggad som {p.name}</span>
          <h1>Mina utbildningar</h1>
        </div>
        {courses.length === 0 && <p className="muted">Inga utbildningar är tillgängliga just nu.</p>}
        <ul className="mina-list">
          {courses.map((c) => (
            <li key={c.id} className="card stack" style={{ gap: 8 }}>
              <div className="row between" style={{ alignItems: 'flex-start' }}>
                <h2 style={{ fontSize: 18, margin: 0 }}>{c.title}</h2>
                {c.passed ? <span className="badge badge-ok">Godkänd {fmt(c.completed_at)}</span>
                  : c.started_at ? <span className="badge">Påbörjad</span> : <span className="badge">Ej påbörjad</span>}
              </div>
              {c.description && <p className="small muted" style={{ margin: 0 }}>{c.description}</p>}
              <div className="row" style={{ gap: 10 }}>
                {c.status === 'published' && (
                  <Link className={`btn btn-sm ${c.passed ? '' : 'btn-primary'}`} href={`/k/${c.slug}`}>
                    {c.passed ? 'Öppna igen' : c.started_at ? 'Fortsätt' : 'Starta'}
                  </Link>
                )}
                {c.cert_id && (
                  <a className="btn btn-sm" href={`/certifikat/${c.cert_id}`}>
                    Certifikat (PDF){c.valid_until ? ` – giltigt t.o.m. ${fmt(c.valid_until)}` : ''}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="powered">Drivs av <Wordmark size={14} /></div>
      </div>
    </main>
  );
}
