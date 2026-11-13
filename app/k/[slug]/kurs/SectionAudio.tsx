'use client';

import { useEffect, useRef, useState } from 'react';

const SPEEDS = [0.75, 1, 1.25, 1.5];
const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* privat läge m.m. */ } },
};

// Speakerröst överst i avsnittet. Kommer ihåg var eleven var och vald hastighet (bara i den här webbläsaren).
export function SectionAudio({ sectionId, src, durationS }: { sectionId: string; src: string; durationS: number | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [speed, setSpeed] = useState(1);
  const posKey = `briondo-ljud-${sectionId}`;

  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    const saved = Number(store.get('briondo-ljud-hastighet'));
    if (SPEEDS.includes(saved)) { a.playbackRate = saved; setSpeed(saved); }
    const resume = () => {
      const pos = Number(store.get(posKey));
      // Börja om från början om man lyssnat klart (eller nästan).
      if (pos > 2 && Number.isFinite(a.duration) && pos < a.duration - 3) a.currentTime = pos;
    };
    let last = 0;
    const save = () => {
      if (Math.abs(a.currentTime - last) < 3) return;
      last = a.currentTime;
      store.set(posKey, String(Math.floor(a.currentTime)));
    };
    const ended = () => store.set(posKey, '0');
    a.addEventListener('loadedmetadata', resume, { once: true });
    a.addEventListener('timeupdate', save);
    a.addEventListener('pause', save);
    a.addEventListener('ended', ended);
    if (a.readyState >= 1) resume();
    return () => {
      a.removeEventListener('timeupdate', save);
      a.removeEventListener('pause', save);
      a.removeEventListener('ended', ended);
    };
  }, [posKey]);

  function pickSpeed(v: number) {
    setSpeed(v);
    if (ref.current) ref.current.playbackRate = v;
    store.set('briondo-ljud-hastighet', String(v));
  }

  const mins = durationS ? `${Math.floor(durationS / 60)}:${String(durationS % 60).padStart(2, '0')}` : null;

  return (
    <section className="section-audio" aria-label="Lyssna på avsnittet">
      <div className="row between" style={{ gap: 8 }}>
        <span className="section-audio-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5a10 10 0 0 1 0 14" />
          </svg>
          Lyssna på avsnittet{mins && <span className="muted" style={{ fontWeight: 400 }}> · {mins}</span>}
        </span>
        <div className="row" style={{ gap: 4 }} role="group" aria-label="Uppspelningshastighet">
          {SPEEDS.map((v) => (
            <button
              key={v}
              type="button"
              className={`btn btn-sm speed ${speed === v ? 'btn-dark' : ''}`}
              aria-pressed={speed === v}
              onClick={() => pickSpeed(v)}
            >
              {String(v).replace('.', ',')}×
            </button>
          ))}
        </div>
      </div>
      <audio ref={ref} controls preload="metadata" src={src} style={{ width: '100%' }}>
        Din webbläsare kan inte spela upp ljudet.
      </audio>
    </section>
  );
}
