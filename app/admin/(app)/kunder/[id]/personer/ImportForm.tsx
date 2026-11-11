'use client';

import { useActionState } from 'react';
import { importPersons, type ImportResult } from '../../../../person-actions';

export function ImportForm({ customerId }: { customerId: string }) {
  const [r, action, pending] = useActionState<ImportResult | null, FormData>(importPersons, null);
  return (
    <form action={action} className="stack" style={{ gap: 10 }} data-ingen-varning>
      <input type="hidden" name="customer_id" value={customerId} />
      <p className="small muted" style={{ margin: 0 }}>
        Excel (.xlsx) eller CSV. Första raden är rubriker: <strong>Namn</strong>, <strong>E-post</strong>,{' '}
        <strong>Anställningsnummer</strong> och <strong>Grupp</strong> (e-post eller anställningsnummer krävs).
        Personer som redan finns känns igen på anställningsnummer eller e-post och uppdateras. Ingen tas bort.
      </p>
      <div className="row" style={{ alignItems: 'center' }}>
        <input type="file" name="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
        <button className="btn" type="submit" disabled={pending}>{pending ? 'Importerar …' : 'Importera'}</button>
        <a className="small" href={`data:text/csv;charset=utf-8,${encodeURIComponent('﻿Namn;E-post;Anställningsnummer;Grupp\nAnna Svensson;anna.svensson@exempel.se;1001;Ramp\n')}`} download="personregister-mall.csv">Ladda ner mall</a>
      </div>
      <div aria-live="polite">
        {r?.error && <p className="error" role="alert" style={{ margin: 0 }}>{r.error}</p>}
        {r && !r.error && (
          <div className="stack" style={{ gap: 6 }}>
            <p className="notice" style={{ margin: 0 }}>
              Import klar: {r.created} nya, {r.updated} uppdaterade, {r.unchanged} oförändrade{r.errors.length ? `, ${r.errors.length} rader hoppades över` : ''}.
            </p>
            {r.errors.length > 0 && (
              <details open={r.errors.length <= 10}>
                <summary className="small">Rader som inte importerades</summary>
                <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                  {r.errors.slice(0, 200).map((e) => <li key={e.row}>Rad {e.row}: {e.message}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
