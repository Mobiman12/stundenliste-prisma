import { listDailyDayRecords } from '@/lib/data/daily-days';
import {
  getShiftPlan,
  getPlanHoursForDayFromPlan,
  getPlanHoursForDay,
  deriveCodeFromPlanLabel,
} from '@/lib/services/shift-plan';
import { getFooterPreferences, type FooterPreferences } from '@/lib/data/footer-preferences';
import { getEmployeeBonusEntry, getPreviousEmployeeBonusEntry } from '@/lib/data/employee-bonus';
import {
  getEmployeeOvertimePayout,
  sumEmployeeOvertimePayoutsUpTo,
} from '@/lib/data/employee-overtime-payouts';
import { calculateIstHours } from '@/lib/services/time-calculations';
import { getAdminEmployeeDetails, getEmployeeBonusConfiguration, type EmployeeAdminDetails, type BonusScheme, type BonusTier } from './employee';

type SummaryGroupId = 'sales' | 'bonus' | 'worktime' | 'absences';

export interface SummaryMetric {
  id: string;
  label: string;
  value: string;
  rawValue?: number;
}

export interface SummaryGroup {
  id: SummaryGroupId;
  title: string;
  metrics: SummaryMetric[];
}

export interface BonusSummary {
  available: number;
  calculated: number;
  previousCarry: number;
  paid: number;
  carry: number;
  editable: boolean;
  maxPayout: number;
  nextMonthLabel: string;
  currentMonthLabel: string;
}

export interface OvertimeSummary {
  available: number;
  paid: number;
  remaining: number;
  maxPayout: number;
  currentMonthLabel: string;
}

export interface MonthlySummaryResult {
  employee: EmployeeAdminDetails;
  groups: SummaryGroup[];
  bonus: BonusSummary;
  overtime: OvertimeSummary;
  preferences: FooterPreferences;
  month: number;
  year: number;
  monthLabel: string;
}

const DEFAULT_GROUP_PREFERENCES: FooterPreferences = {
  sales: true,
  bonus: true,
  worktime: true,
  absences: true,
};

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

const NON_WORK_CODES = new Set(['U', 'UH', 'FT', 'K', 'KK', 'KKR', 'KR', 'KU', 'UBF']);

const MIN_EFFECTIVE_HOURS = 0.005;

const formatPauseString = (minutes: number): string => (minutes > 0 ? `${minutes}min.` : 'Keine');

const computeNetHours = (start: string | null | undefined, end: string | null | undefined, pauseMinutes: number): number => {
  const result = calculateIstHours(start ?? '', end ?? '', null, null, formatPauseString(pauseMinutes));
  return result.netHours;
};

const sanitizeTimeValue = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    return trimmed.padStart(5, '0');
  }
  return trimmed;
};


const currencyFormatter = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const hoursFormatter = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DECIMAL_FACTOR = 100;

function roundTwo(value: number): number {
  return Math.round(value * DECIMAL_FACTOR) / DECIMAL_FACTOR;
}

function calculateTieredBonus(tiers: BonusTier[], netRevenue: number): number {
  if (!tiers.length || netRevenue <= 0) {
    return 0;
  }

  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
  let bonus = 0;

  for (let index = 0; index < sorted.length; index += 1) {
    const { threshold, percent } = sorted[index];
    if (netRevenue <= threshold) {
      break;
    }
    const nextThreshold = index + 1 < sorted.length ? sorted[index + 1].threshold : Number.POSITIVE_INFINITY;
    const applicableUpper = Math.min(netRevenue, nextThreshold);
    const portion = applicableUpper - threshold;
    if (portion > 0) {
      bonus += portion * (percent / 100);
    }
  }

  return bonus;
}



function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatCurrency(value: number): string {
  return `${currencyFormatter.format(value)} €`;
}

function formatHours(value: number): string {
  return `${hoursFormatter.format(value)} h`;
}

function formatCount(value: number): string {
  return value.toLocaleString('de-DE');
}

function monthName(month: number): string {
  const index = month - 1;
  return MONTH_NAMES[index] ?? '';
}

function nextMonth(year: number, month: number): { year: number; month: number } {
  if (month === 12) {
    return { year: year + 1, month: 1 };
  }
  return { year, month: month + 1 };
}

function previousMonth(year: number, month: number): { year: number; month: number } {
  if (month === 1) {
    return { year: year - 1, month: 12 };
  }
  return { year, month: month - 1 };
}

