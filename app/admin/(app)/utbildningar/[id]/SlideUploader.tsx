'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addSlide, refreshAdmin } from '../../../actions';

// Bredd som PDF-sidor ritas i. 1920 px räcker för helskärm på de flesta skärmar och ger skarp text.
const TARGET_WIDTH = 1920;
const MAX_PAGES = 200;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

type Status = { kind: 'idle' } | { kind: 'busy'; text: string; done: number; total: number } | { kind: 'done'; text: string } | { kind: 'error'; text: string };

// Gör om en PDF till en bild per sida i webbläsaren (pdf.js). Inget skickas till någon annan tjänst,
// och servern behöver inget extra för att hantera PDF.
async function* pdfPages(file: File): AsyncGenerator<{ blob: Blob; page: number; total: number }> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const total = Math.min(doc.numPages, MAX_PAGES);
  try {
    for (let p = 1; p <= total; p++) {
      const page = await doc.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(4, TARGET_WIDTH / base.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport, background: '#ffffff' }).promise;
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
      page.cleanup();
      if (!blob) throw new Error(`Sidan ${p} kunde inte göras om till bild.`);
      yield { blob, page: p, total };
    }
  } finally {
    await task.destroy();
  }
}

export function SlideUploader({ blockId, count }: { blockId: string; count: number }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const pdfRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const busy = status.kind === 'busy';

  const upload = async (blob: Blob, name: string) => {
    const fd = new FormData();
    fd.set('block_id', blockId);
    fd.set('image', new File([blob], name, { type: blob.type }));
    const r = await addSlide(fd);
    if (!r.ok) throw new Error(r.error);
  };

  const finish = async (n: number, what: string) => {
    await refreshAdmin();
    router.refresh();
    setStatus({ kind: 'done', text: `${n} ${n === 1 ? 'bild' : 'bilder'} tillagda från ${what}.` });
  };

  const onPdf = async (file: File) => {
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      setStatus({ kind: 'error', text: 'Välj en PDF-fil.' });
      return;
    }
    let added = 0;
    try {
      setStatus({ kind: 'busy', text: 'Läser PDF …', done: 0, total: 0 });
      for await (const { blob, page, total } of pdfPages(file)) {
        setStatus({ kind: 'busy', text: `Sida ${page} av ${total}`, done: page - 1, total });
        await upload(blob, `${file.name.replace(/\.pdf$/i, '')}-sida-${page}.jpg`);
        added++;
      }
      await finish(added, file.name);
    } catch (e) {
      if (added) { await refreshAdmin(); router.refresh(); }
      setStatus({ kind: 'error', text: `${e instanceof Error ? e.message : 'Något gick fel.'}${added ? ` ${added} sidor hann läggas till.` : ''}` });
    }
  };

  const onImages = async (files: File[]) => {
    const bad = files.filter((f) => !IMAGE_TYPES.includes(f.type) || f.size > 5 * 1024 * 1024);
    if (bad.length) {
      setStatus({ kind: 'error', text: `Bara PNG, JPG, WebP eller GIF på högst 5 MB: ${bad.map((f) => f.name).join(', ')}` });
      return;
    }
    // Filnamn som Bild1, Bild2 … Bild10 (som PowerPoint exporterar) sorteras i rätt ordning.
    files.sort((a, b) => a.name.localeCompare(b.name, 'sv', { numeric: true }));
    let added = 0;
    try {
      for (const f of files) {
        setStatus({ kind: 'busy', text: `Bild ${added + 1} av ${files.length}`, done: added, total: files.length });
        await upload(f, f.name);
        added++;
      }
      await finish(added, files.length === 1 ? files[0].name : 'valda filer');
    } catch (e) {
      if (added) { await refreshAdmin(); router.refresh(); }
      setStatus({ kind: 'error', text: `${e instanceof Error ? e.message : 'Något gick fel.'}${added ? ` ${added} bilder hann läggas till.` : ''}` });
    }
  };

  return (
    <div className="block-body" style={{ paddingTop: 0 }}>
      <div className="slide-upload stack" style={{ gap: 10 }}>
        <strong className="small">{count ? 'Lägg till fler bilder' : 'Lägg till innehåll'}</strong>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-sm btn-dark" disabled={busy} onClick={() => pdfRef.current?.click()}>Välj PDF …</button>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => imgRef.current?.click()}>Välj bilder …</button>
        </div>
        <input
          ref={pdfRef} type="file" accept="application/pdf,.pdf" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPdf(f); }}
        />
        <input
          ref={imgRef} type="file" accept={IMAGE_TYPES.join(',')} multiple hidden
          onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; if (fs.length) onImages(fs); }}
        />
        <p className="small muted" style={{ margin: 0 }}>
          PDF: varje sida blir en bild (högst {MAX_PAGES} sidor). PowerPoint: spara först som PDF (Arkiv → Exportera → PDF)
          eller exportera bilderna som PNG/JPG och välj dem här. Nya bilder läggs sist.
        </p>
        <div aria-live="polite">
          {status.kind === 'busy' && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="small">Laddar upp … {status.text}</span>
              {status.total > 0 && <progress max={status.total} value={status.done} style={{ width: '100%' }} />}
            </div>
          )}
          {status.kind === 'done' && <span className="small" style={{ color: 'var(--ok)' }}>✓ {status.text}</span>}
          {status.kind === 'error' && <span className="small error" role="alert">{status.text}</span>}
        </div>
      </div>
    </div>
  );
}
