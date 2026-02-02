import { listDailyDayRecords, type DailyDayRecord } from '@/lib/data/daily-days';
import { getEmployeeOvertimePayout } from '@/lib/data/employee-overtime-payouts';
import { calculateIstHours } from '@/lib/services/time-calculations';

const MONTH_NAMES = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

export interface EmployeeMonthlyOverviewEntry {
  isoDate: string;
  displayDate: string;
  brutto: number;
  kommt1: string | null;
  geht1: string | null;
  kommt2: string | null;
  geht2: string | null;
  pause: string | null;
  istHours: number;
  sollHours: number;
  overtimeDelta: number;
  code: string;
  remark: string | null;
}

export interface EmployeeMonthlyTotals {
  istHours: number;
  sollHours: number;
  differenceHours: number;
  overtimeDelta: number;
  brutto: number;
  workedDays: number;
  averageIstPerDay: number;
}

export interface EmployeeMonthlyBreakdown {
  sickHours: number;
  childSickHours: number;
  shortWorkHours: number;
  vacationHours: number;
  holidayHours: number;
  forcedOverflow: number;
  mealCount: number;
  overtimePayoutHours?: number;
}

export interface EmployeeCodeCount {
  code: string;
  count: number;
}

export interface EmployeeMonthlyOverview {
  years: number[];
  months: number[];
  selectedYear: number;
  selectedMonth: number;
  monthLabel: string;
  entries: EmployeeMonthlyOverviewEntry[];
  totals: EmployeeMonthlyTotals;
  breakdown: EmployeeMonthlyBreakdown;
  codeCounts: EmployeeCodeCount[];
}

function toDate(value: string): Date | null {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function ensureSelection(records: DailyDayRecord[], preferredYear?: number, preferredMonth?: number) {
  const dates = records
    .map((row) => toDate(row.day_date))
    .filter((date): date is Date => !!date);

  if (!dates.length) {
    const today = new Date();
    return {
      years: [] as number[],
      months: [] as number[],
      selectedYear: today.getFullYear(),
      selectedMonth: today.getMonth() + 1,
    };
  }

  const years = Array.from(new Set(dates.map((date) => date.getFullYear()))).sort((a, b) => a - b);
  const targetYear =
    preferredYear && years.includes(preferredYear) ? preferredYear : years[years.length - 1];

  const months = Array.from(
    new Set(
      dates
        .filter((date) => date.getFullYear() === targetYear)
        .map((date) => date.getMonth() + 1)
    )
  ).sort((a, b) => a - b);

  const targetMonth =
    preferredMonth && months.includes(preferredMonth) ? preferredMonth : months[months.length - 1];

  return { years, months, selectedYear: targetYear, selectedMonth: targetMonth };
}

function toEntry(row: DailyDayRecord): EmployeeMonthlyOverviewEntry {
  const istResult = calculateIstHours(
    row.kommt1 ?? '',
    row.geht1 ?? '',
    row.kommt2 ?? '',
    row.geht2 ?? '',
    row.pause ?? 'Keine'
  );

  return {
    isoDate: row.day_date,
    displayDate: new Date(`${row.day_date}T00:00:00`).toLocaleDateString('de-DE'),
    brutto: Number(row.brutto ?? 0),
    kommt1: row.kommt1,
    geht1: row.geht1,
    kommt2: row.kommt2,
    geht2: row.geht2,
    pause: row.pause ?? null,
    istHours: Number(istResult.netHours.toFixed(2)),
    sollHours: Number(Number(row.plan_hours ?? 0).toFixed(2)),
    overtimeDelta: Number(Number(row.overtime_delta ?? 0).toFixed(2)),
    code: (row.code ?? '').trim(),
    remark: row.bemerkungen ?? null,
  };
}

function summarizeTotals(entries: EmployeeMonthlyOverviewEntry[]): EmployeeMonthlyTotals {
  const base = {
    istHours: 0,
    sollHours: 0,
    differenceHours: 0,
    overtimeDelta: 0,
    brutto: 0,
    workedDays: 0,
    averageIstPerDay: 0,
  };

  if (!entries.length) {
    return base;
  }

  const aggregate = entries.reduce(
    (acc, entry) => {
      acc.istHours += entry.istHours;
      acc.sollHours += entry.sollHours;
      acc.overtimeDelta += entry.overtimeDelta;
      acc.brutto += entry.brutto;
      acc.workedDays += 1;
      return acc;
    },
    { ...base }
  );

  aggregate.differenceHours = Number((aggregate.istHours - aggregate.sollHours).toFixed(2));
  aggregate.averageIstPerDay =
    aggregate.workedDays > 0
      ? Number((aggregate.istHours / aggregate.workedDays).toFixed(2))
      : 0;

  aggregate.istHours = Number(aggregate.istHours.toFixed(2));
  aggregate.sollHours = Number(aggregate.sollHours.toFixed(2));
  aggregate.overtimeDelta = Number(aggregate.overtimeDelta.toFixed(2));
  aggregate.brutto = Number(aggregate.brutto.toFixed(2));

  return aggregate;
}

function summarizeBreakdown(rows: DailyDayRecord[]): EmployeeMonthlyBreakdown {
  const lower = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();
  const result = rows.reduce(
    (acc, row) => {
      acc.sickHours += Number(row.sick_hours ?? 0);
      acc.childSickHours += Number(row.child_sick_hours ?? 0);
      acc.shortWorkHours += Number(row.short_work_hours ?? 0);
      acc.vacationHours += Number(row.vacation_hours ?? 0);
      acc.holidayHours += Number(row.holiday_hours ?? 0);
      acc.forcedOverflow += Number(row.forced_overflow ?? 0);
      if (lower(row.mittag) === 'ja') {
        acc.mealCount += 1;
      }
      return acc;
    },
    {
      sickHours: 0,
      childSickHours: 0,
      shortWorkHours: 0,
      vacationHours: 0,
      holidayHours: 0,
      forcedOverflow: 0,
      mealCount: 0,
    }
  );

  return {
    sickHours: Number(result.sickHours.toFixed(2)),
    childSickHours: Number(result.childSickHours.toFixed(2)),
    shortWorkHours: Number(result.shortWorkHours.toFixed(2)),
    vacationHours: Number(result.vacationHours.toFixed(2)),
    holidayHours: Number(result.holidayHours.toFixed(2)),
    forcedOverflow: Number(result.forcedOverflow.toFixed(2)),
    mealCount: result.mealCount,
  };
}

function summarizeCodes(rows: DailyDayRecord[]): EmployeeCodeCount[] {
  if (!rows.length) {
    return [];
  }

  const counts = new Map<string, number>();

  for (const row of rows) {
    const code = (row.code ?? '').trim() || '—';
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code, 'de-DE'));
}

