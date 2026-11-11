'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { reportVideo } from '../../actions';

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

  // Förladda nästa bild så att bläddring går direkt.
  useEffect(() => {
    if (i + 1 < n) { const img = new Image(); img.src = slides[i + 1].src; }
  }, [i, n, slides]);

  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else box.current?.requestFullscreen?.().catch(() => {});
  };

  if (n === 0) return null;
  const s = slides[i];

  return (
    <figure className="slides" style={{ margin: 0 }} aria-roledescription="bildspel" aria-label={props.title || 'Bildspel'}>
      <div
        ref={box}
        className={`slides-stage${full ? ' is-full' : ''}`}
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
        {full && <span className="slides-badge" aria-hidden="true">{i + 1} / {n}</span>}
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
        <button type="button" className="btn btn-sm slides-full" onClick={toggleFull} aria-pressed={full}>
          {full ? 'Stäng helskärm' : 'Helskärm'}
        </button>
      </div>
      {props.caption && <figcaption className="small muted">{props.caption}</figcaption>}
      {requireAll && (
        <p className="small muted" style={{ margin: 0 }}>
          {percent >= 100 ? 'Alla bilder är visade – du kan gå vidare.' : `Bläddra igenom alla bilder för att gå vidare (${Math.round((percent / 100) * n)} av ${n} visade).`}
        </p>
      )}
    </figure>
  );
}
