'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { confirmTotp, type SetupState } from '../auth-actions';
import { RecoveryCodes } from '../RecoveryCodes';

export function SetupForm({ qr, secret, home }: { qr: string; secret: string; home: string }) {
  const [state, action, pending] = useActionState<SetupState, FormData>(confirmTotp, {});
  if (state.codes) {
    return (
      <div className="stack">
        <h1 style={{ fontSize: 20 }}>Klart – spara dina reservkoder</h1>
        <p style={{ margin: 0 }}>
          Om du tappar telefonen kan du logga in med en reservkod i stället för koden från appen. Spara dem säkert,
          t.ex. i en lösenordshanterare. De visas bara nu.
        </p>
        <RecoveryCodes codes={state.codes} />
        <Link className="btn btn-primary" href={home}>Jag har sparat koderna – fortsätt</Link>
      </div>
    );
  }
  return (
    <form action={action} className="stack">
      <h1 style={{ fontSize: 20 }}>Aktivera tvåstegsverifiering</h1>
      <p style={{ margin: 0 }}>Krävs för alla konton i Briondo. Du behöver en autentiseringsapp i telefonen, t.ex.
        Microsoft Authenticator eller Google Authenticator.</p>
      <ol className="stack" style={{ gap: 10, paddingLeft: 20, margin: 0 }}>
        <li className="stack" style={{ gap: 10 }}>
          <span>Öppna appen, välj att lägga till ett konto och skanna QR-koden.</span>
          <div className="qr-box">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR-kod för autentiseringsappen" />
            <div className="stack" style={{ gap: 6, minWidth: 0, flex: '1 1 160px' }}>
              <span className="small muted">Kan du inte skanna? Skriv in nyckeln:</span>
              <code className="secret">{secret.match(/.{1,4}/g)?.join(' ')}</code>
            </div>
          </div>
        </li>
        <li>Skriv koden som appen visar.</li>
      </ol>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <label className="field">Kod (6 siffror)
        <input className="code-input" type="text" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={7} />
      </label>
      <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? 'Kontrollerar …' : 'Aktivera'}</button>
    </form>
  );
}
