import { sessionUser } from '@/lib/access';
import { aiUsageWorkbook } from '@/lib/ai-export';

// AI-uppläsning för alla kunder och en månad som Excel (?m=ÅÅÅÅ-MM). Bara superadmin.
export async function GET(req: Request) {
  const user = await sessionUser();
  if (!user || user.role !== 'superadmin') return new Response('Hittades inte', { status: 404 });
  const month = new URL(req.url).searchParams.get('m') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month)) return new Response('Ange månad (?m=ÅÅÅÅ-MM)', { status: 400 });
  return aiUsageWorkbook(month, { showCost: true, filenameBase: 'alla-kunder' });
}
