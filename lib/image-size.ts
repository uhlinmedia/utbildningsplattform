import sharp from 'sharp';
import { sql } from '@/lib/db';

export type ImageSize = { width: number; height: number };

// Bilder i media ändras aldrig (en ny bild får nytt id), så storleken kan sparas i minnet.
const cache = new Map<string, ImageSize | null>();

async function measure(data: Buffer): Promise<ImageSize | null> {
  const m = await sharp(data).metadata();
  if (!m.width || !m.height) return null;
  // EXIF-rotation 5–8 (vanligt i mobilfoton): webbläsaren vrider bilden, så bredd och höjd byter plats.
  return m.orientation && m.orientation >= 5 ? { width: m.height, height: m.width } : { width: m.width, height: m.height };
}

// Bredd och höjd för bilder i media. Läser bara början av filen (där storleken står) och hela filen bara om det
// behövs. Okända eller trasiga bilder ger null – då visas bilden som vanligt (ovanför texten).
export async function imageSizes(ids: string[]): Promise<Map<string, ImageSize | null>> {
  const out = new Map<string, ImageSize | null>();
  const missing = [...new Set(ids)].filter((id) => {
    if (cache.has(id)) { out.set(id, cache.get(id)!); return false; }
    return /^[0-9a-f-]{36}$/i.test(id);
  });
  if (missing.length === 0) return out;
  const rows = await sql<{ id: string; head: Buffer }[]>`
    select id, substring(data from 1 for 131072) as head from media where id = any(${missing}::uuid[])`;
  for (const r of rows) {
    let size: ImageSize | null = null;
    try {
      size = await measure(r.head);
    } catch {
      try {
        const [full] = await sql<{ data: Buffer }[]>`select data from media where id = ${r.id}`;
        if (full) size = await measure(full.data);
      } catch { size = null; }
    }
    cache.set(r.id, size);
    out.set(r.id, size);
  }
  return out;
}

// Stående eller nästan kvadratisk bild: blir för hög ovanför texten, så den visas bredvid texten på bred skärm.
export const isTall = (s: ImageSize | null | undefined) => !!s && s.height >= s.width * 0.9;
