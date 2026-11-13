// Färghjälp för kundfärger (hex: #rgb eller #rrggbb).

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]) {
  const ch = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

// Sant om färgen ligger så nära appens mörka färg (--ink, #1b2430) att den smälter ihop med den,
// t.ex. en nästan svart eller mörkt marinblå kundfärg.
export function isTooDark(hex: string | null | undefined): boolean {
  const c = hex ? rgb(hex) : null;
  if (!c) return false;
  const ink = luminance([27, 36, 48]);
  const l = luminance(c);
  return (Math.max(l, ink) + 0.05) / (Math.min(l, ink) + 0.05) < 1.8;
}
