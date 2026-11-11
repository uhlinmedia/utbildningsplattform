import { cookies } from 'next/headers';
import { sql } from '@/lib/db';
import { CopyLink } from './utbildningar/[id]/statistik/CopyLink';
import { roleHint, roleLabel, type Role, type User } from '@/lib/access';
import { changeRole, deleteUser, inviteUser, resendInvite, resetTotp, setDisabled } from '../user-actions';

type Row = {
  id: string; email: string; name: string; role: Role; disabled: boolean; active: boolean;
  totp_enabled: boolean; last_login_at: Date | null; locked: boolean;
};

const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Stockholm' }).format(d) : '–');

export async function UsersPanel({ me, customerId, q }: {
  me: User; customerId: string | null; q: { fel?: string; inbjuden?: string; nollstalld?: string; lank?: string };
}) {
  const users = await sql<Row[]>`
    select id, email, name, role, disabled, password_hash is not null as active, totp_enabled, last_login_at,
      coalesce(locked_until > now(), false) as locked
    from admin_user where customer_id is not distinct from ${customerId} order by name, email`;
  const flash = q.lank ? (await cookies()).get('flash_link')?.value : undefined;
  const roles: Role[] = customerId ? ['kundadmin', 'utbildare', 'granskare'] : ['superadmin'];
  return (
    <>
      {q.lank && (
        <div className="notice stack" role="status" style={{ gap: 8 }}>
          <span>E-post kunde inte skickas (e-post är inte inställd ännu). Kopiera inbjudningslänken och skicka den själv till {q.lank} – den gäller i 7 dagar.</span>
          {flash ? <CopyLink link={flash} label="Inbjudningslänk" /> : <span className="small">Länken visas bara en gång. Använd ”Skicka inbjudan igen” för en ny.</span>}
        </div>
      )}
      {q.inbjuden && <p className="notice" role="status">Inbjudan skickad till {q.inbjuden}.</p>}
      {q.nollstalld && <p className="notice" role="status">Tvåstegsverifieringen för {q.nollstalld} är nollställd. Hen aktiverar den igen vid nästa inloggning.</p>}
      {q.fel && <p className="error" role="alert">{q.fel === 'finns' ? 'Det finns redan ett konto med den e-postadressen.' : 'Skriv en giltig e-postadress.'}</p>}

      <section className="card stack">
        <h2>Bjud in användare</h2>
        <form action={inviteUser} className="stack" style={{ gap: 12, maxWidth: 640 }} data-namn="Bjud in användare">
          <input type="hidden" name="customer_id" value={customerId ?? ''} />
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: '1 1 220px' }}>E-post<input type="email" name="email" required autoComplete="off" /></label>
            <label className="field" style={{ flex: '1 1 200px' }}>Namn (valfritt)<input type="text" name="name" autoComplete="off" /></label>
          </div>
          {customerId && (
            <fieldset className="stack" style={{ gap: 6 }}>
              <legend className="field-legend">Roll</legend>
              {roles.map((r) => (
                <label key={r} className="choice">
                  <input type="radio" name="role" value={r} defaultChecked={r === 'utbildare'} />
                  <span><strong>{roleLabel[r]}</strong> <span className="hint">{roleHint[r as Exclude<Role, 'superadmin'>]}</span></span>
                </label>
              ))}
            </fieldset>
          )}
          <div><button className="btn btn-primary" type="submit">Skicka inbjudan</button></div>
          <p className="small muted" style={{ margin: 0 }}>Personen får ett mejl med en länk (gäller 7 dagar) för att välja lösenord och aktivera tvåstegsverifiering.</p>
        </form>
      </section>

      <section className="card stack">
        <h2>Användare ({users.length})</h2>
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Namn</th><th>Roll</th><th>Status</th><th>Senast inloggad</th><th><span className="sr-only">Åtgärder</span></th></tr></thead>
            <tbody>
              {users.map((u) => {
                const self = u.id === me.id;
                return (
                  <tr key={u.id}>
                    <td><strong>{u.name || '–'}</strong><div className="small muted">{u.email}{self && ' (du)'}</div></td>
                    <td>
                      {customerId && !self ? (
                        <form action={changeRole} className="row" style={{ gap: 6, flexWrap: 'nowrap' }} data-namn={`Roll för ${u.email}`}>
                          <input type="hidden" name="user_id" value={u.id} />
                          <select name="role" defaultValue={u.role} aria-label={`Roll för ${u.email}`} style={{ minHeight: 34, padding: '4px 8px' }}>
                            {roles.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
                          </select>
                          <button className="btn btn-sm" type="submit">Spara</button>
                        </form>
                      ) : <span className="role-badge">{roleLabel[u.role]}</span>}
                    </td>
                    <td className="small">
                      {u.disabled ? <span className="badge">Avstängd</span>
                        : !u.active ? <span className="badge">Inbjuden</span>
                        : <span className="badge badge-ok">Aktiv</span>}
                      {u.active && !u.totp_enabled && !u.disabled && <div className="muted">Tvåsteg ej aktiverad</div>}
                      {u.locked && <div className="error">Spärrad 15 min (felaktiga försök)</div>}
                    </td>
                    <td className="small">{fmt(u.last_login_at)}</td>
                    <td>
                      {!self && (
                        <details className="small">
                          <summary>Åtgärder</summary>
                          <div className="stack" style={{ gap: 6, paddingTop: 8 }}>
                            {!u.active && (
                              <form action={resendInvite} data-ingen-varning><input type="hidden" name="user_id" value={u.id} />
                                <button className="btn btn-sm" type="submit">Skicka inbjudan igen</button></form>
                            )}
                            {u.totp_enabled && (
                              <form action={resetTotp} data-ingen-varning><input type="hidden" name="user_id" value={u.id} />
                                <button className="btn btn-sm" type="submit">Nollställ tvåstegsverifiering</button></form>
                            )}
                            <form action={setDisabled} data-ingen-varning><input type="hidden" name="user_id" value={u.id} />
                              <input type="hidden" name="disabled" value={u.disabled ? '0' : '1'} />
                              <button className="btn btn-sm" type="submit">{u.disabled ? 'Aktivera kontot' : 'Stäng av kontot'}</button></form>
                            <form action={deleteUser} className="row" style={{ gap: 6 }} data-ingen-varning>
                              <input type="hidden" name="user_id" value={u.id} />
                              <input type="text" name="confirm" placeholder="Skriv TA BORT" aria-label="Skriv TA BORT för att bekräfta" style={{ maxWidth: 140, minHeight: 34 }} />
                              <button className="btn btn-sm btn-danger" type="submit">Ta bort</button>
                            </form>
                          </div>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
