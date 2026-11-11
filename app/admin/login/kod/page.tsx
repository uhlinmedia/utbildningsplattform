import Link from 'next/link';
import { redirect } from 'next/navigation';
import { pendingUser } from '@/lib/users';
import { verifyCode } from '../../auth-actions';
import { Wordmark } from '../../../Wordmark';

export const dynamic = 'force-dynamic';

export default async function CodePage({ searchParams }: { searchParams: Promise<{ fel?: string }> }) {
  const { fel } = await searchParams;
  if (!(await pendingUser('mfa'))) redirect('/admin/login');
  return (
    <main className="center-page">
      <form action={verifyCode} className="card stack auth-card">
        <Wordmark size={34} />
        <h1 style={{ fontSize: 20 }}>Tvåstegsverifiering</h1>
        <p style={{ margin: 0 }}>Skriv koden från din autentiseringsapp.</p>
        {fel && <p className="error" role="alert">Koden stämmer inte. Prova igen med nästa kod.</p>}
        <label className="field">Kod (6 siffror)
          <input className="code-input" type="text" name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus maxLength={14} />
        </label>
        <button className="btn btn-primary" type="submit">Fortsätt</button>
        <details className="small">
          <summary>Har du inte telefonen?</summary>
          <p className="muted">Skriv en av dina reservkoder (t.ex. 7K3M-QX9P) i fältet ovan. Varje reservkod fungerar en gång.
            Har du inga reservkoder kvar, be en kundadmin eller Briondo att nollställa din tvåstegsverifiering.</p>
        </details>
        <Link href="/admin/login" className="small">← Tillbaka</Link>
      </form>
    </main>
  );
}
