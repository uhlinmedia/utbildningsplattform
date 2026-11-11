import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can, requireCustomerPage } from '@/lib/access';
import { getCustomer } from '@/lib/course';
import { getPerson } from '@/lib/person';
import { sql } from '@/lib/db';
import { appUrl } from '@/lib/mail';
import { CustomerHeader } from '../../CustomerHeader';
import { CopyLink } from '../../../../utbildningar/[id]/statistik/CopyLink';
import { archivePerson, deletePerson, sendPersonLogin, setPersonLink, updatePerson } from '../../../../../person-actions';

export const dynamic = 'force-dynamic';

const fmt = (d: Date | null) => (d ? new Date(d).toLocaleDateString('sv-SE') : '–');
const errors: Record<string, string> = {
  namn: 'Skriv ett namn.',
  epost: 'E-postadressen är inte giltig.',
  epost_finns: 'Det finns redan en person med den e-postadressen.',
  nr_finns: 'Det finns redan en person med det anställningsnumret.',
  skicka: 'Länken kunde inte skickas – personen saknar e-post, har fått många länkar den senaste timmen, eller så är e-post inte inställd ännu (använd då den personliga länken).',
  bekrafta: 'Skriv RADERA för att bekräfta.',
};

export default async function PersonPage({ params, searchParams }: {
  params: Promise<{ id: string; pid: string }>; searchParams: Promise<{ fel?: string; sparad?: string; skickad?: string }>;
}) {
  const { id, pid } = await params;
  const sp = await searchParams;
  const user = await requireCustomerPage(id, 'read');
  const p = await getPerson(pid);
  if (!p || p.customer_id !== id) notFound();
  const customer = (await getCustomer(id))!;
  const canEdit = can(user, id, 'edit');
  const canAdmin = can(user, id, 'admin');
  const history = await sql<{
    id: string; title: string; course_id: string; started_at: Date; completed_at: Date | null; passed: boolean;
    score_percent: number | null; cert_id: string | null; valid_until: Date | null;
  }[]>`
    select e.id, c.title, c.id as course_id, e.started_at, e.completed_at, e.passed, e.score_percent,
      ce.id as cert_id, ce.valid_until
    from learner l join enrollment e on e.learner_id = l.id join course c on c.id = e.course_id
    left join certificate ce on ce.enrollment_id = e.id
    where l.person_id = ${pid} and not e.is_preview order by e.started_at desc`;
  const groups = await sql<{ g: string }[]>`
    select distinct group_name as g from person where customer_id = ${id} and group_name <> '' order by 1`;

  return (
    <>
      <CustomerHeader user={user} customer={customer} active="personer" />
      <div className="stack" style={{ gap: 4 }}>
        <Link href={`/admin/kunder/${id}/personer`} className="small">← Personregistret</Link>
        <h2 style={{ fontSize: 24 }}>{p.name} {p.archived_at && <span className="badge">Arkiverad</span>}</h2>
      </div>
      {sp.fel && <p className="error" role="alert">{errors[sp.fel] ?? 'Något gick fel.'}</p>}
      {sp.sparad && <p className="notice" role="status">Sparat.</p>}
      {sp.skickad && <p className="notice" role="status">Inloggningslänk skickad till {p.email}.</p>}

      <section className="card stack">
        <h2>Utbildningar</h2>
        {history.length === 0 ? <p className="muted" style={{ margin: 0 }}>Har inte påbörjat någon utbildning.</p> : (
          <div className="scroll-x">
            <table className="table" style={{ minWidth: 640 }}>
              <thead><tr><th>Utbildning</th><th>Påbörjad</th><th>Status</th><th>Certifikat</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td><strong>{h.title}</strong></td>
                    <td className="small">{fmt(h.started_at)}</td>
                    <td className="small">
                      {h.passed ? <span className="badge badge-ok">Godkänd {fmt(h.completed_at)}</span>
                        : h.completed_at ? <span className="badge">Ej godkänd</span> : <span className="badge">Pågår</span>}
                      {h.score_percent != null && <span className="muted"> · {h.score_percent} %</span>}
                    </td>
                    <td className="small">
                      {h.cert_id ? <><a href={`/certifikat/${h.cert_id}`}>{h.cert_id}</a>{h.valid_until && <div className="muted">Giltigt t.o.m. {fmt(h.valid_until)}</div>}</> : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card stack">
        <h2>Inloggning för personen</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Används för utbildningar med åtkomst <em>Bara personer i personregistret</em>. Personen loggar in med en engångslänk via
          e-post (skrivs på utbildningens startsida) eller med sin personliga länk, och ser då sina utbildningar och certifikat.
        </p>
        {p.access_key ? (
          <CopyLink link={appUrl(`/p/${p.access_key}`)} label="Personlig länk" />
        ) : <p className="small" style={{ margin: 0 }}>Ingen personlig länk.</p>}
        {canEdit && !p.archived_at && (
          <div className="row" style={{ gap: 8 }}>
            <form action={setPersonLink} data-ingen-varning>
              <input type="hidden" name="person_id" value={p.id} />
              <button className="btn btn-sm" type="submit">{p.access_key ? 'Byt personlig länk' : 'Skapa personlig länk'}</button>
            </form>
            {p.access_key && (
              <form action={setPersonLink} data-ingen-varning>
                <input type="hidden" name="person_id" value={p.id} /><input type="hidden" name="op" value="off" />
                <button className="btn btn-sm btn-danger" type="submit">Stäng av personlig länk</button>
              </form>
            )}
            {p.email && (
              <form action={sendPersonLogin} data-ingen-varning>
                <input type="hidden" name="person_id" value={p.id} />
                <button className="btn btn-sm" type="submit">Skicka inloggningslänk via e-post</button>
              </form>
            )}
          </div>
        )}
        <p className="small muted" style={{ margin: 0 }}>Den personliga länken fungerar tills den byts eller stängs av – behandla den som ett lösenord. Byte loggar ut personen överallt.</p>
      </section>

      {canEdit ? (
        <section className="card">
          <form action={updatePerson} className="stack" style={{ gap: 12, maxWidth: 620 }} data-namn="Personuppgifter">
            <h2>Uppgifter</h2>
            <input type="hidden" name="person_id" value={p.id} />
            <label className="field">Namn<input type="text" name="name" defaultValue={p.name} required maxLength={120} /></label>
            <label className="field">E-post<input type="email" name="email" defaultValue={p.email ?? ''} maxLength={200} /></label>
            <div className="row">
              <label className="field" style={{ flex: '1 1 160px' }}>Anställningsnummer<input type="text" name="employee_no" defaultValue={p.employee_no ?? ''} maxLength={60} /></label>
              <label className="field" style={{ flex: '1 1 160px' }}>Grupp<input type="text" name="group_name" defaultValue={p.group_name} list="grupper" maxLength={80} /></label>
            </div>
            <datalist id="grupper">{groups.map((g) => <option key={g.g} value={g.g} />)}</datalist>
            <div><button className="btn btn-primary" type="submit">Spara</button></div>
          </form>
        </section>
      ) : (
        <section className="card stack">
          <h2>Uppgifter</h2>
          <p style={{ margin: 0 }}>{p.email ?? 'Ingen e-post'} · Anst.nr {p.employee_no ?? '–'} · Grupp {p.group_name || '–'}</p>
        </section>
      )}

      {canEdit && (
        <section className="card stack">
          <h2>Arkivera eller radera</h2>
          <form action={archivePerson} data-ingen-varning>
            <input type="hidden" name="person_id" value={p.id} /><input type="hidden" name="archive" value={p.archived_at ? '0' : '1'} />
            <button className="btn" type="submit">{p.archived_at ? 'Återställ personen' : 'Arkivera (t.ex. slutat)'}</button>
          </form>
          <p className="small muted" style={{ margin: 0 }}>Arkiverade personer kan inte logga in och visas inte i listan, men genomförda utbildningar och certifikat finns kvar.</p>
          {canAdmin && (
            <details>
              <summary className="btn-danger">Radera personen</summary>
              <form action={deletePerson} className="row" style={{ marginTop: 12 }} data-ingen-varning>
                <input type="hidden" name="person_id" value={p.id} />
                <label className="field">Skriv RADERA – personen, svar och framsteg tas bort. Certifikat-ID finns kvar utan namn för verifiering.
                  <input type="text" name="confirm" style={{ maxWidth: 200 }} />
                </label>
                <button className="btn btn-danger" type="submit">Radera</button>
              </form>
            </details>
          )}
        </section>
      )}
    </>
  );
}
