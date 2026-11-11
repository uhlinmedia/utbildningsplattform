import Link from 'next/link';
import { lookupUserToken } from '@/lib/users';
import { Wordmark } from '../../../Wordmark';
import { PasswordForm } from '../../PasswordForm';
import { resetPassword } from '../../auth-actions';

export const dynamic = 'force-dynamic';

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await lookupUserToken(token, 'reset');
  return (
    <main className="center-page">
      <div className="card stack auth-card">
        <Wordmark size={34} />
        <h1 style={{ fontSize: 20 }}>Välj nytt lösenord</h1>
        {!t ? (
          <p style={{ margin: 0 }}>Länken har redan använts eller gått ut. <Link href="/admin/losenord">Be om en ny länk</Link>.</p>
        ) : (
          <>
            <p className="small muted" style={{ margin: 0 }}>Konto: {t.email}. Du loggas ut på alla enheter.</p>
            <PasswordForm action={resetPassword} token={token} submit="Spara nytt lösenord" />
          </>
        )}
      </div>
    </main>
  );
}
