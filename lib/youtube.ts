// Tolkar en YouTube-länk: youtube.com/watch?v=…, youtu.be/…, /embed/…, /shorts/…, /live/… eller bara video-ID:t.
export function parseYouTube(input: string) {
  const s = input.trim();
  if (!s) return null;
  if (/^[\w-]{11}$/.test(s)) return { youtube_id: s };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v') ?? /^\/(?:embed|shorts|live|v)\/([\w-]{11})/.exec(url.pathname)?.[1] ?? null;
  }
  return id && /^[\w-]{11}$/.test(id) ? { youtube_id: id } : null;
}

// Inbäddning via youtube-nocookie.com (inga spårningskakor förrän eleven spelar upp), utan relaterade videor
// från andra kanaler. enablejsapi behövs för att mäta hur mycket som setts.
export function youtubeEmbedUrl(id: string, origin?: string) {
  const p = new URLSearchParams({ enablejsapi: '1', rel: '0', modestbranding: '1', playsinline: '1', hl: 'sv' });
  if (origin) p.set('origin', origin);
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${p}`;
}
