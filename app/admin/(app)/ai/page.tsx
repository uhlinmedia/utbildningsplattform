import Link from 'next/link';
import { requireUser } from '@/lib/access';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { usageByMonth } from '@/lib/ai-usage';
import { ttsConfigured } from '@/lib/tts';
import { AiUsageTable } from '../AiUsageTable';

export const dynamic = 'force-dynamic';

// Superadmin: förbrukning av AI-uppläsning för alla kunder, per månad – underlag för fakturering.
export default async function AiOverviewPage() {
  const user = await requireUser();
  if (user.role !== 'superadmin') notFound();
  const [rows, customers] = await Promise.all([
    usageByMonth(),
    sql<{ id: string; name: string; ai_voice: boolean; ai_minutes_month: number | null }[]>`
      select id, name, ai_voice, ai_minutes_month from customer order by name`,
  ]);
  return (
    <>
      <h1>AI-uppläsning</h1>
      {!ttsConfigured() && <p className="error">GEMINI_API_KEY saknas på servern – ingen kan skapa AI-röster just nu.</p>}
      <section className="card stack">
        <h2 style={{ margin: 0 }}>Förbrukning per kund och månad</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Skapad taltid och antal tecken, de senaste 12 månaderna. Kostnaden är en uppskattning av Googles pris (Gemini 3.8 Flash TTS,
          ca 9 USD per miljon ljudtokens 2026 och 18 USD från 2027, 10,50 kr/USD) och används som underlag om du tar betalt.
        </p>
        <AiUsageTable rows={rows} showCustomer showCost exportBase="/admin/ai/export" />
      </section>
      <section className="card stack">
        <h2 style={{ margin: 0 }}>Aktivering per kund</h2>
        <ul className="ai-customers">
          {customers.map((c) => (
            <li key={c.id}>
              <Link href={`/admin/kunder/${c.id}#ai-rubrik`}>{c.name}</Link>
              <span className={c.ai_voice ? 'ok-text' : 'muted'}>
                {c.ai_voice ? `Aktiverad · ${c.ai_minutes_month === null ? 'ingen kvot' : `${c.ai_minutes_month} min/månad`}` : 'Inte aktiverad'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
