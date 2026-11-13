import 'server-only';
import { randomUUID } from 'node:crypto';

// Speakerröst per avsnitt. Filerna ligger i Supabase Storage, inte i databasen:
// Vercel stoppar svar över ca 4,5 MB, och Safari spelar bara ljud från servrar som stöder Range.
// Webbläsaren laddar upp direkt till Storage via en tillfällig länk; eleven spelar från Supabases CDN.

export const AUDIO_BUCKET = 'avsnittsljud';
export const AUDIO_MAX_BYTES = 50 * 1024 * 1024;
export const AUDIO_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
};
const PATH_RE = /^[0-9a-f-]{36}\.(mp3|m4a|aac|wav)$/;

function env() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return url && key ? { url, key } : null;
}

export const audioConfigured = () => env() !== null;

function auth(key: string): Record<string, string> {
  // Äldre service_role-nycklar är JWT och skickas även som Bearer; nya "sb_secret_…" bara som apikey.
  return key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
}

export function isAudioPath(path: unknown): path is string {
  return typeof path === 'string' && PATH_RE.test(path);
}

export function audioUrl(path: string) {
  const e = env();
  return e && isAudioPath(path) ? `${e.url}/storage/v1/object/public/${AUDIO_BUCKET}/${path}` : null;
}

export function extOf(filename: string) {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  return ext in AUDIO_EXT ? ext : null;
}

// Tillfällig uppladdningslänk (gäller i två timmar) för en ny fil.
export async function createUploadUrl(ext: string) {
  const e = env();
  if (!e) throw new Error('Ljud är inte inställt: SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY saknas.');
  const path = `${randomUUID()}.${ext}`;
  const res = await fetch(`${e.url}/storage/v1/object/upload/sign/${AUDIO_BUCKET}/${path}`, {
    method: 'POST',
    headers: { ...auth(e.key), 'Content-Type': 'application/json' },
    body: '{}',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Supabase Storage svarade ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { url?: string };
  if (!data.url) throw new Error('Supabase Storage gav ingen uppladdningslänk.');
  return { path, uploadUrl: `${e.url}/storage/v1${data.url}` };
}

// Kontrollerar att filen finns och returnerar storlek och typ.
export async function audioInfo(path: string) {
  const url = audioUrl(path);
  if (!url) return null;
  const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
  if (!res.ok) return null;
  return { size: Number(res.headers.get('content-length')) || 0, mime: res.headers.get('content-type') ?? '' };
}

// Tar bort filer. Fel loggas men stoppar inget (en kvarglömd fil är ofarlig).
export async function removeAudio(paths: (string | null | undefined)[]) {
  const e = env();
  const list = paths.filter(isAudioPath);
  if (!e || list.length === 0) return;
  try {
    const res = await fetch(`${e.url}/storage/v1/object/${AUDIO_BUCKET}`, {
      method: 'DELETE',
      headers: { ...auth(e.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: list }),
      cache: 'no-store',
    });
    if (!res.ok) console.error('Kunde inte ta bort ljudfiler', res.status, await res.text());
  } catch (err) {
    console.error('Kunde inte ta bort ljudfiler', err);
  }
}

// Kopierar en fil (vid kopiering av en utbildning) och returnerar den nya sökvägen, eller null.
export async function copyAudio(path: string) {
  const e = env();
  if (!e || !isAudioPath(path)) return null;
  const dest = `${randomUUID()}.${path.split('.').pop()}`;
  try {
    const res = await fetch(`${e.url}/storage/v1/object/copy`, {
      method: 'POST',
      headers: { ...auth(e.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucketId: AUDIO_BUCKET, sourceKey: path, destinationKey: dest }),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error('Kunde inte kopiera ljudfil', res.status, await res.text());
      return null;
    }
    return dest;
  } catch (err) {
    console.error('Kunde inte kopiera ljudfil', err);
    return null;
  }
}
