import 'server-only';
import { sql } from './db';
import { flatSections, getStructure } from './course';
import type { QuizContent } from './types';

export async function getCourseStats(courseId: string) {
  const chapters = await getStructure(courseId);
  const [kpi] = await sql<{ started: number; completed: number; passed: number; avg_minutes: number | null }[]>`
    select count(*)::int as started,
      count(completed_at)::int as completed,
      count(*) filter (where passed)::int as passed,
      round(avg(extract(epoch from (completed_at - started_at)) / 60) filter (where completed_at is not null))::int as avg_minutes
    from enrollment where course_id = ${courseId} and not is_preview`;

  // Andel elever som klarat respektive kapitel (alla avsnitt i kapitlet).
  const chapterDone = await sql<{ chapter_id: string; learners: number }[]>`
    select c.id as chapter_id, count(distinct e.id)::int as learners
    from chapter c
    join enrollment e on e.course_id = c.course_id and not e.is_preview
    where c.course_id = ${courseId}
      and not exists (
        select 1 from section s where s.chapter_id = c.id
        and not exists (select 1 from section_progress sp where sp.section_id = s.id and sp.enrollment_id = e.id))
    group by c.id`;
  const funnel = chapters.map((ch) => ({
    title: ch.title,
    learners: chapterDone.find((r) => r.chapter_id === ch.id)?.learners ?? 0,
  }));

  // Frågeanalys: andel rätt på första försöket.
  const qrows = await sql<{ block_id: string; total: number; correct_first: number }[]>`
    select a.block_id, count(*)::int as total, count(*) filter (where a.correct)::int as correct_first
    from answer a join enrollment e on e.id = a.enrollment_id
    where e.course_id = ${courseId} and not e.is_preview and a.attempt = 1
    group by a.block_id`;
  const questions = flatSections(chapters)
    .flatMap((s) => s.blocks.filter((b) => b.type === 'quiz').map((b) => ({ id: b.id, question: (b.content as QuizContent).question, section: s.label })))
    .map((q) => {
      const r = qrows.find((x) => x.block_id === q.id);
      return { ...q, answered: r?.total ?? 0, percent: r && r.total ? Math.round((r.correct_first / r.total) * 100) : null };
    })
    .sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101));

  const sectionCount = flatSections(chapters).length;
  const learners = await sql<
    { name: string; email: string | null; started_at: Date; completed_at: Date | null; passed: boolean; score_percent: number | null; done_sections: number; certificate_id: string | null }[]
  >`select l.name, l.email, e.started_at, e.completed_at, e.passed, e.score_percent,
      (select count(*)::int from section_progress sp where sp.enrollment_id = e.id) as done_sections,
      (select id from certificate c where c.enrollment_id = e.id) as certificate_id
    from enrollment e join learner l on l.id = e.learner_id
    where e.course_id = ${courseId} and not e.is_preview
    order by e.started_at desc`;

  return { kpi, funnel, questions, learners, sectionCount };
}

export function learnerStatus(l: { completed_at: Date | null; passed: boolean; done_sections: number }, sectionCount: number) {
  if (l.completed_at && l.passed) return 'Godkänd';
  if (l.completed_at) return 'Ej godkänd';
  return `Pågår (${l.done_sections}/${sectionCount})`;
}
