'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { refreshAdmin, replaceSlide } from '../../../actions';
import { pdfPageImage, SLIDE_IMAGE_TYPES } from './SlideUploader';

// "Byt bild" för en bild i ett bildspel: välj en ny bild eller en PDF (och vilken sida). Bilden byts på samma
// plats; beskrivning och tidsmarkering ("Visa vid") behålls.
export function SlideReplace({ blockId, index, mediaId }: { blockId: string; index: number; mediaId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    try {
      let blob: Blob = file;
      let name = file.name;
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        setBusy('Läser PDF …');
        const page = await pdfPageImage(file, (total) => {
          // Förslag: samma sidnummer som bildens plats i bildspelet (vanligt när presentationen exporterats om).
          const def = String(Math.min(index + 1, total));
          const v = window.prompt(`PDF:en har ${total} sidor. Vilken sida ska ersätta bild ${index + 1}?`, def);
          return v === null ? null : Number(v.trim());
        });
        if (!page) { setBusy(null); return; }
        blob = page;
        name = `${file.name.replace(/\.pdf$/i, '')}-bild-${index + 1}.jpg`;
      } else if (!SLIDE_IMAGE_TYPES.includes(file.type)) {
        throw new Error('Välj en PNG, JPG, WebP, GIF eller PDF.');
      } else if (file.size > 5 * 1024 * 1024) {
        throw new Error('Bilden får vara högst 5 MB.');
      }
      setBusy('Byter bild …');
      const fd = new FormData();
      fd.set('block_id', blockId);
      fd.set('index', String(index));
      fd.set('media_id', mediaId);
      fd.set('image', new File([blob], name, { type: blob.type || 'image/jpeg' }));
      const r = await replaceSlide(fd);
      if (!r.ok) throw new Error(r.error);
      await refreshAdmin();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Något gick fel.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button
        type="button" className="btn btn-sm" disabled={!!busy}
        onClick={() => input.current?.click()}
        aria-label={`Byt bild ${index + 1}`} title="Ersätt bilden med en ny bild eller en sida ur en PDF. Beskrivning och tidsmarkering behålls."
      >
        {busy ? '…' : 'Byt bild'}
      </button>
      {/* Utan name och tömd direkt: fältet räknas inte som en osparad ändring i formuläret. */}
      <input
        ref={input} type="file" hidden accept={[...SLIDE_IMAGE_TYPES, 'application/pdf', '.pdf'].join(',')}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }}
      />
      {(busy || error) && (
        <span className={`slide-replace-status small ${error ? 'error' : 'muted'}`} role={error ? 'alert' : 'status'}>{error ?? busy}</span>
      )}
    </>
  );
}
