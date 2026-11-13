import 'server-only';
import { Mp3Encoder } from '@breezystack/lamejs';

// AI-uppläsning med Google Gemini TTS (Gemini API, Interactions). Rösten skapas en gång i editorn och
// sparas som MP3 i samma lagring som inspelade speakerröster. Nyckeln GEMINI_API_KEY ska höra till ett
// projekt med betalning (betalnivån: texten används inte för att förbättra Googles produkter).

export const TTS_MODEL = 'gemini-3.8-flash-tts';
const SAMPLE_RATE = 24000;
const CHUNK_CHARS = 3000; // ca 3–4 minuter tal per anrop, väl under modellens gränser
export const TTS_MAX_CHARS = 30000;

// Googles 30 färdiga röster med deras egen beskrivning, översatt.
export const TTS_VOICES: { id: string; label: string }[] = [
  { id: 'Kore', label: 'Kore – bestämd' },
  { id: 'Charon', label: 'Charon – informativ' },
  { id: 'Rasalgethi', label: 'Rasalgethi – informativ' },
  { id: 'Sadaltager', label: 'Sadaltager – kunnig' },
  { id: 'Iapetus', label: 'Iapetus – tydlig' },
  { id: 'Erinome', label: 'Erinome – tydlig' },
  { id: 'Schedar', label: 'Schedar – jämn' },
  { id: 'Sulafat', label: 'Sulafat – varm' },
  { id: 'Achird', label: 'Achird – vänlig' },
  { id: 'Vindemiatrix', label: 'Vindemiatrix – mild' },
  { id: 'Achernar', label: 'Achernar – mjuk' },
  { id: 'Algieba', label: 'Algieba – len' },
  { id: 'Despina', label: 'Despina – len' },
  { id: 'Gacrux', label: 'Gacrux – mogen' },
  { id: 'Orus', label: 'Orus – bestämd' },
  { id: 'Alnilam', label: 'Alnilam – bestämd' },
  { id: 'Callirrhoe', label: 'Callirrhoe – avslappnad' },
  { id: 'Umbriel', label: 'Umbriel – avslappnad' },
  { id: 'Zubenelgenubi', label: 'Zubenelgenubi – vardaglig' },
  { id: 'Aoede', label: 'Aoede – luftig' },
  { id: 'Zephyr', label: 'Zephyr – ljus' },
  { id: 'Autonoe', label: 'Autonoe – ljus' },
  { id: 'Puck', label: 'Puck – pigg' },
  { id: 'Laomedeia', label: 'Laomedeia – pigg' },
  { id: 'Sadachbia', label: 'Sadachbia – livlig' },
  { id: 'Pulcherrima', label: 'Pulcherrima – framåt' },
  { id: 'Leda', label: 'Leda – ungdomlig' },
  { id: 'Fenrir', label: 'Fenrir – entusiastisk' },
  { id: 'Enceladus', label: 'Enceladus – andig' },
  { id: 'Algenib', label: 'Algenib – raspig' },
];
export const TTS_DEFAULT_STYLE = 'Lugn, tydlig och vänlig utbildningsröst på svenska, i ett behagligt tempo.';

export const ttsConfigured = () => !!process.env.GEMINI_API_KEY?.trim();

// Delar texten i bitar vid stycken, och vid behov vid meningar, så att varje anrop blir lagom stort.
export function splitText(text: string, max = CHUNK_CHARS): string[] {
  const parts: string[] = [];
  let cur = '';
  const push = () => { if (cur.trim()) parts.push(cur.trim()); cur = ''; };
  for (const para of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const p = para.trim();
    if (!p) continue;
    if (cur && cur.length + p.length + 2 > max) push();
    if (p.length <= max) { cur = cur ? `${cur}\n\n${p}` : p; continue; }
    push();
    for (const sentence of p.match(/[^.!?…]+[.!?…]*\s*/g) ?? [p]) {
      if (cur.length + sentence.length > max) push();
      cur += sentence;
    }
  }
  push();
  return parts;
}

