import { SignJWT, jwtVerify } from 'jose';

// Sessionen för admin och kundanvändare. Steg:
//  - 'full'  : inloggad (lösenord + tvåstegsverifiering)
//  - 'mfa'   : lösenord godkänt, väntar på engångskod
//  - 'setup' : lösenord godkänt, ska aktivera tvåstegsverifiering
// Roll och behörighet läses alltid från databasen på servern (lib/access.ts); kakan säger bara vem det är.
export const ADMIN_COOKIE = 'admin_session';
const ALG = 'HS256';

export type Stage = 'full' | 'mfa' | 'setup';
export type SessionClaims = { sub: string; stage: Stage; ver: number };

function key() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET saknas eller är kortare än 32 tecken');
  return new TextEncoder().encode(s);
}

export async function signUserSession(userId: string, stage: Stage, ver: number) {
  // role 'user' (inte 'admin') så att äldre versioner av appen inte godtar kakan.
  return new SignJWT({ sub: userId, role: 'user', stage, ver })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(stage === 'full' ? '12h' : '15m')
    .sign(key());
}

export async function verifyUserSession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: [ALG] });
    if (payload.role !== 'user' || typeof payload.sub !== 'string') return null;
    const stage = payload.stage as Stage;
    if (!['full', 'mfa', 'setup'].includes(stage)) return null;
    return { sub: payload.sub, stage, ver: Number(payload.ver) || 0 };
  } catch {
    return null;
  }
}

// Elevens inloggning (personregistret): en kaka per webbläsare, 30 dagar.
export const PERSON_COOKIE = 'person_session';

export async function signPersonSession(personId: string, ver: number) {
  return new SignJWT({ sub: personId, role: 'person', ver })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(key());
}

export async function verifyPersonSession(token: string | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: [ALG] });
    if (payload.role !== 'person' || typeof payload.sub !== 'string') return null;
    return { sub: payload.sub, ver: Number(payload.ver) || 0 };
  } catch {
    return null;
  }
}
