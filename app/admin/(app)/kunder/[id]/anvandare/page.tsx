import { requireCustomerPage } from '@/lib/access';
import { getCustomer } from '@/lib/course';
import { CustomerHeader } from '../CustomerHeader';
import { UsersPanel } from '../../../UsersPanel';

export const dynamic = 'force-dynamic';

export default async function CustomerUsersPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ fel?: string; inbjuden?: string; nollstalld?: string; lank?: string }>;
}) {
  const { id } = await params;
  const me = await requireCustomerPage(id, 'admin');
  const customer = (await getCustomer(id))!;
  return (
    <>
      <CustomerHeader user={me} customer={customer} active="anvandare" />
      <UsersPanel me={me} customerId={id} q={await searchParams} />
    </>
  );
}
