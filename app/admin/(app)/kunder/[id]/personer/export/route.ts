import ExcelJS from 'exceljs';
import { canReadCustomer } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getCustomer } from '@/lib/course';

// Personregistret som Excel, med antal godkända utbildningar och senaste genomförande.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await canReadCustomer(id))) return new Response('Hittades inte', { status: 404 });
  const customer = await getCustomer(id);
  const rows = await sql<{ name: string; email: string | null; employee_no: string | null; group_name: string; archived_at: Date | null; done: number; last: Date | null }[]>`
    select p.name, p.email, p.employee_no, p.group_name, p.archived_at,
      count(e.id) filter (where e.passed and not e.is_preview)::int as done,
      max(e.completed_at) filter (where e.passed and not e.is_preview) as last
    from person p left join learner l on l.person_id = p.id left join enrollment e on e.learner_id = l.id
    where p.customer_id = ${id} group by p.id order by p.archived_at nulls first, p.name`;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Briondo';
  const ws = wb.addWorksheet('Personregister');
  ws.columns = [
    { header: 'Namn', key: 'name', width: 28 },
    { header: 'E-post', key: 'email', width: 32 },
    { header: 'Anställningsnummer', key: 'employee_no', width: 20 },
    { header: 'Grupp', key: 'group_name', width: 18 },
    { header: 'Godkända utbildningar', key: 'done', width: 22 },
    { header: 'Senast godkänd', key: 'last', width: 16, style: { numFmt: 'yyyy-mm-dd' } },
    { header: 'Status', key: 'status', width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow({ ...r, status: r.archived_at ? 'Arkiverad' : 'Aktiv' });
  const buf = await wb.xlsx.writeBuffer();
  const name = (customer?.name ?? 'kund').replace(/[^\wåäöÅÄÖ-]+/g, '-');
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`personregister-${name}.xlsx`)}`,
    },
  });
}
