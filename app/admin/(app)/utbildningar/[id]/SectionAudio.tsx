'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { generateSectionAudio, prepareSectionAudio, removeSectionAudio, saveSectionAudio } from '../../../actions';

type Current = { url: string; filename: string; size: number; duration_s: number | null } | null;
// AI-uppläsning (bara superadmin och när GEMINI_API_KEY finns): förifylld text, röst och stil.
type Ai = {
  voices: { id: string; label: string }[]; voice: string; style: string; text: string; fromAi: boolean;
  blocked: string | null; // varför kundens användare inte kan skapa röst just nu (t.ex. kvoten slut)
  quota: string | null;   // t.ex. "Kvar denna månad: 42 av 120 min" (inte för superadmin)
} | null;

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

// Ungefärlig tid för att skapa en AI-röst: Google gör ca 3 000 tecken per anrop, tre anrop parallellt.
// Används bara för förloppsindikatorn – servern ger inget löpande förlopp.
function estimateSeconds(chars: number) {
  const chunks = Math.max(1, Math.ceil(chars / 3000));
  const rounds = Math.ceil(chunks / 3);
  const perRound = (Math.min(chars, 3000) / 15) * 0.25; // ca 15 tecken per sekund tal, Google ca 4× snabbare än realtid
  return Math.min(280, Math.max(10, Math.round(6 + rounds * perRound)));
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Förloppsindikator medan AI-rösten skapas: stapel efter uppskattad tid, steg i klartext och förfluten tid.
function AiProgress({ start, estimate }: { start: number; estimate: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, (now - start) / 1000);
  const f = elapsed / estimate;
  // Rakt upp till 90 % vid uppskattad tid, sedan allt långsammare mot 99 %.
  const pct = f <= 1 ? 4 + f * 86 : 90 + 9 * (1 - Math.exp(-(f - 1) * 1.5));
  const step = f < 0.08 ? 'Skickar texten till Google …'
    : f < 0.85 ? 'Google läser in rösten …'
    : f <= 1.15 ? 'Gör om till MP3 och sparar …'
    : 'Tar lite längre tid än vanligt – vänta kvar, rösten skapas fortfarande …';
  const left = Math.max(0, Math.round(estimate - elapsed));
  return (
    <div className="ai-progress" role="status" aria-live="polite">
      <div className="row between" style={{ gap: 8 }}>
        <strong className="small"><span className="ai-spinner" aria-hidden="true" />Skapar AI-röst</strong>
        <span className="small muted" aria-hidden="true">{clock(elapsed)}{f <= 1 ? ` · ca ${clock(left)} kvar` : ''}</span>
      </div>
      <div className="ai-progress-bar" aria-hidden="true"><span style={{ width: `${pct.toFixed(1)}%` }} /></div>
      <span className="small">{step}</span>
      <span className="small muted">Stäng inte sidan och byt inte avsnitt förrän rösten är klar.</span>
    </div>
  );
}

export function SectionAudio({ sectionId, current, configured, ai = null }: { sectionId: string; current: Current; configured: boolean; ai?: Ai }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiText, setAiText] = useState(ai?.text ?? '');
  const [aiVoice, setAiVoice] = useState(ai?.voice ?? '');
  const [aiStyle, setAiStyle] = useState(ai?.style ?? '');
  const [aiRun, setAiRun] = useState<{ start: number; estimate: number } | null>(null);
  const [aiDone, setAiDone] = useState<string | null>(null);

  // Varna om sidan stängs eller laddas om medan rösten skapas (då går arbetet förlorat).
  useEffect(() => {
    if (!aiRun) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = 'AI-rösten skapas fortfarande.'; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [aiRun]);

  async function onGenerate() {
    if (!ai) return;
    if (current && !confirm('Den nuvarande speakerrösten ersätts med en ny AI-röst. Fortsätta?')) return;
    setError(null);
    setAiDone(null);
    const start = Date.now();
    setAiRun({ start, estimate: estimateSeconds(aiText.length) });
    setBusy('Skapar AI-röst …');
    try {
      const res = await generateSectionAudio(sectionId, aiText, aiVoice, aiStyle);
      if (!res.ok) throw new Error(res.error);
      setAiDone(`✓ AI-rösten är klar (tog ${clock((Date.now() - start) / 1000)}). Lyssna i spelaren ovan.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Något gick fel.');
    } finally {
      setBusy(null);
      setAiRun(null);
    }
  }

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
        <span className="small muted">Eleven lyssnar via ljudknappen i kursvyn</span>
      </div>
      {!configured ? (
        <p className="small muted" style={{ margin: 0 }}>
          Ljud är inte inställt än. Lägg till miljövariablerna SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY (se README).
        </p>
      ) : (
        <>
          {current && (
            <div className="stack" style={{ gap: 6 }}>
              <audio data-avsnittsljud controls preload="metadata" src={current.url} style={{ width: '100%' }} />
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
            {busy && !aiRun && <span className="small muted" role="status">{busy}</span>}
          </div>
          {ai && (
            <details className="ai-voice" open={!current}>
              <summary>{current ? 'Skapa om med AI-uppläsning' : 'Skapa röst från text (AI-uppläsning)'}</summary>
              <div className="stack" style={{ gap: 10, marginTop: 10 }}>
                <label className="field">Text som läses upp
                  <span className="hint">Förifylld med avsnittets text. Ändra fritt – t.ex. skriv ut förkortningar och siffror som de ska uttalas.</span>
                  <textarea name="ai_text" rows={8} value={aiText} onChange={(e) => setAiText(e.target.value)} disabled={!!busy} />
                  <span className="small muted">{aiText.length.toLocaleString('sv-SE')} tecken · ca {Math.max(1, Math.round(aiText.length / 900))} min</span>
                </label>
                <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
                  <label className="field" style={{ flex: '1 1 200px' }}>Röst
                    <select name="ai_voice" value={aiVoice} onChange={(e) => setAiVoice(e.target.value)} disabled={!!busy}>
                      {ai.voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                  </label>
                  <label className="field" style={{ flex: '3 1 320px' }}>Stil
                    <input type="text" name="ai_style" value={aiStyle} onChange={(e) => setAiStyle(e.target.value)} disabled={!!busy} />
                  </label>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn-primary btn-sm" type="button" onClick={onGenerate} disabled={!!busy || !aiText.trim() || !!ai.blocked}>
                    {current ? 'Skapa ny AI-röst' : 'Skapa AI-röst'}
                  </button>
                  <span className="hint small muted">Google Gemini TTS. Lyssna i spelaren ovan när den är klar och skapa om vid behov.</span>
                </div>
                {aiRun && <AiProgress start={aiRun.start} estimate={aiRun.estimate} />}
                {aiDone && !aiRun && <span className="small ai-done" role="status">{aiDone}</span>}
                {ai.quota && <span className="small ai-quota">{ai.quota}</span>}
                {ai.blocked && <p className="error" style={{ margin: 0 }}>{ai.blocked}</p>}
              </div>
            </details>
          )}
          <span className="hint small muted">MP3, M4A, AAC eller WAV, högst 50 MB. MP3 eller M4A rekommenderas (mindre filer, spelas överallt).</span>
          {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
        </>
      )}
    </div>
  );
}
