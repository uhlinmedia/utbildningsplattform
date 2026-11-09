import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { logout } from '../actions';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="admin">
      <nav className="admin-nav" aria-label="Admin">
        <div className="brand">Utbildningsplattform</div>
        <Link href="/admin">Kunder &amp; utbildningar</Link>
        <form action={logout} style={{ marginTop: 'auto' }}>
          <button className="btn-link" style={{ color: '#c9d0d8', padding: '11px 12px' }} type="submit">Logga ut</button>
        </form>
      </nav>
      <main className="admin-main">{children}</main>
    </div>
  );
}