// Plockar ut PCM-data (16 bitar, mono) ur WAV. Saknas WAV-huvud tolkas allt som rå PCM.
function pcmFromAudio(buf: Buffer): Int16Array {
  let data = buf;
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
    let off = 12;
    data = Buffer.alloc(0);
    while (off + 8 <= buf.length) {
      const id = buf.toString('ascii', off, off + 4);
      const size = buf.readUInt32LE(off + 4);
      if (id === 'data') { data = buf.subarray(off + 8, Math.min(buf.length, off + 8 + size)); break; }
      off += 8 + size + (size % 2);
    }
  }
  const even = data.subarray(0, data.length - (data.length % 2));
  const out = new Int16Array(even.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = even.readInt16LE(i * 2);
  return out;
}

export class TtsError extends Error {}

async function synthesizeChunk(text: string, voice: string, style: string): Promise<Int16Array> {
  const base = (process.env.GEMINI_API_BASE?.trim() || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  const res = await fetch(`${base}/v1beta/interactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY!.trim() },
    body: JSON.stringify({
      model: TTS_MODEL,
      input: [{
        type: 'user_input',
        content: [{ type: 'text', text, annotations: style ? [{ type: 'speech_metadata', style }] : [] }],
      }],
      response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: SAMPLE_RATE },
      generation_config: { speech_config: [{ voice }] },
    }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    console.error('Gemini TTS svarade', res.status, body);
    if (res.status === 401 || res.status === 403) throw new TtsError('Google godtar inte API-nyckeln (GEMINI_API_KEY).');
    if (res.status === 429) throw new TtsError('Google säger att gränsen är nådd – för många anrop eller slut på saldo. Försök igen senare eller fyll på saldot i Google AI Studio.');
    throw new TtsError(`Google kunde inte skapa rösten (fel ${res.status}).`);
  }
  const json = (await res.json()) as { steps?: { type?: string; content?: { type?: string; data?: string }[] }[] };
  const audio = (json.steps ?? [])
    .filter((s) => s.type === 'model_output')
    .flatMap((s) => s.content ?? [])
    .filter((c) => c.type === 'audio' && c.data)
    .pop();
  if (!audio?.data) throw new TtsError('Google svarade utan ljud. Försök igen.');
  return pcmFromAudio(Buffer.from(audio.data, 'base64'));
}

// Skapar hela uppläsningen och returnerar MP3 och längd i sekunder.
export async function synthesize(text: string, voice: string, style: string): Promise<{ mp3: Buffer; durationS: number }> {
  const parts = splitText(text);
  if (parts.length === 0) throw new TtsError('Texten är tom.');
  const pause = new Int16Array(Math.round(SAMPLE_RATE * 0.35)); // kort paus mellan delarna
  // Upp till tre delar åt gången, så att långa avsnitt går snabbare men utan att belasta kvoten för hårt.
  const results: Int16Array[] = new Array(parts.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, parts.length) }, async () => {
    while (next < parts.length) {
      const i = next++;
      results[i] = await synthesizeChunk(parts[i], voice, style);
    }
  }));
  const pcm: Int16Array[] = results.flatMap((r, i) => (i > 0 ? [pause, r] : [r]));
  const total = pcm.reduce((n, p) => n + p.length, 0);
  if (total === 0) throw new TtsError('Google svarade utan ljud. Försök igen.');

  const enc = new Mp3Encoder(1, SAMPLE_RATE, 64);
  const out: Uint8Array[] = [];
  const block = 1152 * 20;
  for (const p of pcm) {
    for (let o = 0; o < p.length; o += block) {
      const chunk = enc.encodeBuffer(p.subarray(o, o + block));
      if (chunk.length) out.push(chunk);
    }
  }
  const end = enc.flush();
  if (end.length) out.push(end);
  return { mp3: Buffer.concat(out.map((u) => Buffer.from(u))), durationS: Math.round(total / SAMPLE_RATE) };
}

// Gör om avsnittets text (markdown) till ren text att läsa upp.
export function markdownToSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+(.+?)\s*$/gm, (_m, h: string) => (/[.!?:…]$/.test(h) ? h : `${h}.`))
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__|\*|_|`)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
