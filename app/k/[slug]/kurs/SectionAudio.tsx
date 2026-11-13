'use client';

import { useEffect, useRef, useState } from 'react';

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

// Låter t.ex. bildspel följa speakerrösten. kind = 'play' när ljudet spelar framåt, 'seek' när eleven
// (eller sparad position) spolar. Anropas inte för den korta tystnaden som låser upp spelaren.
export function subscribeNarration(cb: (time: number, kind: 'play' | 'seek') => void): () => void {
  const a = player();
  const onTime = () => { if (!a.paused && a.src !== SILENCE) cb(a.currentTime, 'play'); };
  const onSeek = () => { if (a.src !== SILENCE) cb(a.currentTime, 'seek'); };
  a.addEventListener('timeupdate', onTime);
  a.addEventListener('seeked', onSeek);
  return () => { a.removeEventListener('timeupdate', onTime); a.removeEventListener('seeked', onSeek); };
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

// Speakerröst överst i avsnittet. Kommer ihåg var eleven var och hastigheten eleven valt i spelarens meny
// (bara i den här webbläsaren).
// Med autoplay startar ljudet direkt, om eleven inte redan har lyssnat klart på avsnittet.
export function SectionAudio({
  sectionId, src, durationS, autoplay = false, lightButton = false,
}: { sectionId: string; src: string; durationS: number | null; autoplay?: boolean; lightButton?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [blocked, setBlocked] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [open, setOpen] = useState(false);
  // Mobil: fliken (spela/pausa, kugghjul) visas en stund efter tryck på knappen.
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function showTab() {
    setPeek(true);
    clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek(false), 3000);
  }
  useEffect(() => () => clearTimeout(peekTimer.current), []);
  const posKey = `briondo-ljud-${sectionId}`;
  const doneKey = `briondo-ljud-klar-${sectionId}`;

  useEffect(() => {
    const a = player();
    host.current?.appendChild(a);
    const saved = Number(store.get('briondo-ljud-hastighet'));
    const rate = saved >= 0.25 && saved <= 4 ? saved : 1;
    // defaultPlaybackRate behålls när en ny fil laddas (playbackRate nollställs annars till 1).
    a.defaultPlaybackRate = rate;
    a.playbackRate = rate;

    let last = 0;
    const save = () => {
      if (Math.abs(a.currentTime - last) < 3) return;
      last = a.currentTime;
      store.set(posKey, String(Math.floor(a.currentTime)));
    };
    const ended = () => { store.set(posKey, '0'); store.set(doneKey, '1'); };
    const playing = () => { unlocked = true; setBlocked(false); setPlaying(true); };
    const stopped = () => setPlaying(false);
    setPlaying(!a.paused && !a.ended);
    const rateChanged = () => {
      if (a.src === SILENCE || a.readyState < 1) return; // inte vid laddning av ny fil
      a.defaultPlaybackRate = a.playbackRate;
      store.set('briondo-ljud-hastighet', String(a.playbackRate));
    };
    const start = () => {
      const pos = Number(store.get(posKey));
      // Börja om från början om man lyssnat klart (eller nästan).
      if (pos > 2 && Number.isFinite(a.duration) && pos < a.duration - 3) a.currentTime = pos;
      a.playbackRate = rate;
      if (wantsAutoplay) {
        a.play().catch(() => setBlocked(true));
      }
    };
    // Safari m.fl. stoppar autoplay utan att alltid säga ifrån (play() kan bli hängande, eller så laddas
    // inte ljudet förrän eleven trycker). Spelar det inte efter en stund visas "Tryck för att lyssna".
    // Safari på Mac kan dessutom låta spelaren stå i läget "spelar" utan att något hörs, så vi tittar på om
    // tiden faktiskt går framåt i stället för att lita på a.paused.
    const wantsAutoplay = autoplay && store.get(doneKey) !== '1';
    // "Spelar på riktigt" = tiden har gått framåt i små steg (en spolning till sparad position räknas inte).
    let lastT = -1;
    let progressed = false;
    const tick = () => {
      const d = a.currentTime - lastT;
      if (lastT >= 0 && !a.paused && d > 0 && d < 1.5) progressed = true;
      lastT = a.currentTime;
    };
    if (wantsAutoplay) a.addEventListener('timeupdate', tick);
    const watchdog = wantsAutoplay ? setTimeout(() => {
      a.removeEventListener('timeupdate', tick);
      if (progressed) return;
      if (!a.paused) a.pause(); // nollställ så att elevens tryck startar ljudet
      setPlaying(false);
      setBlocked(true);
    }, 2000) : undefined;
    a.addEventListener('timeupdate', save);
    a.addEventListener('pause', save);
    a.addEventListener('ended', ended);
    a.addEventListener('playing', playing);
    a.addEventListener('pause', stopped);
    a.addEventListener('ended', stopped);
    a.addEventListener('ratechange', rateChanged);
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
      clearTimeout(watchdog);
      a.removeEventListener('timeupdate', tick);
      a.removeEventListener('timeupdate', save);
      a.removeEventListener('pause', save);
      a.removeEventListener('ended', ended);
      a.removeEventListener('playing', playing);
      a.removeEventListener('pause', stopped);
      a.removeEventListener('ended', stopped);
      a.removeEventListener('ratechange', rateChanged);
      a.removeEventListener('loadedmetadata', start);
      save();
      a.pause();
      a.remove();
      // Utan avsnittsljud kan nästa tryck låsa upp spelaren med tystnad.
      if (!unlocked) currentSrc = '';
    };
  }, [src, posKey, doneKey, autoplay]);

  function toggle() {
    const a = player();
    if (a.paused || a.ended) {
      a.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
    } else {
      a.pause();
    }
  }

  // Esc stänger den utfällda spelaren.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const mins = durationS ? `${Math.floor(durationS / 60)}:${String(durationS % 60).padStart(2, '0')}` : null;
  const label = playing ? 'Pausa speakerrösten' : 'Lyssna på avsnittet';

  // Minimerad spelare i nedre högra hörnet: stor knapp spelar/pausar, fliken bredvid har
  // spela/pausa och kugghjul som fäller ut hela spelaren (spola, hastighet, volym).
  return (
    <section className={`audio-mini${playing ? ' is-playing' : ''}${open ? ' is-open' : ''}${blocked && !playing ? ' is-waiting' : ''}${peek ? ' is-peek' : ''}${lightButton ? ' is-light' : ''}`} aria-label="Speakerröst">
      <div className="audio-mini-panel" hidden={!open}>
        <div className="row between" style={{ gap: 8 }}>
          <span className="section-audio-title">
            Lyssna på avsnittet{mins && <span className="muted" style={{ fontWeight: 400 }}> · {mins}</span>}
          </span>
          <button type="button" className="audio-mini-close" onClick={() => setOpen(false)} aria-label="Stäng spelaren">×</button>
        </div>
        <div ref={host} />
      </div>

      {blocked && !playing && !open && (
        <button type="button" className="audio-mini-hint" onClick={toggle}>Tryck för att lyssna</button>
      )}

      <div className="audio-mini-dock">
        <button type="button" className="audio-mini-btn" onClick={() => { toggle(); showTab(); }} aria-label={label} title={label} aria-pressed={playing}>
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" transform={playing ? undefined : 'translate(4 0)'} />
            {playing && (
              <>
                <path className="wave wave-1" d="M15.5 8.5a5 5 0 0 1 0 7" />
                <path className="wave wave-2" d="M18.5 5.5a9.5 9.5 0 0 1 0 13" />
              </>
            )}
          </svg>
        </button>
        <div className="audio-mini-tab">
          <button type="button" onClick={() => { toggle(); showTab(); }} aria-label={label} title={label}>
            {playing ? (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.5" /><rect x="14" y="5" width="4" height="14" rx="1.5" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" /></svg>
            )}
          </button>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Dölj spelaren' : 'Visa hela spelaren'} title={open ? 'Dölj spelaren' : 'Visa hela spelaren'} aria-expanded={open}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          </button>
        </div>
      </div>
    </section>
  );
}
