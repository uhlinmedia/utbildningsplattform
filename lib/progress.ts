import 'server-only';
import { sql } from './db';
import { flatSections } from './course';
import type { Chapter, Course } from './types';

export type SectionState = {
  id: string;
  completed: boolean;
  unlocked: boolean;
  requirementsMet: boolean;
};

export type QuizState = { attempts: number; correct: boolean; lastSelected: string[] | null; exhausted: boolean };

export type Progress = {
  sections: Map<string, SectionState>;
  quizzes: Map<string, QuizState>;
  videos: Map<string, number>;
  percentComplete: number;
  scorePercent: number;
  allComplete: boolean;
  passed: boolean;
};

export async function loadProgress(course: Course, chapters: Chapter[], enrollmentId: string): Promise<Progress> {
  const done = new Set(
    (await sql<{ section_id: string }[]>`select section_id from section_progress where enrollment_id = ${enrollmentId}`).map(
      (r) => r.section_id,
    ),
  );
  const answers = await sql<{ block_id: string; attempt: number; selected: string[]; correct: boolean }[]>`
    select block_id, attempt, selected, correct from answer where enrollment_id = ${enrollmentId} order by attempt`;
  const vids = await sql<{ block_id: string; max_percent: number }[]>`
    select block_id, max_percent from video_progress where enrollment_id = ${enrollmentId}`;

  const quizzes = new Map<string, QuizState>();
  for (const a of answers) {
    const q = quizzes.get(a.block_id) ?? { attempts: 0, correct: false, lastSelected: null, exhausted: false };
    q.attempts = Math.max(q.attempts, a.attempt);
    q.correct = q.correct || a.correct;
    q.lastSelected = a.selected;
    quizzes.set(a.block_id, q);
  }
  for (const q of quizzes.values()) q.exhausted = !q.correct && q.attempts >= course.max_attempts;
  const videos = new Map(vids.map((v) => [v.block_id, v.max_percent]));

  const flat = flatSections(chapters);
  const sections = new Map<string, SectionState>();
  let previousDone = true;
  let quizTotal = 0;
  let quizCorrect = 0;
  for (const s of flat) {
    let met = true;
    for (const b of s.blocks) {
      if (b.type === 'quiz') {
        quizTotal++;
        const q = quizzes.get(b.id);
        if (q?.correct) quizCorrect++;
        if (!q || (!q.correct && !q.exhausted)) met = false;
      }
      if (b.type === 'video' && (b.content.required_percent ?? 0) > 0) {
        if ((videos.get(b.id) ?? 0) < (b.content.required_percent ?? 0)) met = false;
      }
    }
    const completed = done.has(s.id);
    const unlocked = course.nav_mode === 'free' ? true : previousDone;
    sections.set(s.id, { id: s.id, completed, unlocked, requirementsMet: met });
    previousDone = previousDone && completed;
  }
  const completedCount = flat.filter((s) => done.has(s.id)).length;
  const allComplete = flat.length > 0 && completedCount === flat.length;
  const scorePercent = quizTotal === 0 ? 100 : Math.round((quizCorrect / quizTotal) * 100);
  return {
    sections,
    quizzes,
    videos,
    percentComplete: flat.length ? Math.round((completedCount / flat.length) * 100) : 0,
    scorePercent,
    allComplete,
    passed: allComplete && scorePercent >= course.pass_percent,
  };
}
