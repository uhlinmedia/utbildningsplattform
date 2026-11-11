'use client';

import { useActionState } from 'react';
import { newRecoveryCodesAction, type SetupState } from '../../auth-actions';
import { RecoveryCodes } from '../../RecoveryCodes';

export function NewCodes() {
  const [state, action, pending] = useActionState<SetupState, FormData>(newRecoveryCodesAction, {});
  if (state.codes) {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <p className="notice" role="status" style={{ margin: 0 }}>Nya reservkoder – de gamla slutar fungera. Spara dem nu, de visas bara en gång.</p>
        <RecoveryCodes codes={state.codes} />
      </div>
    );
  }
  return (
    <form action={action} className="row" style={{ alignItems: 'flex-end' }} data-ingen-varning>
      <label className="field" style={{ maxWidth: 200 }}>Kod från appen
        <input type="text" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={7} />
      </label>
      <button className="btn" type="submit" disabled={pending}>Skapa nya reservkoder</button>
      {state.error && <p className="error" role="alert" style={{ width: '100%', margin: 0 }}>{state.error}</p>}
    </form>
  );
}
