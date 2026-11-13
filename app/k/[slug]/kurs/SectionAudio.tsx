'use client';

import { useEffect, useRef, useState } from 'react';

const SPEEDS = [0.75, 1, 1.25, 1.5];
// 25 ms tystnad. Spelas vid elevens första tryck så att iPhone/Safari "låser upp" spelaren.
const SILENCE = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YZABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* privat läge m.m. */ } },
};

// En enda ljudspelare för hela besöket. Den flyttas in i varje avsnitt i stället för att skapas på nytt,
// eftersom iPhone bara låter en spelare som eleven själv har startat en gång spela upp ljud automatiskt.
let shared: HTMLAudioElement | null = null;
let unlocked = false;
let currentSrc = '';

function player() {
  if (!shared) {
    shared = document.createElement('audio');
    shared.controls = true;
    shared.preload = 'metadata';
    shared.style.width = '100%';
    shared.setAttribute('aria-label', 'Speakerröst');
  }
  return shared;
}

// Lyssnar efter elevens första tryck eller tangent och låser då upp spelaren genom att spela en kort
// tystnad (gäller resten av besöket). Görs bara när spelaren inte har något avsnittsljud laddat; i ett
// avsnitt med ljud är elevens tryck på spela-knappen i sig det som låser upp.
export function AudioUnlock() {
  useEffect(() => {
    if (unlocked) return;
    const events = ['click', 'touchend', 'keydown'] as const;
    const remove = () => events.forEach((e) => document.removeEventListener(e, unlock, true));
    function unlock() {
      if (unlocked) return remove();
      const a = player();
      if (currentSrc) return; // ett avsnittsljud är laddat – låt eleven starta det själv
      a.src = SILENCE;
      a.play().then(() => { unlocked = true; a.pause(); remove(); }).catch(() => {});
    }
    events.forEach((e) => document.addEventListener(e, unlock, true));
    return remove;
  }, []);
  return null;
}

// Speakerröst överst i avsnittet. Kommer ihåg var eleven var och vald hastighet (bara i den här webbläsaren).
// Med autoplay startar ljudet direkt, om eleven inte redan har lyssnat klart på avsnittet.
export function SectionAudio({
  sectionId, src, durationS, autoplay = false,
}: { sectionId: string; src: string; durationS: number | null; autoplay?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [speed, setSpeed] = useState(1);
  const [blocked, setBlocked] = useState(false);
  const posKey = `briondo-ljud-${sectionId}`;
  const doneKey = `briondo-ljud-klar-${sectionId}`;

  useEffect(() => {
    const a = player();
    host.current?.appendChild(a);
    const saved = Number(store.get('briondo-ljud-hastighet'));
    const rate = SPEEDS.includes(saved) ? saved : 1;
    setSpeed(rate);

    let last = 0;
    const save = () => {
      if (Math.abs(a.currentTime - last) < 3) return;
      last = a.currentTime;
      store.set(posKey, String(Math.floor(a.currentTime)));
    };
    const ended = () => { store.set(posKey, '0'); store.set(doneKey, '1'); };
    const playing = () => { unlocked = true; setBlocked(false); };
    const start = () => {
      const pos = Number(store.get(posKey));
      // Börja om från början om man lyssnat klart (eller nästan).
      if (pos > 2 && Number.isFinite(a.duration) && pos < a.duration - 3) a.currentTime = pos;
      a.playbackRate = rate;
      if (autoplay && store.get(doneKey) !== '1') {
        a.play().catch(() => setBlocked(true));
      }
    };
    a.addEventListener('timeupdate', save);
    a.addEventListener('pause', save);
    a.addEventListener('ended', ended);
    a.addEventListener('playing', playing);
    if (currentSrc !== src) {
      currentSrc = src;
      a.src = src;
      a.addEventListener('loadedmetadata', start, { once: true });
      a.load();
    } else if (a.readyState >= 1) {
      start();
    } else {
      a.addEventListener('loadedmetadata', start, { once: true });
    }
    return () => {
      a.removeEventListener('timeupdate', save);
      a.removeEventListener('pause', save);
      a.removeEventListener('ended', ended);
      a.removeEventListener('playing', playing);
      a.removeEventListener('loadedmetadata', start);
      save();
      a.pause();
      a.remove();
      // Utan avsnittsljud kan nästa tryck låsa upp spelaren med tystnad.
      if (!unlocked) currentSrc = '';
    };
  }, [src, posKey, doneKey, autoplay]);

  function pickSpeed(v: number) {
    setSpeed(v);
    player().playbackRate = v;
    store.set('briondo-ljud-hastighet', String(v));
  }

  function tapToPlay() {
    player().play().then(() => setBlocked(false)).catch(() => setBlocked(true));
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
      {blocked && (
        <button type="button" className="btn btn-primary section-audio-tap" onClick={tapToPlay}>
          ▶ Tryck för att lyssna
        </button>
      )}
      <div ref={host} />
    </section>
  );
}
