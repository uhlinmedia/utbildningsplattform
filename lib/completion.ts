import 'server-only';
import { sql } from './db';
import { getCourseById, getStructure } from './course';
import { newCertificateId } from './learner';
import { loadProgress } from './progress';

export function courseIsOpen(course: { status: string; closes_at: string | null }) {
  if (course.status !== 'published') return false;
  if (course.closes_at && new Date(course.closes_at) < new Date(new Date().toDateString())) return false;
  return true;
}

// Avslutar utbildningen och utfärdar certifikat om eleven är godkänd.
export async function finalize(courseId: string, enrollmentId: string) {
  const course = (await getCourseById(courseId))!;
  const chapters = await getStructure(courseId);
  const progress = await loadProgress(course, chapters, enrollmentId);
  if (!progress.allComplete) return { progress, certificateId: null as string | null };
  await sql`update enrollment set completed_at = coalesce(completed_at, now()), passed = ${progress.passed},
    score_percent = ${progress.scorePercent} where id = ${enrollmentId}`;
  let certificateId: string | null = null;
  if (progress.passed && course.certificate_enabled) {
    const [existing] = await sql<{ id: string }[]>`select id from certificate where enrollment_id = ${enrollmentId}`;
    if (existing) certificateId = existing.id;
    else {
      const [l] = await sql<{ name: string }[]>`
        select l.name from learner l join enrollment e on e.learner_id = l.id where e.id = ${enrollmentId}`;
      certificateId = newCertificateId();
      await sql`insert into certificate (id, enrollment_id, course_id, learner_name, valid_until)
        values (${certificateId}, ${enrollmentId}, ${courseId}, ${l.name},
          ${course.cert_valid_months ? sql`(current_date + make_interval(months => ${course.cert_valid_months}))::date` : null})`;
    }
  }
  return { progress, certificateId };
}