export async function getEmployeeMonthlyOverview(
  employeeId: number,
  preferredYear?: number,
  preferredMonth?: number
): Promise<EmployeeMonthlyOverview> {
  const records = await listDailyDayRecords(employeeId);
  const selection = ensureSelection(records, preferredYear, preferredMonth);

  const monthlyRows = records.filter((row) => {
    const date = toDate(row.day_date);
    if (!date) return false;
    return (
      date.getFullYear() === selection.selectedYear &&
      date.getMonth() + 1 === selection.selectedMonth
    );
  });

  const entries = monthlyRows.map(toEntry).sort((a, b) => (a.isoDate < b.isoDate ? -1 : 1));
  const totals = summarizeTotals(entries);
  const breakdownBase = summarizeBreakdown(monthlyRows);
  const overtimePayoutRow = getEmployeeOvertimePayout(
    employeeId,
    selection.selectedYear,
    selection.selectedMonth
  );
  const overtimeRaw = Number(overtimePayoutRow?.payoutHours ?? 0);
  const overtimePayoutHours = Number(overtimeRaw.toFixed(2));
  const breakdown: EmployeeMonthlyBreakdown = {
    ...breakdownBase,
    forcedOverflow: Number((breakdownBase.forcedOverflow + overtimePayoutHours).toFixed(2)),
    overtimePayoutHours,
  };
  const codeCounts = summarizeCodes(monthlyRows);

  const monthIndex = selection.selectedMonth - 1;
  const monthName = MONTH_NAMES[monthIndex] ?? '';
  const monthLabel = monthName ? `${monthName} ${selection.selectedYear}` : `${selection.selectedYear}-${String(selection.selectedMonth).padStart(2, '0')}`;

  return {
    years: selection.years,
    months: selection.months,
    selectedYear: selection.selectedYear,
    selectedMonth: selection.selectedMonth,
    monthLabel,
    entries,
    totals,
    breakdown,
    codeCounts,
  };
}
