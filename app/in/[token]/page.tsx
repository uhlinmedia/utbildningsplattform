import { redirect } from 'next/navigation';
import { redeemLoginToken, setPersonCookie } from '@/lib/person';
import { Wordmark } from '../../Wordmark';

export const dynamic = 'force-dynamic';

// Inloggningslänken löses in först när personen trycker på knappen. Många e-postsystem (t.ex. Outlook)
// öppnar länkar automatiskt för att söka efter skadlig kod – då ska engångslänken inte förbrukas.
async function redeem(fd: FormData) {
  'use server';
  const r = await redeemLoginToken(String(fd.get('token') ?? ''));
  if (!r) redirect(`/in/ogiltig`);
  await setPersonCookie(r.person);
  redirect(r.next);
}

export default async function LoginLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invalid = token === 'ogiltig';
  return (
    <main className="center-page">
      <div className="card stack auth-card">
        <Wordmark size={30} />
        {invalid ? (
          <>
            <h1 style={{ fontSize: 20 }}>Länken fungerar inte längre</h1>
            <p style={{ margin: 0 }}>Inloggningslänken har redan använts eller gått ut (den gäller i 30 minuter). Gå till utbildningens
              startsida och be om en ny länk.</p>
          </>
        ) : (
          <form action={redeem} className="stack">
            <input type="hidden" name="token" value={token} />
            <h1 style={{ fontSize: 20 }}>Logga in</h1>
            <p style={{ margin: 0 }}>Tryck på knappen för att logga in och komma till din utbildning.</p>
            <button className="btn btn-primary" type="submit" style={{ minHeight: 52 }} autoFocus>Logga in</button>
          </form>
        )}
      </div>
    </main>
  );
}
