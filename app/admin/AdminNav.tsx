'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

// Adminmenyn. På dator en sidomeny; på mobil en kompakt list med logga, kundnamn och en
// Meny-knapp som fäller ut länkarna. Menyn stängs automatiskt när man byter sida.
export function AdminNav({ top, children }: { top: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <nav className="admin-nav" aria-label="Admin" data-open={open ? '' : undefined}>
      <div className="nav-top">
        {top}
        <button
          type="button"
          className="nav-toggle"
          aria-expanded={open}
          aria-controls="admin-nav-links"
          onClick={() => setOpen((o) => !o)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
          {open ? 'Stäng' : 'Meny'}
        </button>
      </div>
      <div className="nav-links" id="admin-nav-links">{children}</div>
    </nav>
  );
}
