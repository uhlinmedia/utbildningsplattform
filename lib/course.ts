import 'server-only';
import { sql } from './db';
import type { Block, Chapter, Course, Customer } from './types';

export async function getCourseById(id: string) {
  const [c] = await sql<Course[]>`select * from course where id = ${id}`;
  return c ?? null;
}

export async function getCourseBySlug(slug: string) {
  const [c] = await sql<Course[]>`select * from course where slug = ${slug}`;
  return c ?? null;
}

export async function getCustomer(id: string) {
  const [c] = await sql<Customer[]>`select * from customer where id = ${id}`;
  return c ?? null;
}

// Hela strukturen kapitel → avsnitt → block, sorterad.
export async function getStructure(courseId: string): Promise<Chapter[]> {
  const chapters = await sql<{ id: string; title: string; position: number }[]>`
    select id, title, position from chapter where course_id = ${courseId} order by position`;
  const sections = await sql<{ id: string; chapter_id: string; title: string; position: number }[]>`
    select s.id, s.chapter_id, s.title, s.position from section s
    join chapter c on c.id = s.chapter_id where c.course_id = ${courseId} order by s.position`;
  const blocks = await sql<(Block & { section_id: string })[]>`
    select b.id, b.section_id, b.position, b.type, b.content from block b
    join section s on s.id = b.section_id join chapter c on c.id = s.chapter_id
    where c.course_id = ${courseId} order by b.position`;
  return chapters.map((ch) => ({
    ...ch,
    sections: sections
      .filter((s) => s.chapter_id === ch.id)
      .map((s) => ({
        id: s.id,
        title: s.title,
        position: s.position,
        blocks: blocks.filter((b) => b.section_id === s.id) as Block[],
      })),
  }));
}

export function flatSections(chapters: Chapter[]) {
  return chapters.flatMap((ch, ci) =>
    ch.sections.map((s, si) => ({ ...s, chapterId: ch.id, chapterTitle: ch.title, label: `${ci + 1}.${si + 1}` })),
  );
}

export function slugify(text: string) {
  const base = text
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'utbildning'}-${Math.random().toString(36).slice(2, 7)}`;
}
