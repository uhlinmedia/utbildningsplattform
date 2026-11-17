import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/access';
import { sql } from '@/lib/db';
import { createCustomer } from '../actions';
import { sectionsWithMissingImages } from '@/lib/media-check';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const user = await requireUser();
  if (user.role !== 'superadmin') redirect(`/admin/kunder/${user.customer_id}`);
  const customers = await sql<{ id: string; name: string; color: string; courses: number; published: number }[]>`
    select c.id, c.name, c.color,
      count(co.id)::int as courses,
      count(co.id) filter (where co.status = 'published')::int as published
    from customer c left join course co on co.customer_id = c.id
    group by c.id order by c.name`;
  const missing = await sectionsWithMissingImages();
  const missingTotal = missing.reduce((n, r) => n + r.n, 0);
  return (
    <>
      <div className="row between">
        <h1>Kunder</h1>
        <form action={createCustomer} className="row" data-namn="Ny kund">
          <label className="sr-only" htmlFor="newcust">Kundens namn</label>
          <input id="newcust" type="text" name="name" placeholder="Namn på ny kund" required style={{ width: 240 }} />
          <button className="btn btn-primary" type="submit">+ Ny kund</button>
        </form>
      </div>
      {missing.length > 0 && (
        <section className="card media-missing-card" role="alert">
          <h2 style={{ marginBottom: 6 }}>{missingTotal === 1 ? '1 bild saknas' : `${missingTotal} bilder saknas`} i utbildningarna</h2>
          <p className="small" style={{ marginTop: 0 }}>
            Bilderna nedan har försvunnit och visas inte för eleverna. Öppna avsnittet och använd <strong>Byt bild</strong> på de markerade
            bilderna (beskrivning och tidsmarkering behålls). Listan försvinner när alla bilder är på plats.
          </p>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {missing.map((r) => (
              <li key={r.section_id}>
                {r.customer} · {r.course} ·{' '}
                <Link href={`/admin/utbildningar/${r.course_id}?s=${r.section_id}`}>{r.chapter_no}.{r.section_no} {r.section}</Link>
                {' '}({r.n} {r.n === 1 ? 'bild' : 'bilder'})
              </li>
            ))}
          </ul>
        </section>
      )}
      {customers.length === 0 ? (
        <div className="card muted">Inga kunder än. Skapa din första kund ovan.</div>
      ) : (
        <div className="grid-cards">
          {customers.map((c) => (
            <Link key={c.id} href={`/admin/kunder/${c.id}`} className="cust-card">
              <span className="swatch" style={{ background: c.color }} aria-hidden="true" />
              <strong>{c.name}</strong>
              <span className="small muted">
                {c.courses} {c.courses === 1 ? 'utbildning' : 'utbildningar'} · {c.published} publicerade
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
