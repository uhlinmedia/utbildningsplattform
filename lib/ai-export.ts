import 'server-only';
import ExcelJS from 'exceljs';
import { estimatedCostSek, usageDetails } from './ai-usage';

// Excel med varje AI-röst under en månad: datum, kund, utbildning, avsnitt, användare, röst, tecken, minuter (och kostnad).
export async function aiUsageWorkbook(month: string, opts: { customerId?: string; showCost: boolean; filenameBase: string }) {
  const rows = await usageDetails(month, opts.customerId);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Briondo';
  const ws = wb.addWorksheet(`AI-uppläsning ${month}`);
  ws.columns = [
    { header: 'Datum', key: 'created_at', width: 18, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: 'Kund', key: 'customer', width: 24 },
    { header: 'Utbildning', key: 'course_title', width: 30 },
    { header: 'Avsnitt', key: 'section_title', width: 30 },
    { header: 'Skapad av', key: 'user_email', width: 28 },
    { header: 'Röst', key: 'voice', width: 14 },
    { header: 'Tecken', key: 'chars', width: 10 },
    { header: 'Minuter tal', key: 'minutes', width: 12, style: { numFmt: '0.0' } },
    ...(opts.showCost ? [{ header: 'Ca kostnad Google (kr)', key: 'cost', width: 20, style: { numFmt: '0.00' } }] : []),
  ];
  ws.getRow(1).font = { bold: true };
  let chars = 0, seconds = 0;
  for (const r of rows) {
    chars += r.chars; seconds += r.seconds;
    ws.addRow({ ...r, user_email: r.user_email ?? '', minutes: r.seconds / 60, cost: estimatedCostSek(r.seconds, month) });
  }
  const sum = ws.addRow({ customer: 'Summa', chars, minutes: seconds / 60, cost: estimatedCostSek(seconds, month) });
  sum.font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  const name = `ai-upplasning-${opts.filenameBase}-${month}.xlsx`.replace(/[^\wåäöÅÄÖ.-]+/g, '-');
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
