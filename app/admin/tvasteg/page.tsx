import { redirect } from 'next/navigation';
import { sessionUser } from '@/lib/access';
import { pendingUser, totpSetupInfo } from '@/lib/users';
import { SetupForm } from './SetupForm';
import { Wordmark } from '../../Wordmark';

export const dynamic = 'force-dynamic';

export default async function TotpSetupPage() {
  const u = await pendingUser('setup');
  // Efter aktiveringen är sessionen fullständig; sidan ritas om men formuläret (med reservkoderna) behåller sitt läge.
  const full = u ? null : await sessionUser();
  if (!u && !full) redirect('/admin/login');
  const info = u ? await totpSetupInfo() : { qr: '', secret: '' };
  if (!info) redirect('/admin/login');
  const who = (u ?? full)!;
  const home = who.role === 'superadmin' ? '/admin' : `/admin/kunder/${who.customer_id}`;
  return (
    <main className="center-page">
      <div className="card stack auth-card" style={{ maxWidth: 520 }}>
        <Wordmark size={34} />
        <SetupForm qr={info.qr} secret={info.secret} home={home} />
      </div>
    </main>
  );
}
