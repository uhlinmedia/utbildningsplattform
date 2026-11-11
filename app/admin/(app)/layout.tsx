import Link from 'next/link';
import { requireUser, roleLabel } from '@/lib/access';
import { sql } from '@/lib/db';
import { logout } from '../auth-actions';
import { Wordmark } from '../../Wordmark';
import { UnsavedGuard } from '../UnsavedGuard';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [customer] = user.customer_id
    ? await sql<{ name: string }[]>`select name from customer where id = ${user.customer_id}`
    : [];
  const c = user.customer_id ? `/admin/kunder/${user.customer_id}` : null;
  return (
    <div className="admin">
      <nav className="admin-nav" aria-label="Admin">
        <Link href={c ?? '/admin'} className="brand"><Wordmark size={26} dark /></Link>
        {c ? (
          <>
            <span className="nav-customer">{customer?.name}</span>
            <Link href={c}>Utbildningar</Link>
            <Link href={`${c}/personer`}>Personregister</Link>
            {user.role === 'kundadmin' && <Link href={`${c}/anvandare`}>Användare</Link>}
            {user.role === 'kundadmin' && <Link href={`${c}/logg`}>Ändringslogg</Link>}
          </>
        ) : (
          <>
            <Link href="/admin">Kunder &amp; utbildningar</Link>
            <Link href="/admin/anvandare">Briondo-användare</Link>
          </>
        )}
        <div className="nav-user">
          <Link href="/admin/konto" className="nav-user-name">
            <span>{user.name || user.email}</span>
            <span className="small">{roleLabel[user.role]}</span>
          </Link>
          <form action={logout}>
            <button className="btn-link" style={{ color: '#c9d0d8', padding: '8px 12px' }} type="submit">Logga ut</button>
          </form>
        </div>
      </nav>
      <main className="admin-main">{children}</main>
      <UnsavedGuard />
    </div>
  );
}
