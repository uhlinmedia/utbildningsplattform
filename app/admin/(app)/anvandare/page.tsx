import { requireUser } from '@/lib/access';
import { UsersPanel } from '../UsersPanel';

export const dynamic = 'force-dynamic';

export default async function SuperUsersPage({ searchParams }: { searchParams: Promise<{ fel?: string; inbjuden?: string; nollstalld?: string; lank?: string }> }) {
  const me = await requireUser('super');
  return (
    <>
      <div className="stack" style={{ gap: 4 }}>
        <h1>Briondo-användare</h1>
        <p className="muted small" style={{ margin: 0 }}>Superadmin har tillgång till alla kunder. Kundernas egna användare hanteras under respektive kund.</p>
      </div>
      <UsersPanel me={me} customerId={null} q={await searchParams} />
    </>
  );
}
