import { requireUser, roleLabel } from '@/lib/access';
import { sql } from '@/lib/db';
import { PasswordForm } from '../../PasswordForm';
import { changePassword, logoutEverywhere } from '../../auth-actions';
import { NewCodes } from './NewCodes';

export const dynamic = 'force-dynamic';

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ reservkod?: string }> }) {
  const { reservkod } = await searchParams;
  const user = await requireUser();
  const [u] = await sql<{ codes: number; last_login_at: Date | null; customer: string | null }[]>`
    select coalesce(array_length(recovery_codes, 1), 0) as codes, last_login_at,
      (select name from customer where id = u.customer_id) as customer
    from admin_user u where id = ${user.id}`;
  return (
    <>
      <h1>Mitt konto</h1>
      {reservkod && (
        <p className="notice" role="status">Du loggade in med en reservkod. Du har {u.codes} kvar – skapa nya nedan om det börjar ta slut.</p>
      )}
      <section className="card stack" style={{ maxWidth: 620 }}>
        <dl className="stack" style={{ gap: 6, margin: 0 }}>
          <div><dt className="small muted">Namn</dt><dd style={{ margin: 0 }}>{user.name || '–'}</dd></div>
          <div><dt className="small muted">E-post</dt><dd style={{ margin: 0 }}>{user.email}</dd></div>
          <div><dt className="small muted">Roll</dt><dd style={{ margin: 0 }}>{roleLabel[user.role]}{u.customer ? ` – ${u.customer}` : ''}</dd></div>
        </dl>
      </section>
      <section className="card stack" style={{ maxWidth: 620 }}>
        <h2>Byt lösenord</h2>
        <PasswordForm action={changePassword} withCurrent submit="Byt lösenord" />
      </section>
      <section className="card stack" style={{ maxWidth: 620 }}>
        <h2>Tvåstegsverifiering</h2>
        <p className="ok" style={{ margin: 0 }}>✓ Aktiverad. Du har {u.codes} oanvända reservkoder.</p>
        <NewCodes />
        <p className="small muted" style={{ margin: 0 }}>Ny telefon? Be en kundadmin eller Briondo att nollställa tvåstegsverifieringen, så får du aktivera den igen vid nästa inloggning.</p>
      </section>
      <section className="card stack" style={{ maxWidth: 620 }}>
        <h2>Sessioner</h2>
        <form action={logoutEverywhere} data-ingen-varning>
          <button className="btn" type="submit">Logga ut på alla enheter</button>
        </form>
      </section>
    </>
  );
}
