import Link from 'next/link';
import { redirect } from 'next/navigation';
import { sessionUser } from '@/lib/access';
import { login } from '../auth-actions';
import { Wordmark } from '../../Wordmark';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ fel?: string; nytt?: string }> }) {
  const { fel, nytt } = await searchParams;
  const u = await sessionUser();
  if (u) redirect(u.role === 'superadmin' ? '/admin' : `/admin/kunder/${u.customer_id}`);
  return (
    <main className="center-page">
      <form action={login} className="card stack auth-card">
        <Wordmark size={34} />
        <h1 style={{ fontSize: 20 }}>Logga in</h1>
        {fel === 'last' && <p className="error" role="alert">För många felaktiga försök. Kontot är spärrat i 15 minuter.</p>}
        {fel === '1' && <p className="error" role="alert">Fel e-post eller lösenord.</p>}
        {nytt && <p className="notice" role="status">Lösenordet är bytt. Logga in med det nya lösenordet.</p>}
        <label className="field">E-post<input type="email" name="email" autoComplete="username" required /></label>
        <label className="field">Lösenord<input type="password" name="password" autoComplete="current-password" required /></label>
        <button className="btn btn-primary" type="submit">Logga in</button>
        <Link href="/admin/losenord" className="small">Glömt lösenordet?</Link>
      </form>
    </main>
  );
}
