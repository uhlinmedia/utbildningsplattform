'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { reportVideo } from '../../actions';
import { subscribeNarration } from './SectionAudio';

// Bildspel: en bild i taget med pilar, tangentbord (← →), svep på mobil och helskärm.
// Kan kräva att eleven bläddrat igenom alla bilder; andelen sparas som "sett" (samma tabell som video).
export function SlidesBlock(props: {
  slug: string;
  blockId: string;
  slides: { src: string; alt: string }[];
  title: string;
  caption: string;
  requireAll: boolean;
  initialPercent: number;
  // Tid (sekunder) i speakerrösten per bild; null = ingen markering. Saknas helt = bildspelet följer inte ljudet.
  cues?: (number | null)[];
}) {
  const { slug, blockId, slides, requireAll } = props;
  const n = slides.length;
  const router = useRouter();
  const [i, setI] = useState(0);
  const [full, setFull] = useState(false);
  const [percent, setPercent] = useState(props.initialPercent);
  const box = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set<number>([0]));
  const reported = useRef(props.initialPercent);
  const touchX = useRef<number | null>(null);

  const go = useCallback((to: number) => setI(Math.max(0, Math.min(n - 1, to))), [n]);

  // Räkna hur stor andel av bilderna som visats och rapportera när det ökat.
  useEffect(() => {
    seen.current.add(i);
    const p = Math.round((seen.current.size / n) * 100);
    if (p > reported.current && (p >= 100 || p >= reported.current + 10 || requireAll)) {
      reported.current = p;
      setPercent((cur) => Math.max(cur, p));
      reportVideo(slug, blockId, p).then(() => {
        if (requireAll && p >= 100) router.refresh();
      });
    }
  }, [i, n, slug, blockId, requireAll, router]);

  // Följ speakerrösten: när ljudet passerar en bilds tid visas bilden. Bläddrar eleven själv får hen
  // titta i fred tills nästa markering passeras. Spolar eleven i ljudet hoppar bildspelet till rätt bild.
  const cues = props.cues;
  const follows = !!cues && cues.some((c) => typeof c === 'number');
  useEffect(() => {
    if (!follows || !cues) return;
    const marks = cues
      .map((at, idx) => ({ at: idx === 0 && at == null ? 0 : at, idx }))
      .filter((m): m is { at: number; idx: number } => typeof m.at === 'number')
      .sort((x, y) => x.at - y.at);
    const target = (t: number) => {
      let found = -1;
      for (const m of marks) if (m.at <= t + 0.05) found = m.idx;
      return found;
    };
    let last = -2;
    return subscribeNarration((t, kind) => {
      const tgt = target(t);
      if (tgt < 0) return;
      if (kind === 'seek' || tgt !== last) {
        if (tgt !== last || kind === 'seek') go(tgt);
        last = tgt;
      }
    });
  }, [follows, cues, go]);

  // Förladda nästa bild så att bläddring går direkt.
  useEffect(() => {
    if (i + 1 < n) { const img = new Image(); img.src = slides[i + 1].src; }
  }, [i, n, slides]);

  // Helskärm: webbläsarens helskärm där den finns (även med webkit-prefix, t.ex. iPad).
  // iPhone tillåter bara helskärm för video – där fyller bildspelet i stället hela fönstret (pseudo).
  const [pseudo, setPseudo] = useState(false);
  useEffect(() => {
    const doc = document as Document & { webkitFullscreenElement?: Element | null };
    const onFs = () => setFull((document.fullscreenElement ?? doc.webkitFullscreenElement) === box.current);
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('webkitfullscreenchange', onFs);
    };
  }, []);

  useEffect(() => {
    if (!pseudo) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPseudo(false); };
    window.addEventListener('keydown', onKey);
    box.current?.focus();
    return () => { html.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [pseudo]);

  const isFull = full || pseudo;

  const toggleFull = () => {
    const doc = document as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
    if (pseudo) { setPseudo(false); return; }
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
      else doc.webkitExitFullscreen?.();
      return;
    }
    const el = box.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    if (!el) return;
    if (el.requestFullscreen && document.fullscreenEnabled) {
      el.requestFullscreen().catch(() => setPseudo(true));
    } else if (el.webkitRequestFullscreen && (doc as { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled) {
      el.webkitRequestFullscreen();
    } else {
      setPseudo(true);
    }
  };

  if (n === 0) return null;
  const s = slides[i];

  return (
    <figure className="slides" style={{ margin: 0 }} aria-roledescription="bildspel" aria-label={props.title || 'Bildspel'}>
      <div
        ref={box}
        className={`slides-stage${isFull ? ' is-full' : ''}${pseudo ? ' is-pseudo' : ''}`}
        role={pseudo ? 'dialog' : undefined}
        aria-modal={pseudo ? true : undefined}
        aria-label={pseudo ? 'Bildspel i helskärm' : undefined}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(i + 1); }
          else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(i - 1); }
          else if (e.key === 'Home') { e.preventDefault(); go(0); }
          else if (e.key === 'End') { e.preventDefault(); go(n - 1); }
        }}
        onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touchX.current === null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          touchX.current = null;
          if (Math.abs(dx) > 40) go(dx < 0 ? i + 1 : i - 1);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={s.src} src={s.src} alt={s.alt || `Bild ${i + 1} av ${n}`} draggable={false} />
        {isFull && <span className="slides-badge" aria-hidden="true">{i + 1} / {n}</span>}
        {isFull && (
          <button type="button" className="slides-close" onClick={toggleFull} aria-label="Stäng helskärm">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        )}
        <button type="button" className="slides-arrow prev" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Föregående bild">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <button type="button" className="slides-arrow next" onClick={() => go(i + 1)} disabled={i === n - 1} aria-label="Nästa bild">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
      <div className="slides-bar">
        <span className="slides-count" aria-live="polite">Bild {i + 1} av {n}</span>
        {n > 1 && n <= 40 && (
          <div className="slides-dots" role="group" aria-label="Gå till bild">
            {slides.map((_, k) => (
              <button
                key={k}
                type="button"
                className={k === i ? 'on' : seen.current.has(k) ? 'seen' : ''}
                onClick={() => go(k)}
                aria-label={`Bild ${k + 1}`}
                aria-current={k === i ? 'true' : undefined}
              />
            ))}
          </div>
        )}
        <button type="button" className="btn btn-sm slides-full" onClick={toggleFull} aria-pressed={isFull}>
          {isFull ? 'Stäng helskärm' : 'Helskärm'}
        </button>
      </div>
      {props.caption && <figcaption className="small muted">{props.caption}</figcaption>}
      {follows && <p className="small muted" style={{ margin: 0 }}>Bilderna byts i takt med speakerrösten.</p>}
      {requireAll && (
        <p className="small muted" style={{ margin: 0 }}>
          {percent >= 100 ? 'Alla bilder är visade – du kan gå vidare.' : `Bläddra igenom alla bilder för att gå vidare (${Math.round((percent / 100) * n)} av ${n} visade).`}
        </p>
      )}
    </figure>
  );
}
