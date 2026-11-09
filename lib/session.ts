import { SignJWT, jwtVerify } from 'jose';

export const ADMIN_COOKIE = 'admin_session';
const ALG = 'HS256';

function key() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET saknas eller är kortare än 32 tecken');
  return new TextEncoder().encode(s);
}

export async function signAdminSession(adminId: string) {
  return new SignJWT({ sub: adminId, role: 'admin' })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(key());
}

export async function verifyAdminSession(token: string | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: [ALG] });
    return payload.role === 'admin' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
