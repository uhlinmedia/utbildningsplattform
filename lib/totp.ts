import 'server-only';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Tvåstegsverifiering med engångskoder (TOTP, RFC 6238) – fungerar med Microsoft Authenticator,
// Google Authenticator, 1Password m.fl. 6 siffror, 30 sekunder.

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string) {
  const clean = s.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error('Ogiltig nyckel');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function newTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, step: number) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const n = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

// Tillåter en kod före och efter (klockor som går lite fel).
export function verifyTotp(secret: string, code: string, now = Date.now()) {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const step = Math.floor(now / 30000);
  return [-1, 0, 1].some((d) => timingSafeEqual(Buffer.from(totpCode(secret, step + d)), Buffer.from(c)));
}

export function otpauthUrl(secret: string, account: string) {
  const label = encodeURIComponent(`Briondo:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=Briondo&algorithm=SHA1&digits=6&period=30`;
}

// Hemligheten sparas krypterad (AES-256-GCM) med en nyckel härledd från SESSION_SECRET.
function encKey() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET saknas eller är kortare än 32 tecken');
  return createHash('sha256').update(`totp:${s}`).digest();
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', encKey(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decryptSecret(enc: string) {
  const [iv, tag, data] = enc.split('.').map((p) => Buffer.from(p, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', encKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

// Reservkoder: 10 st, t.ex. "7K3M-QX9P". Sparas som sha256.
export function newRecoveryCodes() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 10 }, () => {
    const b = randomBytes(8);
    const s = Array.from(b, (x) => alphabet[x % alphabet.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const normalizeRecovery = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
