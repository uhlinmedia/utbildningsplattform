import { estimatedCostSek, fmtMinutes, type UsageRow } from '@/lib/ai-usage';

const monthName = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Intl.DateTimeFormat('sv-SE', { month: 'long', year: 'numeric' }).format(new Date(y, mo - 1, 1));
};
const kr = (v: number) => v.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Förbrukning av AI-uppläsning per månad (och kund). Kostnaden hos Google visas bara för superadmin.
export function AiUsageTable({ rows, showCustomer, showCost, exportBase }: {
  rows: UsageRow[]; showCustomer: boolean; showCost: boolean; exportBase: string;
}) {
  if (rows.length === 0) return <p className="muted">Inga AI-röster har skapats de senaste 12 månaderna.</p>;
  const months = [...new Set(rows.map((r) => r.month))];
  return (
    <div className="scroll-x">
      <table className="table ai-usage">
        <thead>
          <tr>
            <th>Månad</th>
            {showCustomer && <th>Kund</th>}
            <th style={{ textAlign: 'right' }}>AI-röster</th>
            <th style={{ textAlign: 'right' }}>Minuter tal</th>
            <th style={{ textAlign: 'right' }}>Tecken</th>
            {showCost && <th style={{ textAlign: 'right' }}>Ca kostnad Google (kr)</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {months.flatMap((m) => {
            const list = rows.filter((r) => r.month === m);
            const sum = list.reduce((a, r) => ({ voices: a.voices + r.voices, chars: a.chars + r.chars, seconds: a.seconds + r.seconds }), { voices: 0, chars: 0, seconds: 0 });
            const lines = list.map((r, i) => (
              <tr key={`${m}-${r.customer_id}`}>
                <td>{i === 0 ? monthName(m) : ''}</td>
                {showCustomer && <td>{r.customer}</td>}
                <td style={{ textAlign: 'right' }}>{r.voices}</td>
                <td style={{ textAlign: 'right' }}>{fmtMinutes(r.seconds)}</td>
                <td style={{ textAlign: 'right' }}>{r.chars.toLocaleString('sv-SE')}</td>
                {showCost && <td style={{ textAlign: 'right' }}>{kr(estimatedCostSek(r.seconds, m))}</td>}
                <td>{i === 0 && <a className="small" href={`${exportBase}?m=${m}`}>Excel</a>}</td>
              </tr>
            ));
            if (showCustomer && list.length > 1) {
              lines.push(
                <tr key={`${m}-summa`} className="ai-usage-sum">
                  <td />
                  <td>Summa</td>
                  <td style={{ textAlign: 'right' }}>{sum.voices}</td>
                  <td style={{ textAlign: 'right' }}>{fmtMinutes(sum.seconds)}</td>
                  <td style={{ textAlign: 'right' }}>{sum.chars.toLocaleString('sv-SE')}</td>
                  {showCost && <td style={{ textAlign: 'right' }}>{kr(estimatedCostSek(sum.seconds, m))}</td>}
                  <td />
                </tr>,
              );
            }
            return lines;
          })}
        </tbody>
      </table>
    </div>
  );
}
