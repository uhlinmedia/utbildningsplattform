import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/access';
import { sql } from '@/lib/db';
import { createCustomer } from '../actions';

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
