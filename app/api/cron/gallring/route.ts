import { sql } from '@/lib/db';

// Daglig GDPR-gallring. Anropas av schemaläggaren med Authorization: Bearer <CRON_SECRET>.
// Raderar elever vars senaste aktivitet är äldre än kundens gallringstid.
// Certifikat behålls utan namn så att ID och datum fortfarande kan verifieras.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Ingen behörighet', { status: 401 });
  }
  const result = await sql.begin(async (tx) => {
    const expired = await tx<{ learner_id: string }[]>`
      select l.id as learner_id
      from learner l join customer c on c.id = l.customer_id
      where coalesce((select max(e.last_active_at) from enrollment e where e.learner_id = l.id), l.created_at)
        < now() - make_interval(months => c.retention_months)`;
    const ids = expired.map((r) => r.learner_id);
    if (ids.length === 0) return 0;
    await tx`update certificate set learner_name = null
      where enrollment_id in (select id from enrollment where learner_id = any(${ids}::uuid[]))`;
    await tx`delete from learner where id = any(${ids}::uuid[])`;
    return ids.length;
  });
  // Bilder som inte längre används (block, kundlogga, certifikatmärken, underskrifter) tas också bort.
  await sql`delete from media m where created_at < now() - interval '1 day'
    and not exists (select 1 from customer c where c.logo_media_id = m.id)
    and not exists (select 1 from cert_badge cb where cb.media_id = m.id)
    and not exists (select 1 from course co where m.id in (co.cert_signature_media_id, co.cert_signature2_media_id))
    and not exists (select 1 from block b where b.content->>'media_id' = m.id::text)`;
  return Response.json({ gallrade_elever: result });
}
