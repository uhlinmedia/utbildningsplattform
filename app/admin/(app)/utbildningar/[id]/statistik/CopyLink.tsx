'use client';

import { useState } from 'react';

export function CopyLink({ link, label = 'Länk till eleverna' }: { link: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <label className="field">{label}
      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <input type="text" readOnly value={link} onFocus={(e) => e.currentTarget.select()} style={{ fontSize: 13 }} />
        <button
          className="btn btn-primary btn-sm"
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? 'Kopierad' : 'Kopiera'}
        </button>
      </div>
    </label>
  );
}
