import Link from 'next/link';
import { can, requireCustomerPage } from '@/lib/access';
import { getCustomer } from '@/lib/course';
import { sql } from '@/lib/db';
import { CustomerHeader } from '../CustomerHeader';
import { createPerson } from '../../../../person-actions';
import { ImportForm } from './ImportForm';

export const dynamic = 'force-dynamic';

const errors: Record<string, string> = {
  namn: 'Skriv ett namn.',
  epost: 'E-postadressen är inte giltig.',
  epost_finns: 'Det finns redan en person med den e-postadressen.',
  nr_finns: 'Det finns redan en person med det anställningsnumret.',
};

type Row = {
  id: string; name: string; email: string | null; employee_no: string | null; group_name: string;
  archived_at: Date | null; has_link: boolean; done: number; started: number;
};

export default async function PersonsPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; grupp?: string; arkiv?: string; fel?: string; tillagd?: string; raderad?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireCustomerPage(id, 'read');
  const customer = (await getCustomer(id))!;
  const canEdit = can(user, id, 'edit');
  const q = (sp.q ?? '').trim();
  const like = `%${q.toLowerCase()}%`;
  const groups = await sql<{ g: string; n: number }[]>`
    select group_name as g, count(*)::int as n from person where customer_id = ${id} and archived_at is null and group_name <> ''
    group by group_name order by group_name`;
  const rows = await sql<Row[]>`
    select p.id, p.name, p.email, p.employee_no, p.group_name, p.archived_at, p.access_key is not null as has_link,
      count(e.id) filter (where e.passed and not e.is_preview)::int as done,
      count(e.id) filter (where not e.is_preview)::int as started
    from person p
    left join learner l on l.person_id = p.id
    left join enrollment e on e.learner_id = l.id
    where p.customer_id = ${id}
      and ${sp.arkiv === '1' ? sql`p.archived_at is not null` : sql`p.archived_at is null`}
      and (${q} = '' or lower(p.name) like ${like} or lower(coalesce(p.email, '')) like ${like} or lower(coalesce(p.employee_no, '')) like ${like})
      and (${sp.grupp ?? ''} = '' or p.group_name = ${sp.grupp ?? ''})
    group by p.id order by p.name limit 1000`;
  const [{ total }] = await sql<{ total: number }[]>`select count(*)::int as total from person where customer_id = ${id} and archived_at is null`;
  const base = `/admin/kunder/${id}/personer`;

  return (
    <>
      <CustomerHeader user={user} customer={customer} active="personer" />
      {sp.fel && <p className="error" role="alert">{errors[sp.fel] ?? 'Något gick fel.'}</p>}
      {sp.tillagd && <p className="notice" role="status">{sp.tillagd} är tillagd.</p>}
      {sp.raderad && <p className="notice" role="status">Personen är raderad.</p>}

      <section className="card stack">
        <div className="row between">
          <h2>Personer ({total})</h2>
          <a className="btn btn-sm" href={`${base}/export`}>Exportera till Excel</a>
        </div>
        <form className="row" method="get" style={{ alignItems: 'flex-end' }} data-ingen-varning>
          <label className="field" style={{ flex: '1 1 240px' }}>Sök
            <input type="search" name="q" defaultValue={q} placeholder="Namn, e-post eller anställningsnummer" />
          </label>
          {groups.length > 0 && (
            <label className="field" style={{ flex: '0 1 200px' }}>Grupp
              <select name="grupp" defaultValue={sp.grupp ?? ''}>
                <option value="">Alla grupper</option>
                {groups.map((g) => <option key={g.g} value={g.g}>{g.g} ({g.n})</option>)}
              </select>
            </label>
          )}
          {sp.arkiv === '1' && <input type="hidden" name="arkiv" value="1" />}
          <button className="btn" type="submit">Visa</button>
          <Link className="small" href={sp.arkiv === '1' ? base : `${base}?arkiv=1`}>{sp.arkiv === '1' ? 'Visa aktiva' : 'Visa arkiverade'}</Link>
        </form>
        {rows.length === 0 ? (
          <p className="muted">{total === 0 && !q ? 'Registret är tomt. Lägg till personer nedan eller importera från Excel.' : 'Inga personer matchar.'}</p>
        ) : (
          <div className="scroll-x">
            <table className="table" style={{ minWidth: 680 }}>
              <thead><tr><th>Namn</th><th>Anst.nr</th><th>Grupp</th><th>Utbildningar</th><th>Personlig länk</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`${base}/${p.id}`}><strong>{p.name}</strong></Link><div className="small muted">{p.email ?? 'ingen e-post'}</div></td>
                    <td className="small">{p.employee_no ?? '–'}</td>
                    <td className="small">{p.group_name || '–'}</td>
                    <td className="small">{p.done} godkända{p.started > p.done ? ` · ${p.started - p.done} pågående` : ''}</td>
                    <td className="small">{p.has_link ? 'Ja' : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canEdit && (
        <>
          <section className="card stack">
            <h2>Lägg till person</h2>
            <form action={createPerson} className="stack" style={{ gap: 12 }} data-namn="Ny person">
              <input type="hidden" name="customer_id" value={id} />
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <label className="field" style={{ flex: '2 1 220px' }}>Namn<input type="text" name="name" required maxLength={120} /></label>
                <label className="field" style={{ flex: '2 1 220px' }}>E-post<input type="email" name="email" maxLength={200} /></label>
                <label className="field" style={{ flex: '1 1 140px' }}>Anställningsnummer<input type="text" name="employee_no" maxLength={60} /></label>
                <label className="field" style={{ flex: '1 1 160px' }}>Grupp
                  <input type="text" name="group_name" list="grupper" maxLength={80} placeholder="T.ex. Ramp" />
                </label>
              </div>
              <datalist id="grupper">{groups.map((g) => <option key={g.g} value={g.g} />)}</datalist>
              <div><button className="btn btn-primary" type="submit">Lägg till</button></div>
            </form>
          </section>
          <section className="card stack">
            <h2>Importera från Excel eller CSV</h2>
            <ImportForm customerId={id} />
          </section>
        </>
      )}
    </>
  );
}
