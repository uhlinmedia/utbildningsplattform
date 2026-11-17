'use client';

import { useEffect, useState, type ReactNode } from 'react';

// Ett kapitel i editorns struktur.
// - Pilen fäller ihop/ut kapitlets avsnitt. Ihopfällda kapitel kommer webbläsaren ihåg per utbildning,
//   men kapitlet med det avsnitt som är öppet i editorn visas alltid utfällt när sidan laddas.
// - Klick på kapitlets namn visar kapitlets inställningar (byta namn, flytta, ta bort).
// Båda delarna döljs med hidden i stället för att tas bort, så att osparade ändringar i
// namnfältet inte försvinner (och "Kom ihåg att spara" ser dem).

const key = (courseId: string) => `briondo-ihopfallda-kapitel-${courseId}`;

function readClosed(courseId: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(courseId)) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function ChapterNode({
  courseId, chapterId, label, sectionCount, hasCurrent, settings, children,
}: {
  courseId: string; chapterId: string; label: string; sectionCount: number; hasCurrent: boolean;
  settings: ReactNode; children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (!hasCurrent && readClosed(courseId).includes(chapterId)) setOpen(false);
  }, [courseId, chapterId, hasCurrent]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      const closed = readClosed(courseId).filter((id) => id !== chapterId);
      if (!next) closed.push(chapterId);
      localStorage.setItem(key(courseId), JSON.stringify(closed));
    } catch { /* privat läge e.d. – då gäller det bara tills sidan laddas om */ }
  };

  const listId = `kapitel-${chapterId}-avsnitt`;
  const settingsId = `kapitel-${chapterId}-installningar`;

  return (
    <div className="tree-chapter">
      <div className="tree-ch-row">
        <button
          type="button" className="tree-toggle" onClick={toggle}
          aria-expanded={open} aria-controls={listId}
          aria-label={`${open ? 'Fäll ihop' : 'Fäll ut'} kapitel ${label}`}
          title={open ? 'Fäll ihop kapitlet' : 'Visa kapitlets avsnitt'}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button
          type="button" className={`tree-ch-name ${showSettings ? 'active' : ''}`} onClick={() => setShowSettings((v) => !v)}
          aria-expanded={showSettings} aria-controls={settingsId} title="Kapitlets inställningar (namn, flytta, ta bort)"
        >
          {label}
          {!open && <span className="tree-count"> ({sectionCount})</span>}
        </button>
      </div>
      <div id={settingsId} className="tree-ch-settings" hidden={!showSettings}>{settings}</div>
      <div id={listId} hidden={!open}>{children}</div>
    </div>
  );
}
