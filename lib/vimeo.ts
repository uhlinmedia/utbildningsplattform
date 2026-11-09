// Tolkar en Vimeo-länk, även olistade videor med hash (vimeo.com/123/abc eller ?h=abc).
export function parseVimeo(input: string) {
  const m = /vimeo\.com\/(?:video\/)?(\d+)(?:\/([0-9a-f]+))?/i.exec(input) ?? /^(\d+)$/.exec(input.trim());
  if (!m) return null;
  const h = /[?&]h=([0-9a-f]+)/i.exec(input)?.[1] ?? m[2];
  return { vimeo_id: m[1], vimeo_hash: h };
}

// Inbäddning utan spårning (dnt=1).
export function vimeoEmbedUrl(id: string, hash?: string) {
  const p = new URLSearchParams({ dnt: '1', title: '0', byline: '0', portrait: '0' });
  if (hash) p.set('h', hash);
  return `https://player.vimeo.com/video/${encodeURIComponent(id)}?${p}`;
}
