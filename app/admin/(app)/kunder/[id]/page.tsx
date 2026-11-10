import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { getCustomer } from '@/lib/course';
import { addCertBadge, createCourse, duplicateCourse, updateCertBadge, updateCustomer, updateCustomerCert } from '../../../actions';
import type { CertBadge } from '@/lib/types';

export const dynamic = 'force-dynamic';

const accessLabel = { name: 'Länk + namn', name_email: 'Länk + namn + e-post' } as const;

const templates = [
  { value: 'klassisk', label: 'Klassisk', hint: 'Ram med guillochémönster, serifftypsnitt och centrerad text – traditionellt diplom' },
  { value: 'modern', label: 'Modern', hint: 'Fritt placerad logga, kraftig sans-serif och färgade bågar och kantlist i kundens färger' },
  { value: 'minimal', label: 'Minimal', hint: 'Tunn ram, mycket luft och vänsterställd text' },
] as const;

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
  const badges = await sql<CertBadge[]>`
    select id, media_id, label, position from cert_badge where customer_id = ${id} order by position, created_at`;
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


      <section className="card stack" id="certifikat">
        <div className="stack" style={{ gap: 4 }}>
          <h2>Certifikatets utseende</h2>
          <p className="muted small" style={{ margin: 0 }}>Gäller alla kundens utbildningar. Texter och underskrifter ställs in per utbildning under Inställningar.</p>
        </div>
        <div className="cert-settings">
          <div className="stack">
            <form action={updateCustomerCert} className="stack">
              <input type="hidden" name="id" value={id} />
              <fieldset className="stack" style={{ gap: 8 }}>
                <legend className="field-legend">Mall</legend>
                {templates.map((t) => (
                  <label key={t.value} className="choice">
                    <input type="radio" name="cert_template" value={t.value} defaultChecked={customer.cert_template === t.value} />
                    <span><strong>{t.label}</strong><span className="hint">{t.hint}</span></span>
                  </label>
                ))}
              </fieldset>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <label className="field">Dekorfärg
                  <span className="hint">Ram, sigill och linjer</span>
                  <input type="color" name="cert_accent" defaultValue={customer.cert_accent} style={{ width: 64, height: 44, padding: 2 }} />
                </label>
                <label className="field">Loggans storlek
                  <select name="cert_logo_size" defaultValue={customer.cert_logo_size} style={{ width: 160 }}>
                    <option value="S">Liten</option>
                    <option value="M">Mellan</option>
                    <option value="L">Stor</option>
                  </select>
                </label>
              </div>
              <p className="hint small" style={{ margin: 0 }}>Profilfärgen och loggan hämtas från kundprofilen nedan.</p>
              <label className="check"><input type="checkbox" name="cert_seal" defaultChecked={customer.cert_seal} />Visa sigill med kundens namn och årtal</label>
              <label className="check"><input type="checkbox" name="cert_show_briondo" defaultChecked={customer.cert_show_briondo} />Visa &quot;Utfärdat via Briondo&quot;</label>
              <div><button className="btn btn-primary" type="submit">Spara utseende</button></div>
            </form>

            <div className="stack" style={{ gap: 10 }}>
              <h3>Märken och extra grafik</h3>
              <p className="muted small" style={{ margin: 0 }}>T.ex. ISO-certifieringar, branschmärken eller partnerloggor. Visas i den ordning de står här, högst sex stycken. Varje utbildning kan välja bort enskilda märken.</p>
              {badges.length > 0 && (
                <ul className="badge-list">
                  {badges.map((b, i) => (
                    <li key={b.id}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/media/${b.media_id}`} alt={b.label || 'Märke'} />
                      <form action={updateCertBadge} className="row" style={{ gap: 6, flex: 1, flexWrap: 'nowrap', minWidth: 200 }}>
                        <input type="hidden" name="id" value={b.id} />
                        <input type="hidden" name="op" value="save" />
                        <input type="text" name="label" defaultValue={b.label} aria-label="Beskrivning av märket" placeholder="Beskrivning" />
                        <button className="btn btn-sm" type="submit">Spara</button>
                      </form>
                      <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                        {([['up', '↑', 'Flytta märket uppåt', i === 0], ['down', '↓', 'Flytta märket nedåt', i === badges.length - 1]] as const).map(([op, sym, lbl, dis]) => (
                          <form key={op} action={updateCertBadge} className="inline-form">
                            <input type="hidden" name="id" value={b.id} />
                            <input type="hidden" name="op" value={op} />
                            <button className="btn btn-sm" type="submit" disabled={dis} aria-label={lbl}>{sym}</button>
                          </form>
                        ))}
                        <form action={updateCertBadge} className="inline-form">
                          <input type="hidden" name="id" value={b.id} />
                          <input type="hidden" name="op" value="delete" />
                          <button className="btn btn-sm btn-danger" type="submit" aria-label={`Ta bort ${b.label || 'märket'}`}>Ta bort</button>
                        </form>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <form action={addCertBadge} className="row" style={{ alignItems: 'flex-end' }}>
                <input type="hidden" name="customer_id" value={id} />
                <label className="field" style={{ flex: '1 1 200px' }}>Fil
                  <span className="hint">SVG eller PNG med transparent bakgrund blir bäst</span>
                  <input type="file" name="badge" accept="image/svg+xml,image/png,image/jpeg,image/webp" required />
                </label>
                <label className="field" style={{ flex: '1 1 160px' }}>Beskrivning
                  <input type="text" name="label" placeholder="T.ex. ISO 9001" />
                </label>
                <button className="btn" type="submit">+ Lägg till märke</button>
              </form>
            </div>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <div className="row between">
              <strong className="small">Förhandsvisning med exempeltexter</strong>
              <a className="small" href={`/admin/certifikat?kund=${id}`} target="_blank" rel="noreferrer">Öppna som PDF</a>
            </div>
            <iframe className="cert-preview" src={`/admin/certifikat?kund=${id}&v=${Date.now()}#view=Fit&toolbar=0&navpanes=0`} title="Förhandsvisning av certifikat" />
          </div>
        </div>
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
              <span className="hint">SVG, PNG, JPG eller WebP, högst 5 MB. Används i utbildningen och på certifikatet.</span>
              <input type="file" name="logo" accept="image/svg+xml,image/png,image/jpeg,image/webp" />
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
