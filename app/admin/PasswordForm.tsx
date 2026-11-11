'use client';

import { useActionState } from 'react';
import type { FormState } from './auth-actions';

// Formulär för nytt lösenord (inbjudan, återställning, byte). Minst 12 tecken.
export function PasswordForm(props: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  token?: string;
  withName?: boolean;
  defaultName?: string;
  withCurrent?: boolean;
  submit: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(props.action, {});
  return (
    <form action={action} className="stack" style={{ gap: 12 }}>
      {props.token && <input type="hidden" name="token" value={props.token} />}
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.ok && <p className="notice" role="status">{state.ok}</p>}
      {props.withName && (
        <label className="field">Ditt namn<input type="text" name="name" autoComplete="name" required defaultValue={props.defaultName} maxLength={120} /></label>
      )}
      {props.withCurrent && (
        <label className="field">Nuvarande lösenord<input type="password" name="current" autoComplete="current-password" required /></label>
      )}
      <label className="field">Nytt lösenord
        <span className="hint">Minst 12 tecken. Gärna en fras med flera ord.</span>
        <input type="password" name="password" autoComplete="new-password" required minLength={12} />
      </label>
      <label className="field">Upprepa lösenordet<input type="password" name="password2" autoComplete="new-password" required minLength={12} /></label>
      <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? 'Sparar …' : props.submit}</button>
    </form>
  );
}
