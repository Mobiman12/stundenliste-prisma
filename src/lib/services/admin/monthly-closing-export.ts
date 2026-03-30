import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';

import { listDailyDayRecords, type DailyDayRecord } from '@/lib/data/daily-days';
import { getEmployeeBonusEntry } from '@/lib/data/employee-bonus';
import { getEmployeeOvertimePayout } from '@/lib/data/employee-overtime-payouts';
import { getMonthlyClosingStates } from '@/lib/services/admin/monthly-closing';
import { getMonthlyAdminSummary } from '@/lib/services/admin/employee-summary';
import { getAdminEmployeeList } from '@/lib/services/admin/employee';
import { getShiftPlan, getPlanHoursForDayFromPlan } from '@/lib/services/shift-plan';
import { getPrisma } from '@/lib/prisma';

export type PayrollExportFormat = 'csv' | 'xlsx' | 'pdf';

export type PayrollExportRow = {
  personalNr: string;
  mitarbeiter: string;
  verguetungEuro: number;
  sollStunden: number;
  sachbezugEuro: number;
  verpflegungAnzahl: number;
  ausgezahlteUeberstunden: number;
  autoAusgezahltUeStd: number;
  bonusAusbezahltEuro: number;
  krankStunden: number;
  kranktageZeitraeume: string;
  kindKrankStunden: number;
  kindKranktageZeitraeume: string;
  unbezahlteFehlstunden: number;
};

const HOURS_DECIMALS = 2;
const NON_BREAKING_SPACE = '\u00a0';

function round2(value: number): number {
  return Number(Number.isFinite(value) ? value.toFixed(HOURS_DECIMALS) : '0');
}

function monthBounds(year: number, month: number): { startIso: string; endIso: string } {
  const paddedMonth = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  return {
    startIso: `${year}-${paddedMonth}-01`,
    endIso: `${year}-${paddedMonth}-${String(lastDay).padStart(2, '0')}`,
  };
}

function inMonth(isoDate: string, startIso: string, endIso: string): boolean {
  return isoDate >= startIso && isoDate <= endIso;
}

function formatGermanDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return iso;
  return `${day}.${month}.${year}`;
}

function toRanges(isoDates: string[]): string {
  if (!isoDates.length) return '';
  const sorted = Array.from(new Set(isoDates)).sort();
  const ranges: Array<{ start: string; end: string }> = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;

  const nextIsoDay = (iso: string): string => {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  };

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index]!;
    if (current === nextIsoDay(prev)) {
      prev = current;
      continue;
    }
    ranges.push({ start, end: prev });
    start = current;
    prev = current;
  }
  ranges.push({ start, end: prev });

  return ranges
    .map((range) =>
      range.start === range.end
        ? formatGermanDate(range.start)
        : `${formatGermanDate(range.start)} - ${formatGermanDate(range.end)}`
    )
    .join('; ');
}

function getMetricRaw(summary: Awaited<ReturnType<typeof getMonthlyAdminSummary>>, metricId: string): number {
  for (const group of summary.groups) {
    const metric = group.metrics.find((entry) => entry.id === metricId);
    if (!metric) continue;
    return Number(metric.rawValue ?? 0);
  }
  return 0;
}

