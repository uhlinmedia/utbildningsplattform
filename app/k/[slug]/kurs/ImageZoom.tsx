'use client';

import { useEffect, useRef, useState } from 'react';

// Bild i ett bildblock (B50/B51). Klick öppnar bilden i full storlek; Esc, klick
// eller Stäng går tillbaka.
export function ImageZoom({ src, alt, width, height }: { src: string; alt: string; width?: number; height?: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      {/* Knappens namn = bildens alt-text + "(visa i full storlek)", så skärmläsare får både beskrivning och funktion. */}
      <button type="button" className="img-zoom" onClick={() => setOpen(true)} title="Visa i full storlek">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} width={width} height={height} />
        <span className="sr-only">{alt ? ' (visa i full storlek)' : 'Visa bilden i full storlek'}</span>
        <span className="img-zoom-hint" aria-hidden="true">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L21 21M11 8v6M8 11h6" /></svg>
        </span>
      </button>
      <dialog ref={dialog} className="img-zoom-dialog" onClose={() => setOpen(false)} onClick={() => setOpen(false)} aria-label="Bild i full storlek">
        {open && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={alt} />
        )}
        <button type="button" className="slides-close img-zoom-close" onClick={() => setOpen(false)} aria-label="Stäng">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </dialog>
    </>
  );
}
