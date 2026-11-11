import { lookupUserToken } from '@/lib/users';
import { Wordmark } from '../../../Wordmark';
import { PasswordForm } from '../../PasswordForm';
import { acceptInvite } from '../../auth-actions';

export const dynamic = 'force-dynamic';

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await lookupUserToken(token, 'invite');
  return (
    <main className="center-page">
      <div className="card stack auth-card">
        <Wordmark size={34} />
        {!t ? (
          <>
            <h1 style={{ fontSize: 20 }}>Inbjudan är inte giltig</h1>
            <p style={{ margin: 0 }}>Länken har redan använts eller gått ut (den gäller i 7 dagar). Be den som bjöd in dig att skicka en ny.</p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 20 }}>Välkommen till Briondo</h1>
            <p style={{ margin: 0 }}>
              Du är inbjuden {t.customer ? <>till <strong>{t.customer}</strong> </> : ''}som <strong>{t.email}</strong>.
              Välj ett lösenord – sedan aktiverar du tvåstegsverifiering.
            </p>
            <PasswordForm action={acceptInvite} token={token} withName defaultName={t.name} submit="Skapa konto" />
          </>
        )}
      </div>
    </main>
  );
}
