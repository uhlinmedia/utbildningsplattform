import { notFound } from 'next/navigation';
import { requireCustomerPage } from '@/lib/access';
import { getCustomer } from '@/lib/course';
import { aiAccess, fmtMinutes, usageByMonth } from '@/lib/ai-usage';
import { CustomerHeader } from '../CustomerHeader';
import { AiUsageTable } from '../../../AiUsageTable';

export const dynamic = 'force-dynamic';

// Förbrukning av AI-uppläsning för en kund, per månad. Kundadmin ser sin egen; superadmin även kostnaden.
export default async function CustomerAiPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCustomerPage(id, 'admin');
  const customer = await getCustomer(id);
  if (!customer) notFound();
  const isSuper = user.role === 'superadmin';
  if (!isSuper && !customer.ai_voice) notFound();
  const [access, rows] = await Promise.all([aiAccess(user, id), usageByMonth(id)]);
  return (
    <>
      <CustomerHeader user={user} customer={customer} active="ai" />
      <section className="card stack">
        <h2 style={{ margin: 0 }}>AI-uppläsning – förbrukning</h2>
        <p className="small muted" style={{ margin: 0 }}>
          {customer.ai_voice ? 'Aktiverad.' : 'Inte aktiverad för kundens användare.'}
          {' '}Denna månad: <strong>{fmtMinutes(access.usedSeconds)} min</strong>
          {access.quotaMinutes !== null ? <> av <strong>{access.quotaMinutes} min</strong> (kvar {fmtMinutes(access.remainingSeconds ?? 0)} min).</> : ' – ingen kvot.'}
          {' '}Minuterna är skapad taltid. Varje ny eller omgjord röst räknas.
        </p>
        <AiUsageTable rows={rows} showCustomer={false} showCost={isSuper} exportBase={`/admin/kunder/${id}/ai/export`} />
      </section>
    </>
  );
}
