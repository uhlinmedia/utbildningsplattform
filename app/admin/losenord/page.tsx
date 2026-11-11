import Link from 'next/link';
import { requestReset } from '../auth-actions';
import { Wordmark } from '../../Wordmark';

export const dynamic = 'force-dynamic';

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ skickat?: string }> }) {
  const { skickat } = await searchParams;
  return (
    <main className="center-page">
      <div className="card stack auth-card">
        <Wordmark size={34} />
        <h1 style={{ fontSize: 20 }}>Glömt lösenordet</h1>
        {skickat ? (
          <p className="notice" role="status">Om adressen har ett konto hos Briondo har vi skickat en länk för att välja nytt lösenord. Länken gäller i en timme.</p>
        ) : (
          <form action={requestReset} className="stack" style={{ gap: 12 }}>
            <p style={{ margin: 0 }}>Skriv din e-postadress så skickar vi en länk där du kan välja ett nytt lösenord.</p>
            <label className="field">E-post<input type="email" name="email" autoComplete="username" required /></label>
            <button className="btn btn-primary" type="submit">Skicka länk</button>
          </form>
        )}
        <Link href="/admin/login" className="small">← Till inloggningen</Link>
      </div>
    </main>
  );
}
