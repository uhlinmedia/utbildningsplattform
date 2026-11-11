import 'server-only';
import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { sessionPerson } from './person';

export const enrollmentCookie = (courseId: string) => `enr_${courseId.replace(/-/g, '')}`;

export type Enrollment = {
  id: string;
  learner_id: string;
  name: string;
  email: string | null;
  completed_at: Date | null;
  passed: boolean;
  is_preview: boolean;
};

export function newToken() {
  return randomBytes(32).toString('base64url');
}

export async function getEnrollment(courseId: string): Promise<Enrollment | null> {
  const store = await cookies();
  const token = store.get(enrollmentCookie(courseId))?.value;
  if (!token) return null;
  // En kundförhandsvisning slutar gälla när länken byts ut eller stängs av.
  const [e] = await sql<(Enrollment & { person_id: string | null; access_mode: string })[]>`
    update enrollment e set last_active_at = now()
    from learner l, course c
    where e.token = ${token} and e.course_id = ${courseId} and l.id = e.learner_id and c.id = e.course_id
      and (e.review_token is null or e.review_token = c.preview_token)
    returning e.id, e.learner_id, l.name, l.email, e.completed_at, e.passed, e.is_preview, l.person_id, c.access_mode`;
  if (!e) return null;
  // Utbildningar för personregistret: deltagandet gäller bara när rätt person är inloggad
  // (t.ex. delad dator där någon annan loggat in efteråt).
  if (e.access_mode === 'register' && !e.is_preview) {
    const p = await sessionPerson();
    if (!p || p.id !== e.person_id) return null;
  }
  const { person_id: _p, access_mode: _a, ...rest } = e;
  return rest;
}

// Nollställer en förhandsvisning så att den börjar om från första avsnittet.
// Gäller bara förhandsvisnings-deltagare – riktiga elevers resultat rörs aldrig.
export async function resetPreviewProgress(enrollmentId: string) {
  await sql.begin(async (tx) => {
    const [e] = await tx<{ id: string }[]>`select id from enrollment where id = ${enrollmentId} and is_preview`;
    if (!e) return;
    await tx`delete from answer where enrollment_id = ${enrollmentId}`;
    await tx`delete from section_progress where enrollment_id = ${enrollmentId}`;
    await tx`delete from video_progress where enrollment_id = ${enrollmentId}`;
    await tx`delete from certificate where enrollment_id = ${enrollmentId}`;
    await tx`update enrollment set completed_at = null, passed = false, score_percent = null where id = ${enrollmentId}`;
  });
}

export async function setEnrollmentCookie(courseId: string, token: string) {
  const store = await cookies();
  store.set(enrollmentCookie(courseId), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 180,
  });
}

// Certifikat-ID utan lättförväxlade tecken, t.ex. K7PM-3XQ9-TA
export function newCertificateId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(10);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 10)}`;
}
