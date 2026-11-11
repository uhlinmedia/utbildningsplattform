'use client';

import { useState } from 'react';

export function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const text = `Reservkoder för Briondo (varje kod fungerar en gång)\n\n${codes.join('\n')}\n`;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <ul className="recovery" aria-label="Reservkoder">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}>
          {copied ? 'Kopierat ✓' : 'Kopiera'}
        </button>
        <a className="btn btn-sm" download="briondo-reservkoder.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}>Ladda ner</a>
      </div>
    </div>
  );
}
