import 'server-only';
import { can, sessionUser } from './access';

// Får den inloggade användaren läsa (t.ex. förhandsvisa) innehåll hos kunden?
export async function canReadCustomer(customerId: string | null | undefined) {
  const u = await sessionUser();
  return !!u && can(u, customerId, 'read');
}
