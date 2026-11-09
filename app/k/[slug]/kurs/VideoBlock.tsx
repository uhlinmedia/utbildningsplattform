'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { reportVideo } from '../../actions';

// Bäddar in Vimeo och rapporterar hur stor andel som setts (högsta tidpunkt, inte spoling framåt).
export function VideoBlock(props: {
  slug: string;
  blockId: string;
  src: string;
  title: string;
  required: number;
  initialPercent: number;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const router = useRouter();
  const [percent, setPercent] = useState(props.initialPercent);

  useEffect(() => {
    if (!ref.current) return;
    let player: import('@vimeo/player').default | null = null;
    let watched = 0; // sekunder sedda i följd
    let lastTime = 0;
    let reported = props.initialPercent;
    let cancelled = false;
    (async () => {
      const Player = (await import('@vimeo/player')).default;
      if (cancelled || !ref.current) return;
      player = new Player(ref.current);
      player.on('timeupdate', (d: { seconds: number; duration: number }) => {
        // Räkna bara tid som faktiskt spelats (små steg), så att spola framåt inte ger kredit.
        if (d.seconds > lastTime && d.seconds - lastTime < 2) watched += d.seconds - lastTime;
        lastTime = d.seconds;
        const p = Math.min(100, Math.round((watched / d.duration) * 100));
        if (p >= reported + 5 || (p >= 100 && reported < 100)) {
          reported = p;
          setPercent((cur) => Math.max(cur, p));
          reportVideo(props.slug, props.blockId, p).then(() => {
            if (props.required && p >= props.required) router.refresh();
          });
        }
      });
      player.on('seeked', (d: { seconds: number }) => {
        lastTime = d.seconds;
      });
    })();
    return () => {
      cancelled = true;
      player?.destroy().catch(() => {});
    };
  }, [props.slug, props.blockId, props.initialPercent, props.required, router]);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="video-wrap">
        <iframe ref={ref} src={props.src} title={props.title || 'Video'} allow="fullscreen; picture-in-picture" allowFullScreen />
      </div>
      {props.required > 0 && (
        <p className="small muted" style={{ margin: 0 }} aria-live="polite">
          {percent >= props.required
            ? 'Videon är sedd – du kan gå vidare.'
            : `Se minst ${props.required} % av videon för att gå vidare (sett: ${percent} %).`}
        </p>
      )}
    </div>
  );
}
