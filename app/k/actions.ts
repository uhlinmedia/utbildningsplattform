'use server';

import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import { canReadCustomer } from '@/lib/auth';
import { flatSections, getCourseBySlug, getStructure } from '@/lib/course';
import { getEnrollment, newToken, resetPreviewProgress, setEnrollmentCookie } from '@/lib/learner';
import { loadProgress } from '@/lib/progress';
import type { QuizContent } from '@/lib/types';
import { courseIsOpen } from '@/lib/completion';
import { EMAIL_RE, clearPersonCookie, learnerForPerson, sendLoginLink, sessionPerson, type Person } from '@/lib/person';

const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

export async function startCourse(fd: FormData) {
  const slug = s(fd, 'slug');
  const course = await getCourseBySlug(slug);
  if (!course) redirect('/');
  const review = s(fd, 'granska');
  const viaReview = !!review && review === course.preview_token;
  const preview = viaReview || (fd.get('preview') === '1' && (await canReadCustomer(course.customer_id)));
  if (!preview && !courseIsOpen(course)) redirect(`/k/${slug}`);
  // Personregistret: den inloggade personen startar eller fortsätter (samma deltagande på alla enheter).
  if (course.access_mode === 'register' && !preview) {
    const person = await sessionPerson();
    if (!person || person.customer_id !== course.customer_id) redirect(`/k/${slug}`);
    const learnerId = await learnerForPerson(person);
    const [existing] = await sql<{ token: string }[]>`
      select token from enrollment where learner_id = ${learnerId} and course_id = ${course.id} and not is_preview
      order by started_at desc limit 1`;
    const tok = existing?.token ?? newToken();
    if (!existing) await sql`insert into enrollment (learner_id, course_id, token) values (${learnerId}, ${course.id}, ${tok})`;
    await setEnrollmentCookie(course.id, tok);
    redirect(`/k/${slug}/kurs`);
  }
  const name = s(fd, 'name').slice(0, 120);
  const email = s(fd, 'email').toLowerCase().slice(0, 200);
  const back = (fel: string) => `/k/${slug}?fel=${fel}${viaReview ? `&granska=${encodeURIComponent(review)}` : ''}${preview && !viaReview ? '&forhandsvisning=1' : ''}`;
  if (!name) redirect(back('namn'));
  if (course.access_mode === 'name_email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect(back('epost'));
  const token = newToken();
  await sql.begin(async (tx) => {
    const [l] = await tx<{ id: string }[]>`
      insert into learner (customer_id, name, email)
      values (${course.customer_id}, ${name}, ${course.access_mode === 'name_email' ? email : null}) returning id`;
    await tx`insert into enrollment (learner_id, course_id, token, is_preview, review_token)
      values (${l.id}, ${course.id}, ${token}, ${preview}, ${viaReview ? review : null})`;
  });
  await setEnrollmentCookie(course.id, token);
  redirect(`/k/${slug}/kurs`);
}

async function context(slug: string) {
  const course = await getCourseBySlug(slug);
  if (!course) redirect('/');
  const enrollment = await getEnrollment(course.id);
  if (!enrollment) redirect(`/k/${slug}`);
  const chapters = await getStructure(course.id);
  return { course, enrollment, chapters };
}

export type QuizResult = {
  correct: boolean;
  attemptsLeft: number;
  reveal: { correctIds: string[]; explanation?: string } | null;
};

export async function answerQuiz(slug: string, blockId: string, selected: string[]): Promise<QuizResult> {
  const { course, enrollment, chapters } = await context(slug);
  const block = chapters.flatMap((c) => c.sections.flatMap((x) => x.blocks)).find((b) => b.id === blockId);
  if (!block || block.type !== 'quiz') throw new Error('Frågan finns inte');
  const q = block.content as QuizContent;
  const progress = await loadProgress(course, chapters, enrollment.id);
  const state = progress.quizzes.get(blockId);
  const correctIds = q.options.filter((o) => o.correct).map((o) => o.id);
  if (state?.correct || state?.exhausted) {
    return { correct: !!state.correct, attemptsLeft: 0, reveal: course.show_answers ? { correctIds, explanation: q.explanation } : null };
  }
  const valid = selected.filter((id) => q.options.some((o) => o.id === id));
  const correct = valid.length === correctIds.length && valid.every((id) => correctIds.includes(id));
  const attempt = (state?.attempts ?? 0) + 1;
  await sql`insert into answer (enrollment_id, block_id, attempt, selected, correct)
    values (${enrollment.id}, ${blockId}, ${attempt}, ${sql.json(valid)}, ${correct})`;
  const attemptsLeft = correct ? 0 : course.max_attempts - attempt;
  const reveal = correct || attemptsLeft <= 0 ? (course.show_answers ? { correctIds, explanation: q.explanation } : null) : null;
  return { correct, attemptsLeft, reveal };
}

export async function reportVideo(slug: string, blockId: string, percent: number) {
  const { enrollment } = await context(slug);
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  await sql`insert into video_progress (enrollment_id, block_id, max_percent) values (${enrollment.id}, ${blockId}, ${p})
    on conflict (enrollment_id, block_id) do update set max_percent = greatest(video_progress.max_percent, excluded.max_percent)`;
}

export async function completeSection(fd: FormData) {
  const slug = s(fd, 'slug');
  const sectionId = s(fd, 'section_id');
  const { course, enrollment, chapters } = await context(slug);
  const progress = await loadProgress(course, chapters, enrollment.id);
  const st = progress.sections.get(sectionId);
  if (!st || !st.unlocked) redirect(`/k/${slug}/kurs`);
  if (!st.requirementsMet) redirect(`/k/${slug}/kurs?s=${sectionId}&krav=1`);
  await sql`insert into section_progress (enrollment_id, section_id) values (${enrollment.id}, ${sectionId})
    on conflict do nothing`;
  const flat = flatSections(chapters);
  const idx = flat.findIndex((x) => x.id === sectionId);
  const next = flat.slice(idx + 1).find((x) => !progress.sections.get(x.id)?.completed) ?? flat.find((x) => x.id !== sectionId && !progress.sections.get(x.id)?.completed);
  if (next) redirect(`/k/${slug}/kurs?s=${next.id}`);
  redirect(`/k/${slug}/klar`);
}

export async function retryCourse(fd: FormData) {
  const slug = s(fd, 'slug');
  const { enrollment } = await context(slug);
  await sql.begin(async (tx) => {
    await tx`delete from answer where enrollment_id = ${enrollment.id}`;
    await tx`delete from section_progress where enrollment_id = ${enrollment.id}`;
    await tx`update enrollment set completed_at = null, passed = false, score_percent = null where id = ${enrollment.id}`;
  });
  redirect(`/k/${slug}/kurs`);
}

export async function restartPreview(fd: FormData) {
  const slug = s(fd, 'slug');
  const { enrollment } = await context(slug);
  // Superadmin och kund med giltig förhandsvisningslänk (getEnrollment har redan kontrollerat länken).
  if (enrollment.is_preview) await resetPreviewProgress(enrollment.id);
  redirect(`/k/${slug}/kurs`);
}

// Utbildning för personregistret: eleven skriver sin e-post och får en inloggningslänk.
// Samma svar oavsett om adressen finns, så att ingen kan pröva fram vilka som är anställda.
export async function requestCourseLogin(fd: FormData) {
  const slug = s(fd, 'slug');
  const course = await getCourseBySlug(slug);
  if (!course || course.access_mode !== 'register') redirect('/');
  const email = s(fd, 'email').toLowerCase().slice(0, 200);
  if (!EMAIL_RE.test(email)) redirect(`/k/${slug}?fel=epost`);
  const [p] = await sql<Person[]>`
    select * from person where customer_id = ${course.customer_id} and email = ${email} and archived_at is null`;
  if (p) await sendLoginLink(p, `/k/${slug}`);
  redirect(`/k/${slug}?skickad=1`);
}

export async function personLogout(fd: FormData) {
  await clearPersonCookie();
  const back = s(fd, 'back');
  redirect(back.startsWith('/k/') ? back : '/mina');
}
