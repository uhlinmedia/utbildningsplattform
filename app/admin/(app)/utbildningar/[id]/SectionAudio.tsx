'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { prepareSectionAudio, removeSectionAudio, saveSectionAudio } from '../../../actions';

type Current = { url: string; filename: string; size: number; duration_s: number | null } | null;

function formatDuration(s: number | null | undefined) {
  if (!s) return '';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

// Läser ljudets längd i webbläsaren innan uppladdningen (null om det inte går).
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    const finish = (v: number | null) => { URL.revokeObjectURL(url); resolve(v); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => finish(Number.isFinite(a.duration) ? a.duration : null);
    a.onerror = () => finish(null);
    setTimeout(() => finish(null), 8000);
    a.src = url;
  });
}

// Laddar upp med XMLHttpRequest för att kunna visa förloppet (fetch saknar uppladdningsförlopp).
function upload(url: string, file: File, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append('cacheControl', '31536000');
    body.append('', file);
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Uppladdningen misslyckades (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error('Uppladdningen avbröts. Kontrollera nätet och försök igen.'));
    xhr.send(body);
  });
}

export function SectionAudio({ sectionId, current, configured }: { sectionId: string; current: Current; configured: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setBusy('Förbereder …');
      const [duration, prep] = await Promise.all([readDuration(file), prepareSectionAudio(sectionId, file.name, file.size)]);
      if (!prep.ok) throw new Error(prep.error);
      setBusy('Laddar upp 0 %');
      await upload(prep.uploadUrl, file, (p) => setBusy(`Laddar upp ${p} %`));
      setBusy('Sparar …');
      const res = await saveSectionAudio(sectionId, prep.path, file.name, duration);
      if (!res.ok) throw new Error(res.error);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Något gick fel.');
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  }

  async function onRemove() {
    if (!confirm('Ta bort speakerrösten från avsnittet?')) return;
    setBusy('Tar bort …');
    setError(null);
    const res = await removeSectionAudio(sectionId);
    setBusy(null);
    if (!res.ok) setError(res.error);
    else router.refresh();
  }

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="row between">
        <strong>Speakerröst</strong>
        <span className="small muted">Spelas upp överst i avsnittet för eleven</span>
      </div>
      {!configured ? (
        <p className="small muted" style={{ margin: 0 }}>
          Ljud är inte inställt än. Lägg till miljövariablerna SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY (se README).
        </p>
      ) : (
        <>
          {current && (
            <div className="stack" style={{ gap: 6 }}>
              <audio controls preload="metadata" src={current.url} style={{ width: '100%' }} />
              <span className="small muted">
                {current.filename}
                {current.duration_s ? ` · ${formatDuration(current.duration_s)}` : ''}
                {` · ${(current.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB`}
              </span>
            </div>
          )}
          <div className="row" style={{ gap: 8 }}>
            <input
              ref={input}
              type="file"
              accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,.mp3,.m4a,.aac,.wav"
              onChange={(e) => onFile(e.target.files?.[0])}
              disabled={!!busy}
              hidden
            />
            <button className="btn btn-sm" type="button" disabled={!!busy} onClick={() => input.current?.click()}>
              {current ? 'Byt ljudfil' : 'Ladda upp ljudfil'}
            </button>
            {current && (
              <button className="btn btn-sm btn-danger" type="button" disabled={!!busy} onClick={onRemove}>Ta bort</button>
            )}
            {busy && <span className="small muted" role="status">{busy}</span>}
          </div>
          <span className="hint small muted">MP3, M4A, AAC eller WAV, högst 50 MB. MP3 eller M4A rekommenderas (mindre filer, spelas överallt).</span>
          {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
        </>
      )}
    </div>
  );
}
