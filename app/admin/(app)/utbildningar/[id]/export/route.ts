import ExcelJS from 'exceljs';
import { canReadCustomer } from '@/lib/auth';
import { getCourseById, getCustomer } from '@/lib/course';
import { getCourseStats, learnerStatus } from '@/lib/stats';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const course = /^[0-9a-f-]{36}$/i.test(id) ? await getCourseById(id) : null;
  if (!course || !(await canReadCustomer(course.customer_id))) return new Response('Hittades inte', { status: 404 });
  const customer = await getCustomer(course.customer_id);
  const { kpi, funnel, questions, learners, sectionCount } = await getCourseStats(id);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Briondo';
  const date = new Date().toLocaleDateString('sv-SE');

  const sum = wb.addWorksheet('Sammanfattning');
  sum.columns = [{ width: 34 }, { width: 18 }];
  sum.addRows([
    ['Kund', customer?.name ?? ''],
    ['Utbildning', course.title],
    ['Rapportdatum', date],
    [],
    ['Startade', kpi.started],
    ['Slutförda', kpi.completed],
    ['Godkända', kpi.passed],
    ['Genomsnittlig tid (min)', kpi.avg_minutes ?? ''],
    [],
    ['Kapitel', 'Andel klara (%)'],
    ...funnel.map((f, i) => [`${i + 1}. ${f.title}`, kpi.started ? Math.round((f.learners / kpi.started) * 100) : 0]),
  ]);
  sum.getColumn(1).font = { bold: false };
  [1, 2, 3, 5, 6, 7, 8, 10].forEach((r) => (sum.getCell(`A${r}`).font = { bold: true }));

  const el = wb.addWorksheet('Elever');
  el.columns = [
    { header: 'Namn', key: 'name', width: 28 },
    { header: 'E-post', key: 'email', width: 30 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Resultat (%)', key: 'score', width: 12 },
    { header: 'Startad', key: 'start', width: 12 },
    { header: 'Slutförd', key: 'done', width: 12 },
    { header: 'Certifikat-ID', key: 'cert', width: 16 },
  ];
  el.getRow(1).font = { bold: true };
  for (const l of learners) {
    el.addRow({
      name: l.name,
      email: l.email ?? '',
      status: learnerStatus(l, sectionCount),
      score: l.score_percent ?? '',
      start: new Date(l.started_at).toLocaleDateString('sv-SE'),
      done: l.completed_at ? new Date(l.completed_at).toLocaleDateString('sv-SE') : '',
      cert: l.certificate_id ?? '',
    });
  }

  const fr = wb.addWorksheet('Frågor');
  fr.columns = [
    { header: 'Avsnitt', key: 's', width: 10 },
    { header: 'Fråga', key: 'q', width: 60 },
    { header: 'Antal svar', key: 'n', width: 12 },
    { header: 'Rätt första försöket (%)', key: 'p', width: 24 },
  ];
  fr.getRow(1).font = { bold: true };
  for (const q of questions) fr.addRow({ s: q.section, q: q.question, n: q.answered, p: q.percent ?? '' });

  const buf = await wb.xlsx.writeBuffer();
  const safe = course.title.replace(/[^\p{L}\p{N} -]/gu, '').trim().replace(/\s+/g, '-');
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`rapport-${safe}-${date}.xlsx`)}`,
      'Cache-Control': 'private, no-store',
    },
  });
}