function formatDecimal(value: number): string {
  return value.toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function csvEscape(value: string): string {
  if (value.includes(';') || value.includes('"') || value.includes('\n')) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function toCsv(rows: PayrollExportRow[]): string {
  const header = [
    'Personal-Nr.',
    'Mitarbeiter',
    'SOLL-Stunden',
    'Vergütung (€)',
    'Sachbezug (€)',
    'Verpflegung (Anz.)',
    'Ausgezahlte Überstunden (h)',
    'auto.ausgez. Ü-Std. (h)',
    'Bonus ausbezahlt (€)',
    'Krank (h)',
    'Kranktage Zeiträume',
    'Kind krank (h)',
    'Kindkranktage Zeiträume',
    'unbezahlte Fehlstunden (h)',
  ];

  const lines = rows.map((row) =>
    [
      row.personalNr,
      row.mitarbeiter,
      formatDecimal(row.sollStunden),
      formatDecimal(row.verguetungEuro),
      formatDecimal(row.sachbezugEuro),
      String(row.verpflegungAnzahl),
      formatDecimal(row.ausgezahlteUeberstunden),
      formatDecimal(row.autoAusgezahltUeStd),
      formatDecimal(row.bonusAusbezahltEuro),
      formatDecimal(row.krankStunden),
      row.kranktageZeitraeume,
      formatDecimal(row.kindKrankStunden),
      row.kindKranktageZeitraeume,
      formatDecimal(row.unbezahlteFehlstunden),
    ]
      .map((value) => csvEscape(value))
      .join('; ')
  );

  return [header.join('; '), ...lines].join('\n');
}

function toXlsx(rows: PayrollExportRow[], year: number, month: number): Buffer {
  const aoa: Array<Array<string | number>> = [
    [
      'Personal-Nr.',
      'Mitarbeiter',
      'SOLL-Stunden',
      'Vergütung (€)',
      'Sachbezug (€)',
      'Verpflegung (Anz.)',
      'Ausgezahlte Überstunden (h)',
      'auto.ausgez. Ü-Std. (h)',
      'Bonus ausbezahlt (€)',
      'Krank (h)',
      'Kranktage Zeiträume',
      'Kind krank (h)',
      'Kindkranktage Zeiträume',
      'unbezahlte Fehlstunden (h)',
    ],
  ];

  for (const row of rows) {
    aoa.push([
      row.personalNr,
      row.mitarbeiter,
      row.sollStunden,
      row.verguetungEuro,
      row.sachbezugEuro,
      row.verpflegungAnzahl,
      row.ausgezahlteUeberstunden,
      row.autoAusgezahltUeStd,
      row.bonusAusbezahltEuro,
      row.krankStunden,
      row.kranktageZeitraeume,
      row.kindKrankStunden,
      row.kindKranktageZeitraeume,
      row.unbezahlteFehlstunden,
    ]);
  }

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!cols'] = [
    { wch: 14 },
    { wch: 30 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 16 },
    { wch: 16 },
    { wch: 14 },
    { wch: 10 },
    { wch: 36 },
    { wch: 12 },
    { wch: 36 },
    { wch: 14 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, `Monat ${String(month).padStart(2, '0')}-${year}`);
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
}

function toPdf(rows: PayrollExportRow[], year: number, month: number): Buffer {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = 297;
  const pageHeight = 210;
  const marginX = 8;
  const marginY = 10;
  const printableWidth = pageWidth - marginX * 2;

  const headers = [
    'Personal-Nr.',
    'Mitarbeiter',
    'SOLL (h)',
    'Vergütung (€)',
    'Sachbez. (€)',
    'Verpfl.',
    'Ausgez. Ü (h)',
    'Auto Ü (h)',
    'Bonus (€)',
    'Krank (h)',
    'Kranktage Zeiträume',
    'Kind krank (h)',
    'Kindkranktage Zeiträume',
    'UBF (h)',
  ];
  const widths = [14, 26, 14, 15, 14, 11, 15, 14, 13, 12, 30, 14, 30, 12];
  const widthTotal = widths.reduce((sum, value) => sum + value, 0);
  const scale = printableWidth / widthTotal;
  const scaledWidths = widths.map((width) => width * scale);

  const title = `Monatsabschluss Lohnexport ${String(month).padStart(2, '0')}/${year}`;
  doc.setFontSize(12);
  doc.text(title, marginX, marginY);

  doc.setFontSize(7.5);
  const lineHeight = 3.4;
  let cursorY = marginY + 6;

  const drawHeader = () => {
    let cursorX = marginX;
    const headerHeight = 8;
    for (let index = 0; index < headers.length; index += 1) {
      const width = scaledWidths[index]!;
      doc.rect(cursorX, cursorY, width, headerHeight);
      const lines = doc.splitTextToSize(headers[index]!, width - 1.4);
      doc.text(lines, cursorX + 0.7, cursorY + 2.8, { baseline: 'top' });
      cursorX += width;
    }
    cursorY += headerHeight;
  };

  const drawRow = (values: string[]) => {
    const linesPerCell = values.map((value, index) =>
      doc.splitTextToSize(value || NON_BREAKING_SPACE, scaledWidths[index]! - 1.4)
    );
    const maxLines = Math.max(...linesPerCell.map((lines) => lines.length), 1);
    const rowHeight = Math.max(5.5, maxLines * lineHeight + 1.2);

    if (cursorY + rowHeight > pageHeight - marginY) {
      doc.addPage('a4', 'landscape');
      cursorY = marginY;
      drawHeader();
    }

    let cursorX = marginX;
    for (let index = 0; index < values.length; index += 1) {
      const width = scaledWidths[index]!;
      doc.rect(cursorX, cursorY, width, rowHeight);
      doc.text(linesPerCell[index]!, cursorX + 0.7, cursorY + 1.8, { baseline: 'top' });
      cursorX += width;
    }

    cursorY += rowHeight;
  };

  drawHeader();
  for (const row of rows) {
    drawRow([
      row.personalNr,
      row.mitarbeiter,
      formatDecimal(row.sollStunden),
      formatDecimal(row.verguetungEuro),
      formatDecimal(row.sachbezugEuro),
      String(row.verpflegungAnzahl),
      formatDecimal(row.ausgezahlteUeberstunden),
      formatDecimal(row.autoAusgezahltUeStd),
      formatDecimal(row.bonusAusbezahltEuro),
      formatDecimal(row.krankStunden),
      row.kranktageZeitraeume,
      formatDecimal(row.kindKrankStunden),
      row.kindKranktageZeitraeume,
      formatDecimal(row.unbezahlteFehlstunden),
    ]);
  }

  return Buffer.from(doc.output('arraybuffer'));
}

function computeMonthlyRecords(records: DailyDayRecord[], startIso: string, endIso: string): DailyDayRecord[] {
  return records.filter((record) => inMonth(record.day_date, startIso, endIso));
}

export async function buildPayrollExportRows(
  tenantId: string,
  year: number,
  month: number,
  selectedEmployeeIds?: number[]
): Promise<PayrollExportRow[]> {
  const prisma = getPrisma();
  const employees = await getAdminEmployeeList(tenantId);
  const closingStates = await getMonthlyClosingStates(
    employees.map((employee) => employee.id),
    year,
    month
  );
  const closedEmployeeIds = employees
    .map((employee) => employee.id)
    .filter((employeeId) => closingStates.get(employeeId)?.status === 'closed');

  const targetEmployeeIds =
    selectedEmployeeIds && selectedEmployeeIds.length > 0
      ? closedEmployeeIds.filter((id) => selectedEmployeeIds.includes(id))
      : closedEmployeeIds;

  if (!targetEmployeeIds.length) {
    return [];
  }

  const employeeRows = await prisma.employee.findMany({
    where: {
      tenantId,
      id: { in: targetEmployeeIds },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      personnelNumber: true,
      hourlyWage: true,
      compensationType: true,
      monthlySalaryGross: true,
      sachbezuege: true,
      sachbezuegeAmount: true,
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });

  const { startIso, endIso } = monthBounds(year, month);
  const rows: PayrollExportRow[] = [];

  for (const employee of employeeRows) {
    const summary = await getMonthlyAdminSummary(tenantId, employee.id, year, month);
    const allRecords = await listDailyDayRecords(employee.id);
    const monthlyRecords = computeMonthlyRecords(allRecords, startIso, endIso);
    const shiftPlan = await getShiftPlan(employee.id, { from: startIso, to: endIso });

    const overtimePayout = (await getEmployeeOvertimePayout(employee.id, year, month))?.payoutHours ?? 0;
    const bonusPayout = (await getEmployeeBonusEntry(employee.id, year, month))?.payout ?? 0;
    const verpflegungCount = round2(getMetricRaw(summary, 'verpflegung'));
    const sickHours = round2(getMetricRaw(summary, 'sick-hours'));
    const childSickHours = round2(getMetricRaw(summary, 'child-sick-hours'));
    const sollHours = round2(getMetricRaw(summary, 'soll-hours'));
    const verguetungEuro = round2(
      employee.compensationType === 'fixed'
        ? Number(employee.monthlySalaryGross ?? 0)
        : Number(employee.hourlyWage ?? 0)
    );

    const sickDates = monthlyRecords
      .filter((record) => {
        const code = (record.code ?? '').trim().toUpperCase();
        return record.sick_hours > 0 || code === 'K' || code === 'KR';
      })
      .map((record) => record.day_date);

    const childSickDates = monthlyRecords
      .filter((record) => {
        const code = (record.code ?? '').trim().toUpperCase();
        return record.child_sick_hours > 0 || code === 'KK' || code === 'KKR';
      })
      .map((record) => record.day_date);

    const autoPayoutHours = round2(
      monthlyRecords.reduce((sum, record) => sum + Number(record.forced_overflow_real ?? 0), 0)
    );

    const unpaidHours = round2(
      monthlyRecords.reduce((sum, record) => {
        const code = (record.code ?? '').trim().toUpperCase();
        if (code !== 'UBF') return sum;
        const storedPlanHours = Number(record.plan_hours ?? 0);
        if (storedPlanHours > 0) return sum + storedPlanHours;
        const fallbackPlan = getPlanHoursForDayFromPlan(shiftPlan, record.day_date, record.schicht ?? '');
        return sum + Number(fallbackPlan?.sollHours ?? 0);
      }, 0)
    );

    rows.push({
      personalNr: employee.personnelNumber ?? '',
      mitarbeiter: `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim(),
      verguetungEuro,
      sollStunden: sollHours,
      sachbezugEuro:
        (employee.sachbezuege ?? '').trim().toLowerCase() === 'ja'
          ? round2(Number(employee.sachbezuegeAmount ?? 0))
          : 0,
      verpflegungAnzahl: Math.round(verpflegungCount),
      ausgezahlteUeberstunden: round2(overtimePayout),
      autoAusgezahltUeStd: autoPayoutHours,
      bonusAusbezahltEuro: round2(bonusPayout),
      krankStunden: sickHours,
      kranktageZeitraeume: toRanges(sickDates),
      kindKrankStunden: childSickHours,
      kindKranktageZeitraeume: toRanges(childSickDates),
      unbezahlteFehlstunden: unpaidHours,
    });
  }

  return rows;
}

export async function createPayrollExportFile(
  tenantId: string,
  year: number,
  month: number,
  format: PayrollExportFormat,
  selectedEmployeeIds?: number[]
): Promise<{ filename: string; contentType: string; body: Buffer }> {
  const rows = await buildPayrollExportRows(tenantId, year, month, selectedEmployeeIds);
  const base = `monatsabschluss-lohnexport-${year}-${String(month).padStart(2, '0')}`;

  if (format === 'xlsx') {
    return {
      filename: `${base}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: toXlsx(rows, year, month),
    };
  }

  if (format === 'pdf') {
    return {
      filename: `${base}.pdf`,
      contentType: 'application/pdf',
      body: toPdf(rows, year, month),
    };
  }

  return {
    filename: `${base}.csv`,
    contentType: 'text/csv; charset=utf-8',
    body: Buffer.from(toCsv(rows), 'utf8'),
  };
}
