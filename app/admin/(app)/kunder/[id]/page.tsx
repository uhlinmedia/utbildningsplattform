import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { getCustomer } from '@/lib/course';
import { createCourse, duplicateCourse, updateCustomer } from '../../../actions';

export const dynamic = 'force-dynamic';

const accessLabel = { name: 'Länk + namn', name_email: 'Länk + namn + e-post' } as const;

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = await getCustomer(id);
  if (!customer) notFound();
  const courses = await sql<
    { id: string; title: string; status: string; access_mode: 'name' | 'name_email'; certificate_enabled: boolean; completed: number; started: number }[]
  >`select c.id, c.title, c.status, c.access_mode, c.certificate_enabled,
      count(e.id)::int as started, count(e.completed_at)::int as completed
    from course c left join enrollment e on e.course_id = c.id
    where c.customer_id = ${id} group by c.id order by c.created_at`;
  const allCourses = await sql<{ id: string; title: string; customer: string }[]>`
    select co.id, co.title, cu.name as customer from course co join customer cu on cu.id = co.customer_id order by cu.name, co.title`;

  return (
    <>
      <div className="stack" style={{ gap: 4 }}>
        <Link href="/admin" className="small">← Kunder</Link>
        <h1>{customer.name}</h1>
      </div>

      <section className="card stack">
        <div className="row between">
          <h2>Utbildningar</h2>
          <form action={createCourse} className="row">
            <input type="hidden" name="customer_id" value={id} />
            <input type="text" name="title" placeholder="Namn på utbildningen" aria-label="Namn på ny utbildning" required style={{ width: 260 }} />
            <button className="btn btn-dark" type="submit">+ Ny utbildning</button>
          </form>
        </div>
        {courses.length === 0 ? (
          <p className="muted">Inga utbildningar än.</p>
        ) : (
          <div className="scroll-x">
            <table className="table" style={{ minWidth: 700 }}>
              <thead>
                <tr><th>Utbildning</th><th>Status</th><th>Åtkomst</th><th>Certifikat</th><th>Startade / klara</th><th>Åtgärder</th></tr>
              </thead>
              <tbody>
                {courses.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.title}</strong></td>
                    <td><span className={`badge ${c.status === 'published' ? 'badge-ok' : ''}`}>{c.status === 'published' ? 'Publicerad' : 'Utkast'}</span></td>
                    <td>{accessLabel[c.access_mode]}</td>
                    <td>{c.certificate_enabled ? 'Ja' : 'Nej'}</td>
                    <td>{c.started} / {c.completed}</td>
                    <td>
                      <div className="row" style={{ gap: 14 }}>
                        <Link href={`/admin/utbildningar/${c.id}`}>Redigera</Link>
                        <Link href={`/admin/utbildningar/${c.id}/statistik`}>Statistik &amp; dela</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {allCourses.length > 0 && (
          <details>
            <summary>Skapa från befintlig utbildning</summary>
            <form action={duplicateCourse} className="row" style={{ marginTop: 12 }}>
              <input type="hidden" name="customer_id" value={id} />
              <select name="id" aria-label="Utbildning att kopiera" style={{ maxWidth: 420 }}>
                {allCourses.map((c) => (
                  <option key={c.id} value={c.id}>{c.customer} – {c.title}</option>
                ))}
              </select>
              <button className="btn" type="submit">Kopiera hit</button>
            </form>
          </details>
        )}
      </section>

      <section className="card">
        <form action={updateCustomer} className="stack" style={{ maxWidth: 560 }}>
          <h2>Kundprofil</h2>
          <input type="hidden" name="id" value={id} />
          <label className="field">Namn<input type="text" name="name" defaultValue={customer.name} required /></label>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field">Profilfärg
              <input type="color" name="color" defaultValue={customer.color} style={{ width: 64, height: 44, padding: 2 }} />
            </label>
            <label className="field" style={{ flex: 1 }}>Logga
              <span className="hint">PNG, JPG eller WebP, högst 5 MB</span>
              <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" />
            </label>
            {customer.logo_media_id && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/media/${customer.logo_media_id}`} alt="Nuvarande logga" style={{ maxHeight: 44 }} />
            )}
          </div>
          <label className="field">Kontaktperson för rapporter<input type="text" name="contact_name" defaultValue={customer.contact_name ?? ''} /></label>
          <label className="field">Kontaktpersonens e-post<input type="email" name="contact_email" defaultValue={customer.contact_email ?? ''} /></label>
          <label className="field">Gallringstid för elevdata
            <span className="hint">Namn, e-post och svar raderas automatiskt efter denna tid. Certifikat-ID och datum behålls för verifiering.</span>
            <select name="retention_months" defaultValue={customer.retention_months}>
              <option value={12}>12 månader</option>
              <option value={24}>24 månader</option>
              <option value={36}>36 månader</option>
            </select>
          </label>
          <div><button className="btn btn-primary" type="submit">Spara kundprofil</button></div>
        </form>
      </section>
    </>
  );
}
