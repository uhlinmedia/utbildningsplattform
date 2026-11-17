import { sql } from '@/lib/db';

// Vilka av de angivna bilderna finns inte (längre) i databasen? Används i editorn för att markera
// bilder som saknas, så att de kan laddas upp igen med "Byt bild".
export async function missingMedia(ids: string[]): Promise<Set<string>> {
  const valid = [...new Set(ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
  const missing = new Set(ids.filter((id) => !/^[0-9a-f-]{36}$/i.test(id)));
  if (valid.length === 0) return missing;
  const found = await sql<{ id: string }[]>`select id::text from media where id = any(${valid}::uuid[])`;
  const have = new Set(found.map((r) => r.id));
  valid.forEach((id) => { if (!have.has(id)) missing.add(id); });
  return missing;
}

export type MissingRow = {
  customer: string; course_id: string; course: string; section_id: string; section: string; chapter_no: number; section_no: number; n: number;
};

// Alla avsnitt (alla kunder) där ett bildblock eller en bild i ett bildspel pekar på en bild som saknas.
export async function sectionsWithMissingImages(): Promise<MissingRow[]> {
  return sql<MissingRow[]>`
    select cu.name as customer, co.id as course_id, co.title as course, s.id as section_id, s.title as section,
      (select count(*) from chapter c2 where c2.course_id = co.id and c2.position <= ch.position)::int as chapter_no,
      (select count(*) from section s2 where s2.chapter_id = ch.id and s2.position <= s.position)::int as section_no,
      count(*)::int as n
    from block b
    join section s on s.id = b.section_id
    join chapter ch on ch.id = s.chapter_id
    join course co on co.id = ch.course_id
    join customer cu on cu.id = co.customer_id
    cross join lateral (
      select sl->>'media_id' as mid from jsonb_array_elements(case when b.type = 'slides' then coalesce(b.content->'slides', '[]'::jsonb) else '[]'::jsonb end) sl
      union all
      select b.content->>'media_id' where b.type = 'image' and coalesce(b.content->>'media_id', '') <> ''
    ) r
    where not exists (select 1 from media m where m.id::text = r.mid)
    group by cu.name, co.id, co.title, s.id, s.title, ch.position, ch.id, s.position
    order by cu.name, co.title, ch.position, s.position`;
}
