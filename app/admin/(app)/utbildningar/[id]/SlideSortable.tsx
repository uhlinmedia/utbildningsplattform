'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

// Dra och släpp för bilderna i ett bildspel (editorn).
// - Dra i greppet (⠿) eller bilden – med mus även var som helst på raden utom i fält och knappar.
//   Fungerar med mus, pekskärm och penna (pointer events). Esc avbryter.
// - Under dragningen glider de andra bilderna undan; nära fönsterkanten scrollar sidan.
// - När bilden släpps skickas formuläret med op=move:från:till (samma formulär som ↑ ↓, så att
//   ändrade beskrivningar och tider sparas samtidigt). Servern flyttar bilden och sidan ritas om.
// - ↑ ↓-knapparna finns kvar för tangentbord och skärmläsare.

const INTERACTIVE = 'input, textarea, select, button, a, label';
const EDGE = 80; // px från fönsterkanten där sidan börjar scrolla

type Drag = {
  pointerId: number;
  from: number;
  to: number;
  startY: number; // dokumentkoordinat
  lastClientY: number;
  active: boolean;
  items: HTMLLIElement[];
  mids: number[]; // radernas mittpunkter (dokumentkoordinater) när dragningen började
  shift: number; // radhöjd + mellanrum
  centerY: number;
};

export function SlideSortable({ order, label, children }: { order: string; label: string; children: ReactNode }) {
  const list = useRef<HTMLOListElement>(null);
  const submit = useRef<HTMLButtonElement>(null);
  const drag = useRef<Drag | null>(null);
  const raf = useRef(0);
  const fallback = useRef(0);
  const [saving, setSaving] = useState(false);

  // Ny ordning från servern: ta bort tillfälliga förflyttningar (React återanvänder raderna).
  useEffect(() => {
    setSaving(false);
    clearTimeout(fallback.current);
    list.current?.querySelectorAll<HTMLLIElement>(':scope > li').forEach((li) => {
      li.style.transform = '';
      li.classList.remove('dragging');
    });
    list.current?.classList.remove('sorting');
  }, [order]);

  useEffect(() => () => { cancelAnimationFrame(raf.current); clearTimeout(fallback.current); }, []);

  function layout(d: Drag) {
    const dy = d.lastClientY + window.scrollY - d.startY;
    const center = d.centerY + dy;
    let to = 0;
    d.mids.forEach((m, i) => { if (i !== d.from && center > m) to++; });
    d.to = to;
    d.items.forEach((li, i) => {
      if (i === d.from) { li.style.transform = `translateY(${dy}px)`; return; }
      let t = 0;
      if (d.from < to && i > d.from && i <= to) t = -d.shift;
      if (to < d.from && i >= to && i < d.from) t = d.shift;
      li.style.transform = t ? `translateY(${t}px)` : '';
    });
  }

  function autoScroll() {
    const d = drag.current;
    if (!d?.active) return;
    const y = d.lastClientY;
    const v = y < EDGE ? -Math.ceil((EDGE - y) / 4) : y > window.innerHeight - EDGE ? Math.ceil((y - (window.innerHeight - EDGE)) / 4) : 0;
    if (v) { window.scrollBy(0, v); layout(d); }
    raf.current = requestAnimationFrame(autoScroll);
  }

  function end(commit: boolean) {
    const d = drag.current;
    drag.current = null;
    cancelAnimationFrame(raf.current);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey);
    document.body.classList.remove('slide-sorting');
    if (!d?.active) return;
    if (commit && d.to !== d.from && submit.current) {
      // Låt raderna stå kvar i den nya ordningen tills servern ritat om.
      const li = d.items[d.from];
      const dist = d.mids[d.to] - d.mids[d.from];
      li.style.transform = `translateY(${dist}px)`;
      li.classList.remove('dragging');
      setSaving(true);
      // Om sidan av någon anledning inte ritas om (t.ex. nätverksfel): återställ efter en stund.
      fallback.current = window.setTimeout(() => {
        setSaving(false);
        d.items.forEach((x) => { x.style.transform = ''; });
        list.current?.classList.remove('sorting');
      }, 20000);
      submit.current.value = `move:${d.from}:${d.to}`;
      submit.current.form?.requestSubmit(submit.current);
    } else {
      d.items.forEach((li) => { li.style.transform = ''; li.classList.remove('dragging'); });
      list.current?.classList.remove('sorting');
    }
  }

  function onMove(e: PointerEvent) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.lastClientY = e.clientY;
    if (!d.active) {
      if (Math.abs(e.clientY + window.scrollY - d.startY) < 5) return;
      d.active = true;
      d.items[d.from].classList.add('dragging');
      list.current?.classList.add('sorting');
      document.body.classList.add('slide-sorting');
      raf.current = requestAnimationFrame(autoScroll);
    }
    e.preventDefault();
    layout(d);
  }
  function onUp(e: PointerEvent) { if (drag.current && e.pointerId === drag.current.pointerId) end(true); }
  function onCancel() { end(false); }
  function onKey(e: KeyboardEvent) { if (e.key === 'Escape') end(false); }

  function onPointerDown(e: React.PointerEvent<HTMLOListElement>) {
    if (saving || drag.current || e.button !== 0) return;
    const target = e.target as HTMLElement;
    const li = target.closest<HTMLLIElement>('li');
    if (!li || li.parentElement !== list.current) return;
    const onHandle = !!target.closest('.slide-handle, img, .slide-missing-img');
    // Pekskärm: bara greppet och bilden, så att man fortfarande kan scrolla över raden.
    if (!onHandle && (e.pointerType !== 'mouse' || target.closest(INTERACTIVE))) return;
    const items = Array.from(list.current!.querySelectorAll<HTMLLIElement>(':scope > li'));
    if (items.length < 2) return;
    const rects = items.map((x) => x.getBoundingClientRect());
    const gap = parseFloat(getComputedStyle(list.current!).rowGap) || 0;
    const from = items.indexOf(li);
    drag.current = {
      pointerId: e.pointerId, from, to: from,
      startY: e.clientY + window.scrollY, lastClientY: e.clientY, active: false, items,
      mids: rects.map((r) => r.top + window.scrollY + r.height / 2),
      shift: rects[from].height + gap,
      centerY: rects[from].top + window.scrollY + rects[from].height / 2,
    };
    if (onHandle) e.preventDefault(); // ingen textmarkering eller bilddragning
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
  }

  return (
    <>
      <ol
        ref={list} className={`slide-list ${saving ? 'saving' : ''}`} aria-label={label} aria-busy={saving}
        onPointerDown={onPointerDown} onDragStart={(e) => e.preventDefault()}
      >
        {children}
      </ol>
      {/* Skickar formuläret med op=move:från:till när en bild släpps. */}
      <button ref={submit} type="submit" name="op" value="" className="sr-only" tabIndex={-1} aria-hidden="true" />
      {saving && <span className="small muted" role="status">Sparar ny ordning …</span>}
    </>
  );
}