function ensurePreferences(preferences: FooterPreferences | null): FooterPreferences {
  if (!preferences) {
    return { ...DEFAULT_GROUP_PREFERENCES };
  }

  return {
    sales: preferences.sales ?? true,
    bonus: preferences.bonus ?? true,
    worktime: preferences.worktime ?? true,
    absences: preferences.absences ?? true,
  };
}

async function computeWorkdays(employeeId: number, year: number, month: number): Promise<Date[]> {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(endDate).padStart(2, '0')}`;
  const plan = await getShiftPlan(employeeId, { from: start, to: end });

  const days: Date[] = [];
  for (let day = 1; day <= endDate; day += 1) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const info = getPlanHoursForDayFromPlan(plan, iso);
    if (info && info.sollHours > 0) {
      days.push(new Date(`${iso}T00:00:00`));
    }
  }

  return days;
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function enumerateIsoRange(startIso: string, endIso: string): string[] {
  const startDate = parseIsoDate(startIso);
  const endDate = parseIsoDate(endIso);
  if (!startDate || !endDate || startDate > endDate) {
    return [];
  }
  const result: string[] = [];
  let current = startDate.getTime();
  const endTime = endDate.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  while (current <= endTime) {
    const iso = new Date(current).toISOString().slice(0, 10);
    result.push(iso);
    current += dayMs;
  }
  return result;
}

function isWithinMonth(date: Date, year: number, month: number): boolean {
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month;
}

function computeBonusAvailable(
  employee: EmployeeAdminDetails,
  year: number,
  month: number,
  monthlyTarget: number,
  monthlyRevenue: number,
  scheme: BonusScheme,
  tiers: BonusTier[]
): {
  calculated: number;
  previousCarry: number;
  available: number;
} {
  const revenueDelta = monthlyRevenue - monthlyTarget;
  const mehrUmsatzNetto = revenueDelta > 0 ? revenueDelta * (100 / 119) : 0;

  let calculated = 0;
  if (scheme.schemeType === 'stufen' && tiers.length) {
    calculated = roundTwo(calculateTieredBonus(tiers, mehrUmsatzNetto));
  } else {
    const fallbackPercent = Number(employee.monatlicher_bonus_prozent ?? 0);
    const percent = scheme.schemeType === 'linear' ? Number(scheme.linearPercent ?? fallbackPercent) : fallbackPercent;
    calculated = roundTwo((mehrUmsatzNetto * percent) / 100);
  }

  let previousCarry = 0;
  const previousEntry = getPreviousEmployeeBonusEntry(employee.id, year, month);
  if (previousEntry) {
    previousCarry = previousEntry.carryOver;
  } else {
    const entryDate = employee.entry_date ? parseIsoDate(employee.entry_date) : null;
    if (entryDate && entryDate.getUTCFullYear() === year && entryDate.getUTCMonth() + 1 === month) {
      previousCarry = Number(employee.imported_bonus_earned ?? 0);
    }
  }

  const available = roundTwo(previousCarry + calculated);
  return { calculated, previousCarry, available };
}

export async function getMonthlyAdminSummary(
  tenantId: string,
  employeeId: number,
  year: number,
  month: number
): Promise<MonthlySummaryResult> {
  const employee = await getAdminEmployeeDetails(tenantId, employeeId);
  if (!employee) {
    throw new Error('Mitarbeiter nicht gefunden.');
  }

  const bonusConfig = await getEmployeeBonusConfiguration(tenantId, employeeId);
  const { scheme, tiers } = bonusConfig;

  const allRecords = await listDailyDayRecords(employeeId);
  const monthlyRecords = allRecords
    .map((record) => ({ record, date: parseIsoDate(record.day_date) }))
    .filter((entry): entry is { record: typeof allRecords[number]; date: Date } => !!entry.date)
    .filter(({ date }) => isWithinMonth(date, year, month))
    .map(({ record }) => record);

  const startIso = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endIso = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const plan = await getShiftPlan(employeeId, { from: startIso, to: endIso });
  const recordByDate = new Map(monthlyRecords.map((record) => [record.day_date, record]));

  const planRecords = Object.entries(plan.days).reduce<typeof monthlyRecords>((acc, [isoDate, planDay]) => {
    if (!planDay) {
      return acc;
    }
    if (isoDate < startIso || isoDate > endIso) {
      return acc;
    }
    if (recordByDate.has(isoDate)) {
      return acc;
    }
    const planLabel = planDay.label?.trim();
    if (!planLabel) {
      return acc;
    }
    const syntheticCode = deriveCodeFromPlanLabel(planLabel);
    if (!syntheticCode) {
      return acc;
    }

    const effectiveStart = sanitizeTimeValue(planDay.start);
    const effectiveEnd = sanitizeTimeValue(planDay.end);
    const pauseMinutes = Number(planDay.requiredPauseMinutes ?? 0) || 0;
    const netHours = computeNetHours(effectiveStart, effectiveEnd, pauseMinutes);

    if (netHours <= MIN_EFFECTIVE_HOURS) {
      return acc;
    }

    acc.push({
      day_date: isoDate,
      brutto: 0,
      kommt1: null,
      geht1: null,
      kommt2: null,
      geht2: null,
      pause: 'Keine',
      code: syntheticCode,
      bemerkungen: null,
      mittag: 'Nein',
      schicht: planLabel,
      sick_hours: syntheticCode === 'K' ? netHours : 0,
      child_sick_hours: 0,
      short_work_hours: syntheticCode === 'KU' ? netHours : 0,
      vacation_hours: syntheticCode === 'U' ? netHours : 0,
      holiday_hours: syntheticCode === 'FT' ? netHours : 0,
      overtime_delta: 0,
      plan_hours: netHours,
      forced_overflow: 0,
      forced_overflow_real: 0,
      required_pause_under6_minutes: 0,
    } as typeof monthlyRecords[number]);

    return acc;
  }, []);

  const combinedRecords = [...monthlyRecords, ...planRecords];

  const planSollMap = new Map<string, number>();
  for (const isoDate of enumerateIsoRange(startIso, endIso)) {
    const info = getPlanHoursForDayFromPlan(plan, isoDate) ?? getPlanHoursForDay(employeeId, isoDate);
    const soll = info?.sollHours ?? 0;
    if (soll > 0) {
      planSollMap.set(isoDate, soll);
    }
  }

  for (const record of combinedRecords) {
    const code = (record.code ?? '').trim().toUpperCase();
    if (code === 'KU') {
      const iso = record.day_date;
      if (planSollMap.has(iso)) {
        planSollMap.set(iso, 0);
      }
    }
  }

  let planSollTotal = 0;
  for (const value of planSollMap.values()) {
    planSollTotal += value;
  }

  for (const record of combinedRecords) {
    const iso = record.day_date;
    const planHours = Number(record.plan_hours ?? 0);
    if (planHours > 0 && !planSollMap.has(iso)) {
      planSollTotal += planHours;
    }
  }

  const monthlySoll = roundTwo(planSollTotal);

  const monthEnd = new Date(Date.UTC(year, month, 0));

  const monthlyTarget = Number(employee.mind_jahresumsatz ?? 0) / 12;
  const monthlyRevenue = roundTwo(
    combinedRecords.reduce((acc, row) => acc + Number(row.brutto ?? 0), 0)
  );
  const restRevenue = roundTwo(monthlyTarget - monthlyRevenue);
  const workdays = await computeWorkdays(employeeId, year, month);

  const monthlyIst = roundTwo(
    combinedRecords.reduce((acc, row) => {
      const result = calculateIstHours(
        row.kommt1 ?? '',
        row.geht1 ?? '',
        row.kommt2 ?? '',
        row.geht2 ?? '',
        row.pause ?? 'Keine'
      );
      return acc + result.netHours;
    }, 0)
  );

  const monthlyOvertimePayoutRow = getEmployeeOvertimePayout(employeeId, year, month);
  const monthlyOvertimePayout = roundTwo(monthlyOvertimePayoutRow?.payoutHours ?? 0);
  const recordedForcedOverflow = combinedRecords.reduce(
    (acc, row) => acc + Number(row.forced_overflow ?? 0),
    0
  );
  const forcedOverflow = roundTwo(recordedForcedOverflow + monthlyOvertimePayout);

  const importedPlus = Number(employee.imported_overtime_balance ?? 0);
  const importedMinus = Number(employee.imported_minusstunden_balance ?? 0);
  const importedBalance = importedPlus - importedMinus;

  const overtimeUpToMonth = roundTwo(
    allRecords
      .map((record) => ({ record, date: parseIsoDate(record.day_date) }))
      .filter((entry): entry is { record: typeof allRecords[number]; date: Date } => !!entry.date)
      .filter(({ date }) => date <= monthEnd)
      .reduce((acc, entry) => acc + Number(entry.record.overtime_delta ?? 0), 0)
  );

  const totalOvertimePayouts = roundTwo(
    sumEmployeeOvertimePayoutsUpTo(employeeId, year, month)
  );

  const saldoBisMonatsEnde = roundTwo(importedBalance + overtimeUpToMonth - totalOvertimePayouts);

  const maxMinus = Number(employee.max_minusstunden ?? 0) || 0;
  const maxOvertime = Number(employee.max_ueberstunden ?? 0) || 0;
  const currentBalance = clamp(saldoBisMonatsEnde, -maxMinus, maxOvertime);
  const remainingOvertime = roundTwo(Math.max(currentBalance, 0));
  const availableOvertime = roundTwo(remainingOvertime + monthlyOvertimePayout);

  const sumSick = roundTwo(combinedRecords.reduce((acc, row) => acc + Number(row.sick_hours ?? 0), 0));
  const sumChild = roundTwo(
    combinedRecords.reduce((acc, row) => acc + Number(row.child_sick_hours ?? 0), 0)
  );
  const sumShortWork = roundTwo(
    combinedRecords.reduce((acc, row) => acc + Number(row.short_work_hours ?? 0), 0)
  );
  const sumOvertime = roundTwo(
    combinedRecords.reduce((acc, row) => acc + Number(row.overtime_delta ?? 0), 0)
  );
  const sumHoliday = roundTwo(
    combinedRecords.reduce((acc, row) => acc + Number(row.holiday_hours ?? 0), 0)
  );

  const allowMittag = (employee.sachbezug_verpflegung ?? '').toLowerCase() === 'ja';
  const verpflegungCount = allowMittag
    ? combinedRecords.filter((row) => {
        if ((row.mittag ?? '').toLowerCase() !== 'ja') {
          return false;
        }
        const code = (row.code ?? '').trim().toUpperCase();
        if (NON_WORK_CODES.has(code)) {
          return false;
        }
        return true;
      }).length
    : 0;

  const monthlyVacationDays = roundTwo(
    combinedRecords.reduce((acc, row) => {
      const code = (row.code ?? '').trim().toUpperCase();
      if (code === 'U') return acc + 1;
      if (code === 'UH') return acc + 0.5;
      return acc;
    }, 0)
  );

  const syntheticVacationDays = planRecords.reduce((acc, row) => {
    const code = (row.code ?? '').trim().toUpperCase();
    if (code === 'U') return acc + 1;
    if (code === 'UH') return acc + 0.5;
    return acc;
  }, 0);

  const recordedVacationDays = allRecords.reduce((acc, row) => {
    const code = (row.code ?? '').trim().toUpperCase();
    if (code === 'U') return acc + 1;
    if (code === 'UH') return acc + 0.5;
    return acc;
  }, Number(employee.imported_vacation_taken ?? 0));

  const totalVacationDays = roundTwo(recordedVacationDays + syntheticVacationDays);

  const { calculated, previousCarry, available } = computeBonusAvailable(
    employee,
    year,
    month,
    monthlyTarget,
    monthlyRevenue,
    scheme,
    tiers
  );
  const currentEntry = getEmployeeBonusEntry(employeeId, year, month);
  const bonusPaid = roundTwo(currentEntry?.payout ?? 0);
  const bonusCarry = roundTwo(currentEntry?.carryOver ?? clamp(available - bonusPaid, 0, available));

  const { year: nextYear, month: nextMonthValue } = nextMonth(year, month);
  const { year: prevYear, month: prevMonthValue } = previousMonth(year, month);

  const monthLabel = `${monthName(month)} ${year}`;
  const prevMonthLabel = `${monthName(prevMonthValue)} ${prevYear}`;
  const nextMonthLabel = `${monthName(nextMonthValue)} ${nextYear}`;

  const preferences = ensurePreferences(getFooterPreferences(employeeId));

  const groups: SummaryGroup[] = [
    {
      id: 'sales',
      title: 'Umsatzkennzahlen',
      metrics: [
        {
          id: 'monthly-target',
          label: 'Monatlicher Mindestumsatz (Brutto)',
          value: formatCurrency(monthlyTarget),
          rawValue: monthlyTarget,
        },
        {
          id: 'monthly-revenue',
          label: 'Bisher erzielter Umsatz',
          value: formatCurrency(monthlyRevenue),
          rawValue: monthlyRevenue,
        },
        {
          id: 'remaining-revenue',
          label: 'Rest-Umsatz bis Monatsende',
          value: formatCurrency(restRevenue),
          rawValue: restRevenue,
        },
      ],
    },
    {
      id: 'bonus',
      title: 'Umsatz-Bonus',
      metrics: [
        {
          id: 'bonus-calculated',
          label: `Berechneter Bonus für ${monthName(month)} ${year}`,
          value: formatCurrency(calculated),
          rawValue: calculated,
        },
        {
          id: 'bonus-previous',
          label: `Übertrag des Umsatz-Bonus aus ${prevMonthLabel}`,
          value: formatCurrency(previousCarry),
          rawValue: previousCarry,
        },
        {
          id: 'bonus-paid',
          label: 'Summe des ausbezahlten Umsatz-Bonus',
          value: formatCurrency(bonusPaid),
          rawValue: bonusPaid,
        },
        {
          id: 'bonus-carry',
          label: `Übertrag in ${nextMonthLabel}`,
          value: formatCurrency(bonusCarry),
          rawValue: bonusCarry,
        },
      ],
    },
    {
      id: 'worktime',
      title: 'Arbeitszeit & Überstunden',
      metrics: [
        {
          id: 'workdays',
          label: `Arbeitstage im ${monthName(month)} ${year}`,
          value: formatCount(workdays.length),
          rawValue: workdays.length,
        },
        {
          id: 'soll-hours',
          label: `SOLL Arbeitszeit für ${monthName(month)} ${year}`,
          value: formatHours(monthlySoll),
          rawValue: monthlySoll,
        },
        {
          id: 'ist-hours',
          label: `IST Arbeitszeit für ${monthName(month)} ${year}`,
          value: formatHours(monthlyIst),
          rawValue: monthlyIst,
        },
        {
          id: 'forced-overtime',
          label: 'Ausgezahlte Überstunden',
          value: formatHours(forcedOverflow),
          rawValue: forcedOverflow,
        },
        {
          id: 'current-balance',
          label: 'Aktuelles Stundenkonto',
          value: formatHours(currentBalance),
          rawValue: currentBalance,
        },
      ],
    },
    {
      id: 'absences',
      title: 'Abwesenheiten & Zählwerte',
      metrics: [
        {
          id: 'verpflegung',
          label: 'Verpflegung gezählt',
          value: allowMittag ? formatCount(verpflegungCount) : '–',
          rawValue: allowMittag ? verpflegungCount : undefined,
        },
        {
          id: 'sick-hours',
          label: 'Krankstunden (KR)',
          value: formatHours(sumSick),
          rawValue: sumSick,
        },
        {
          id: 'child-sick-hours',
          label: 'Kind krank (KK)',
          value: formatHours(sumChild),
          rawValue: sumChild,
        },
        {
          id: 'short-work-hours',
          label: 'Kurzarbeit (KU)',
          value: formatHours(sumShortWork),
          rawValue: sumShortWork,
        },
        {
          id: 'vacation-days-month',
          label: `Urlaub (U) im ${monthName(month)} ${year}`,
          value: `${hoursFormatter.format(monthlyVacationDays)} Tage`,
          rawValue: monthlyVacationDays,
        },
        {
          id: 'vacation-days-year',
          label: `Genommene Urlaubstage in ${year}`,
          value: `${hoursFormatter.format(totalVacationDays)} Tage`,
          rawValue: totalVacationDays,
        },
        {
          id: 'overtime-month',
          label: `Überstunden (Ü) im ${monthName(month)} ${year}`,
          value: formatHours(sumOvertime),
          rawValue: sumOvertime,
        },
        {
          id: 'holiday-hours',
          label: `Feiertage (FT) im ${monthName(month)} ${year}`,
          value: formatHours(sumHoliday),
          rawValue: sumHoliday,
        },
      ],
    },
  ];

  const bonus: BonusSummary = {
    available,
    calculated,
    previousCarry,
    paid: bonusPaid,
    carry: bonusCarry,
    editable: true,
    maxPayout: available,
    nextMonthLabel,
    currentMonthLabel: monthLabel,
  };

  const overtimeSummary: OvertimeSummary = {
    available: availableOvertime,
    paid: monthlyOvertimePayout,
    remaining: remainingOvertime,
    maxPayout: availableOvertime,
    currentMonthLabel: monthLabel,
  };

  return {
    employee,
    groups,
    bonus,
    overtime: overtimeSummary,
    preferences,
    month,
    year,
    monthLabel,
  };
}
