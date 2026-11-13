import { requireCustomerPage } from '@/lib/access';
import { getCustomer } from '@/lib/course';
import { sql } from '@/lib/db';
import { CustomerHeader } from '../CustomerHeader';

export const dynamic = 'force-dynamic';

// Läsbara namn på händelser i ändringsloggen.
const label: Record<string, string> = {
  inloggning: 'Loggade in',
  inloggning_reservkod: 'Loggade in med reservkod',
  konto_last: 'Konto spärrat efter felaktiga försök',
  tvasteg_aktiverad: 'Aktiverade tvåstegsverifiering',
  tvasteg_nollstalld: 'Nollställde tvåstegsverifiering',
  reservkoder_nya: 'Skapade nya reservkoder',
  losenord_bytt: 'Bytte lösenord',
  losenord_lank_skickad: 'Bad om nytt lösenord',
  losenord_aterstallt: 'Valde nytt lösenord via länk',
  utloggad_overallt: 'Loggade ut på alla enheter',
  inbjudan_accepterad: 'Accepterade inbjudan',
  anvandare_inbjuden: 'Bjöd in användare',
  inbjudan_skickad_igen: 'Skickade inbjudan igen',
  anvandare_roll: 'Ändrade roll',
  anvandare_avstangd: 'Stängde av användare',
  anvandare_aktiverad: 'Aktiverade användare',
  anvandare_borttagen: 'Tog bort användare',
  kund_skapad: 'Skapade kunden',
  kundprofil_sparad: 'Sparade kundprofilen',
  utbildning_skapad: 'Skapade utbildning',
  utbildning_kopierad: 'Kopierade utbildning',
  utbildning_publicerad: 'Publicerade utbildning',
  utbildning_avpublicerad: 'Avpublicerade utbildning',
  utbildning_raderad: 'Raderade utbildning',
  person_skapad: 'Lade till person',
  person_andrad: 'Ändrade person',
  person_arkiverad: 'Arkiverade person',
  person_aterstalld: 'Återställde person',
  person_raderad: 'Raderade person',
  personer_importerade: 'Importerade personer',
  person_lank_ny: 'Skapade personlig länk',
  person_lank_av: 'Stängde av personlig länk',
  person_inloggningslank: 'Skickade inloggningslänk',
  avsnittsljud_sparat: 'Laddade upp speakerröst',
  avsnittsljud_borttaget: 'Tog bort speakerröst',
  avsnittsljud_ai_skapat: 'Skapade AI-röst',
  ai_installning: 'Ändrade AI-uppläsning',
};

const fmt = (d: Date) => new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Stockholm' }).format(d);

function describe(d: Record<string, unknown>) {
  const parts: string[] = [];
  if (d.email) parts.push(String(d.email));
  if (d.title) parts.push(`”${d.title}”`);
  if (d.name) parts.push(String(d.name));
  if (d.from && d.to) parts.push(`${d.from} → ${d.to}`);
  if (d.role && !d.from) parts.push(String(d.role));
  if (typeof d.created === 'number') parts.push(`${d.created} nya, ${d.updated ?? 0} uppdaterade`);
  return parts.join(' · ');
}

export default async function LogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCustomerPage(id, 'admin');
  const customer = (await getCustomer(id))!;
  const rows = await sql<{ id: string; at: Date; user_email: string | null; action: string; detail: Record<string, unknown> }[]>`
    select id::text, at, user_email, action, detail from audit_log where customer_id = ${id} order by at desc limit 300`;
  return (
    <>
      <CustomerHeader user={user} customer={customer} active="logg" />
      <section className="card stack">
        <p className="small muted" style={{ margin: 0 }}>De senaste 300 händelserna: inloggningar, användare, utbildningar och personregistret.</p>
        {rows.length === 0 ? <p className="muted">Inga händelser än.</p> : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Tid</th><th>Vem</th><th>Händelse</th><th>Detaljer</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="small" style={{ whiteSpace: 'nowrap' }}>{fmt(r.at)}</td>
                    <td className="small">{r.user_email ?? '–'}</td>
                    <td>{label[r.action] ?? r.action}</td>
                    <td className="small muted">{describe(r.detail)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
