'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { reportVideo } from '../../actions';

type YTPlayer = { getCurrentTime(): number; getDuration(): number; getPlayerState(): number; destroy(): void };
type YTNamespace = {
  Player: new (el: HTMLIFrameElement, opts: { events: Record<string, (e: { data: number }) => void> }) => YTPlayer;
  PlayerState: { PLAYING: number };
};
declare global {
  interface Window { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void }
}

// Laddar YouTubes IFrame-API en gång, först när en YouTube-video finns på sidan.
let ytApi: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  ytApi ??= new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT!); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => { ytApi = null; reject(new Error('YouTube kunde inte laddas')); };
    document.head.appendChild(s);
  });
  return ytApi;
}

// Bäddar in Vimeo eller YouTube och rapporterar hur stor andel som setts
// (tid som faktiskt spelats, inte spolning framåt).
export function VideoBlock(props: {
  slug: string;
  blockId: string;
  provider: 'vimeo' | 'youtube';
  src: string;
  title: string;
  required: number;
  initialPercent: number;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const router = useRouter();
  const [percent, setPercent] = useState(props.initialPercent);
  const { slug, blockId, provider } = props;
  // Värden som ändras när sidan laddas om (router.refresh) läses via ref, så att spelaren inte
  // byggs om mitt i uppspelningen. Vimeos destroy() tar bort videon ur sidan – då stannade den.
  const live = useRef({ initialPercent: props.initialPercent, required: props.required, router });
  live.current = { initialPercent: props.initialPercent, required: props.required, router };

  useEffect(() => {
    if (!ref.current) return;
    let watched = 0; // sekunder som spelats
    let lastTime = 0;
    let reported = live.current.initialPercent;
    let cancelled = false;

    // Räkna bara små steg framåt, så att spola framåt inte ger kredit.
    const onTime = (seconds: number, duration: number) => {
      if (!duration) return;
      if (seconds > lastTime && seconds - lastTime < 2) watched += seconds - lastTime;
      lastTime = seconds;
      const p = Math.min(100, Math.round((watched / duration) * 100));
      if (p >= reported + 5 || (p >= 100 && reported < 100) || (live.current.required > 0 && p >= live.current.required && reported < live.current.required)) {
        const before = reported;
        reported = p;
        setPercent((cur) => Math.max(cur, p));
        const { required, router } = live.current;
        const crossed = required > 0 && p >= required && before < required;
        reportVideo(slug, blockId, p).then(() => {
          // Ladda om sidan en gång när kravet uppnås, så att Nästa låses upp. Videon fortsätter spela.
          if (crossed) router.refresh();
        });
      }
    };

    let cleanup = () => {};
    if (provider === 'vimeo') {
      let player: import('@vimeo/player').default | null = null;
      (async () => {
        const Player = (await import('@vimeo/player')).default;
        if (cancelled || !ref.current) return;
        player = new Player(ref.current);
        player.on('timeupdate', (d: { seconds: number; duration: number }) => onTime(d.seconds, d.duration));
        player.on('seeked', (d: { seconds: number }) => { lastTime = d.seconds; });
      })();
      cleanup = () => { player?.destroy().catch(() => {}); };
    } else {
      // YouTube har ingen tidshändelse – läs av tiden varje halv sekund medan videon spelas.
      let player: YTPlayer | null = null;
      let timer: ReturnType<typeof setInterval> | undefined;
      loadYouTubeApi().then((YT) => {
        if (cancelled || !ref.current) return;
        player = new YT.Player(ref.current, {
          events: {
            onStateChange: (e) => {
              clearInterval(timer);
              if (e.data === YT.PlayerState.PLAYING) {
                lastTime = player!.getCurrentTime();
                timer = setInterval(() => player && onTime(player.getCurrentTime(), player.getDuration()), 500);
              }
            },
          },
        });
      }).catch(() => {});
      cleanup = () => { clearInterval(timer); };
    }
    return () => { cancelled = true; cleanup(); };
  }, [slug, blockId, provider]);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="video-wrap">
        <iframe
          ref={ref}
          src={props.src}
          title={props.title || 'Video'}
          allow="fullscreen; picture-in-picture; encrypted-media"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
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
