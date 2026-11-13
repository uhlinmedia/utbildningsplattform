import { can, sessionUser } from '@/lib/access';
import { getCustomer } from '@/lib/course';
import { aiUsageWorkbook } from '@/lib/ai-export';

// AI-uppläsning för en kund och månad som Excel (?m=ÅÅÅÅ-MM). Kundadmin och superadmin.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await sessionUser();
  if (!user || !/^[0-9a-f-]{36}$/i.test(id) || !can(user, id, 'admin')) return new Response('Hittades inte', { status: 404 });
  const customer = await getCustomer(id);
  if (!customer || (user.role !== 'superadmin' && !customer.ai_voice)) return new Response('Hittades inte', { status: 404 });
  const month = new URL(req.url).searchParams.get('m') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month)) return new Response('Ange månad (?m=ÅÅÅÅ-MM)', { status: 400 });
  return aiUsageWorkbook(month, { customerId: id, showCost: user.role === 'superadmin', filenameBase: customer.name });
}
