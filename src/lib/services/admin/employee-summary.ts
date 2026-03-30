import { listDailyDayRecords } from '@/lib/data/daily-days';
import { listLeaveRequestsForEmployee } from '@/lib/data/leave-requests';
import {
  hasSuccessfulVacationCarryNotificationBefore,
  listVacationCarryNotificationsForEmployee,
  type VacationCarryNotificationRow,
} from '@/lib/data/vacation-carry-notifications';
import {
  getShiftPlan,
  getPlanHoursForDayFromPlan,
  getPlanHoursForDay,
  deriveCodeFromPlanLabel,
} from '@/lib/services/shift-plan';
import { getFooterPreferences, saveFooterPreferences, type FooterPreferences } from '@/lib/data/footer-preferences';
import { getEmployeeBonusEntry, getPreviousEmployeeBonusEntry, upsertEmployeeBonusEntry } from '@/lib/data/employee-bonus';
import {
  getEmployeeOvertimePayout,
  upsertEmployeeOvertimePayout,
  sumEmployeeOvertimePayoutsUpTo,
} from '@/lib/data/employee-overtime-payouts';
import { createEmployeeOvertimeAdjustment, listEmployeeOvertimeAdjustments } from '@/lib/data/employee-overtime-adjustments';
import { listMonthlyClosings } from '@/lib/data/monthly-closings';
import { calculateIstHours, calculateLegalPauseHours } from '@/lib/services/time-calculations';
import { toLocalIsoDate } from '@/lib/date/local-iso';
import { getAdminEmployeeDetails, getEmployeeBonusConfiguration, saveEmployeeOvertimeBalance, type EmployeeAdminDetails, type BonusScheme, type BonusTier } from './employee';
import { computeVacationBalance, resolveCarryExpiryIsoForYear } from '@/lib/services/vacation-balance';
import { sendVacationCarryExpiryNotification } from '@/lib/services/vacation-carry-notification';

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
  minPayout: number;
  maxPayout: number;
  currentBalance: number;
  baseBalance: number;
  manualCorrection: number;
  plannedReduction: number;
  remainingAfterPlanned: number;
  currentMonthLabel: string;
  adjustments: Array<{
    id: number;
    year: number;
    month: number;
    deltaHours: number;
    balanceBefore: number;
    balanceAfter: number;
    correctionBefore: number;
    correctionAfter: number;
    createdByAdminName: string | null;
    createdAt: string;
  }>;
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

export interface AdminEmployeeSummaryReadBlock {
  closedMonths: string[];
  vacationCarryNotifications: VacationCarryNotificationRow[];
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

function applyMandatoryPauseToPlanHours(
  rawHours: number,
  requiredPauseMinutes: number,
  settings: {
    enabled: boolean;
    minPauseUnder6Minutes: number;
    mandatoryPauseMinWorkMinutes: number;
  }
): number {
  const safeRaw = Math.max(rawHours, 0);
  if (safeRaw <= 0) return 0;

  const legalPauseMinutes = calculateLegalPauseHours(safeRaw) * 60;
  let enforcedPauseMinutes = Math.max(Math.max(requiredPauseMinutes, 0), legalPauseMinutes);

  if (settings.enabled) {
    const mandatoryPauseSetting = Math.max(settings.minPauseUnder6Minutes, 0);
    const mandatoryMinWorkSetting = Math.max(settings.mandatoryPauseMinWorkMinutes, 0);
    if (mandatoryPauseSetting > 0) {
      const rawMinutes = Math.round(safeRaw * 60);
      const mandatoryApplies =
        rawMinutes > 0 &&
        rawMinutes <= 360 &&
        (mandatoryMinWorkSetting <= 0 || rawMinutes + 0.9 >= mandatoryMinWorkSetting);
      if (mandatoryApplies && mandatoryPauseSetting > enforcedPauseMinutes) {
        enforcedPauseMinutes = mandatoryPauseSetting;
      }
    }
  }

  return Number(Math.max(safeRaw - enforcedPauseMinutes / 60, 0).toFixed(2));
}

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

function nextYearMonth(year: number, month: number): { year: number; month: number } {
  if (month >= 12) {
    return { year: year + 1, month: 1 };
  }
  return { year, month: month + 1 };
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

function formatDateLabel(expiryValue: string | null | undefined, year: number): string | null {
  if (!expiryValue) return null;
  const resolvedIso = resolveCarryExpiryIsoForYear(year, expiryValue);
  if (!resolvedIso) return null;
  const parsed = new Date(`${resolvedIso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('de-DE');
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

function getOpeningAnchorDate(employee: EmployeeAdminDetails): Date | null {
  return parseIsoDate(employee.opening_effective_date ?? employee.entry_date ?? '');
}

function isYearMonthAfterDate(year: number, month: number, anchorDate: Date | null): boolean {
  if (!anchorDate) return true;
  const y = anchorDate.getUTCFullYear();
  const m = anchorDate.getUTCMonth() + 1;
  if (year > y) return true;
  if (year < y) return false;
  return month > m;
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
    const iso = toLocalIsoDate(new Date(current));
    result.push(iso);
    current += dayMs;
  }
  return result;
}

function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number.parseInt(match[1] ?? '', 10);
  const minutes = Number.parseInt(match[2] ?? '', 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function toDurationHours(startTime: string | null | undefined, endTime: string | null | undefined): number {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return 0;
  return roundTwo((endMinutes - startMinutes) / 60);
}

function isWithinMonth(date: Date, year: number, month: number): boolean {
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month;
}

function toIsoDateUtc(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDaysIso(isoDate: string, days: number): string {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) return isoDate;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return toIsoDateUtc(parsed);
}

function overlapVacationDaysForYear(
  startIso: string,
  endIso: string,
  year: number,
  fromIso?: string
): number {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  if (!start || !end) return 0;

  const yearStart = parseIsoDate(`${year}-01-01`);
  const yearEnd = parseIsoDate(`${year}-12-31`);
  if (!yearStart || !yearEnd) return 0;

  const fromDate = fromIso ? parseIsoDate(fromIso) : null;
  const effectiveStart = new Date(
    Math.max(start.getTime(), yearStart.getTime(), fromDate ? fromDate.getTime() : -Infinity)
  );
  const effectiveEnd = new Date(Math.min(end.getTime(), yearEnd.getTime()));
  if (effectiveEnd < effectiveStart) return 0;

  const dayMs = 24 * 60 * 60 * 1000;
  return Math.floor((effectiveEnd.getTime() - effectiveStart.getTime()) / dayMs) + 1;
}

async function computeBonusAvailable(
  employee: EmployeeAdminDetails,
  year: number,
  month: number,
  monthlyTarget: number,
  monthlyRevenue: number,
  scheme: BonusScheme,
  tiers: BonusTier[]
): Promise<{
  calculated: number;
  previousCarry: number;
  available: number;
}> {
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
  const previousEntry = await getPreviousEmployeeBonusEntry(employee.id, year, month);
  if (previousEntry) {
    previousCarry = previousEntry.carryOver;
  } else {
    const openingAnchorDate = getOpeningAnchorDate(employee);
    if (isYearMonthAfterDate(year, month, openingAnchorDate)) {
      previousCarry = Number(employee.opening_bonus_carry ?? employee.imported_bonus_earned ?? 0);
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
  const pauseSettings = {
    enabled: Boolean(employee.mandatoryPauseEnabled),
    minPauseUnder6Minutes: Number(employee.min_pause_under6_minutes ?? 0) || 0,
    mandatoryPauseMinWorkMinutes: Number(employee.mandatory_pause_min_work_minutes ?? 0) || 0,
  };

  const planSollMap = new Map<string, number>();
  for (const isoDate of enumerateIsoRange(startIso, endIso)) {
    const info = getPlanHoursForDayFromPlan(plan, isoDate) ?? await getPlanHoursForDay(employeeId, isoDate);
    const soll = info
      ? applyMandatoryPauseToPlanHours(info.rawHours, info.requiredPauseMinutes ?? 0, pauseSettings)
      : 0;
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
  const openingAnchorDate = getOpeningAnchorDate(employee);

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

  let monthlyOvertimePayoutRow = await getEmployeeOvertimePayout(employeeId, year, month);
  let monthlyOvertimePayout = roundTwo(monthlyOvertimePayoutRow?.payoutHours ?? 0);
  const recordedForcedOverflow = combinedRecords.reduce(
    (acc, row) => acc + Number(row.forced_overflow ?? 0),
    0
  );

  const openingBalance = Number(employee.opening_overtime_balance ?? 0);
  const manualCorrection = Number(employee.overtime_balance ?? 0);

  const overtimeUpToMonth = roundTwo(
    allRecords
      .map((record) => ({ record, date: parseIsoDate(record.day_date) }))
      .filter((entry): entry is { record: typeof allRecords[number]; date: Date } => !!entry.date)
      .filter(({ date }) => (openingAnchorDate ? date > openingAnchorDate : true))
      .filter(({ date }) => date <= monthEnd)
      .reduce((acc, entry) => acc + Number(entry.record.overtime_delta ?? 0), 0)
  );

  const totalOvertimePayouts = roundTwo(
    openingAnchorDate
      ? isYearMonthAfterDate(year, month, openingAnchorDate)
        ? (await sumEmployeeOvertimePayoutsUpTo(employeeId, year, month)) -
          (await sumEmployeeOvertimePayoutsUpTo(
            employeeId,
            openingAnchorDate.getUTCFullYear(),
            openingAnchorDate.getUTCMonth() + 1
          ))
        : 0
      : await sumEmployeeOvertimePayoutsUpTo(employeeId, year, month)
  );

  const baseBalance = roundTwo(openingBalance + overtimeUpToMonth - totalOvertimePayouts);
  const saldoBisMonatsEnde = roundTwo(baseBalance + manualCorrection);

  const maxMinus = Number(employee.max_minusstunden ?? 0) || 0;
  const maxOvertime = Number(employee.max_ueberstunden ?? 0) || 0;
  const currentBalance = clamp(saldoBisMonatsEnde, -maxMinus, maxOvertime);

  const exitDate = parseIsoDate(employee.exit_date ?? '');
  if (exitDate) {
    const exitYear = exitDate.getUTCFullYear();
    const exitMonth = exitDate.getUTCMonth() + 1;
    const settlementPeriod = nextYearMonth(exitYear, exitMonth);
    const isSettlementMonth = year === settlementPeriod.year && month === settlementPeriod.month;
    if (isSettlementMonth && !monthlyOvertimePayoutRow) {
      await upsertEmployeeOvertimePayout(employeeId, year, month, roundTwo(currentBalance));
      monthlyOvertimePayoutRow = await getEmployeeOvertimePayout(employeeId, year, month);
      monthlyOvertimePayout = roundTwo(monthlyOvertimePayoutRow?.payoutHours ?? 0);
    }
  }

  const adjustedTotalOvertimePayouts = roundTwo(
    openingAnchorDate
      ? isYearMonthAfterDate(year, month, openingAnchorDate)
        ? (await sumEmployeeOvertimePayoutsUpTo(employeeId, year, month)) -
          (await sumEmployeeOvertimePayoutsUpTo(
            employeeId,
            openingAnchorDate.getUTCFullYear(),
            openingAnchorDate.getUTCMonth() + 1
          ))
        : 0
      : await sumEmployeeOvertimePayoutsUpTo(employeeId, year, month)
  );
  const adjustedBaseBalance = roundTwo(openingBalance + overtimeUpToMonth - adjustedTotalOvertimePayouts);
  const adjustedSaldoBisMonatsEnde = roundTwo(adjustedBaseBalance + manualCorrection);
  const adjustedCurrentBalance = clamp(adjustedSaldoBisMonatsEnde, -maxMinus, maxOvertime);
  const minOvertimePayout = roundTwo(monthlyOvertimePayout + Math.min(adjustedCurrentBalance, 0));
  const maxOvertimePayout = roundTwo(monthlyOvertimePayout + Math.max(adjustedCurrentBalance, 0));
  const availableOvertime = maxOvertimePayout;
  const forcedOverflow = roundTwo(recordedForcedOverflow + monthlyOvertimePayout);

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

  const yearlyVacationDays = roundTwo(Number(employee.vacation_days_total ?? 0));
  const carryExpiryNotified =
    employee.vacation_carry_expiry_enabled && employee.vacation_carry_expiry_date
      ? await hasSuccessfulVacationCarryNotificationBefore({
          tenantId,
          employeeId,
          year,
          expiryValue: employee.vacation_carry_expiry_date,
        })
      : false;
  const openingAnchorDateForVacation = getOpeningAnchorDate(employee);
  const openingTakenDaysForYear =
    openingAnchorDateForVacation && openingAnchorDateForVacation.getUTCFullYear() === year
      ? roundTwo(Number(employee.opening_vacation_taken_ytd ?? 0))
      : 0;

  const vacationBalance = computeVacationBalance({
    annualDays: yearlyVacationDays,
    importedCarryDays: roundTwo(
      Number(employee.opening_vacation_carry_days ?? employee.vacation_days_last_year ?? 0)
    ),
    openingTakenDays: openingTakenDaysForYear,
    entryDate: employee.opening_effective_date ?? employee.entry_date ?? null,
    exitDate: employee.exit_date ?? null,
    asOfDate: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    carryExpiryEnabled: employee.vacation_carry_expiry_enabled,
    carryExpiryDate: employee.vacation_carry_expiry_date,
    carryExpiryNotified,
    year,
    records: allRecords,
  });

  const monthEndIso = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const approvedFromIso = addDaysIso(monthEndIso, 1);

  const leaveRequests = await listLeaveRequestsForEmployee(tenantId, employeeId, 500);
  const vacationRequests = leaveRequests.filter((row) => row.type === 'vacation');
  const overtimeRequests = leaveRequests.filter((row) => row.type === 'overtime');

  const requestedVacationDays = roundTwo(
    vacationRequests.reduce((acc, row) => {
      if (row.status !== 'pending') return acc;
      return acc + overlapVacationDaysForYear(row.start_date, row.end_date, year);
    }, 0)
  );

  const rejectedVacationDays = roundTwo(
    vacationRequests.reduce((acc, row) => {
      if (row.status !== 'rejected') return acc;
      return acc + overlapVacationDaysForYear(row.start_date, row.end_date, year);
    }, 0)
  );

  const approvedVacationDays = roundTwo(
    vacationRequests.reduce((acc, row) => {
      if (row.status !== 'approved') return acc;
      if (Number(row.cancellation_requested ?? 0) === 1) return acc;
      if (row.cancelled_at) return acc;
      return acc + overlapVacationDaysForYear(row.start_date, row.end_date, year, approvedFromIso);
    }, 0)
  );

  const takenVacationDays = roundTwo(vacationBalance.takenDays);
  const availableVacationDays = roundTwo(
    Math.max(
      vacationBalance.remainingDays - approvedVacationDays - requestedVacationDays,
      0
    )
  );

  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowIso = toLocalIsoDate(tomorrow);
  const approvedFutureOvertimeRequests = overtimeRequests.filter((row) => {
    if (row.status !== 'approved') return false;
    if (row.cancelled_at) return false;
    return row.end_date >= tomorrowIso;
  });
  const plannedRangeStartIso = approvedFutureOvertimeRequests
    .map((row) => row.start_date)
    .sort((a, b) => (a < b ? -1 : 1))[0] ?? tomorrowIso;
  const plannedRangeEndIso = approvedFutureOvertimeRequests
    .map((row) => row.end_date)
    .sort((a, b) => (a > b ? -1 : 1))[0] ?? tomorrowIso;
  const futureShiftPlan = approvedFutureOvertimeRequests.length
    ? await getShiftPlan(employeeId, { from: plannedRangeStartIso, to: plannedRangeEndIso })
    : null;
  let plannedOvertimeReduction = 0;
  for (const request of approvedFutureOvertimeRequests) {
    const explicitDurationHours = toDurationHours(request.start_time, request.end_time);
    if (explicitDurationHours > 0) {
      for (const isoDate of enumerateIsoRange(request.start_date, request.end_date)) {
        if (isoDate >= tomorrowIso) {
          plannedOvertimeReduction += explicitDurationHours;
        }
      }
      continue;
    }
    for (const isoDate of enumerateIsoRange(request.start_date, request.end_date)) {
      if (isoDate < tomorrowIso) continue;
      const planInfo = futureShiftPlan ? getPlanHoursForDayFromPlan(futureShiftPlan, isoDate, request.reason ?? '') : null;
      plannedOvertimeReduction += Number(planInfo?.sollHours ?? 0);
    }
  }
  plannedOvertimeReduction = roundTwo(plannedOvertimeReduction);
  const remainingAfterPlanned = roundTwo(adjustedCurrentBalance - plannedOvertimeReduction);

  if (employee.vacation_carry_expiry_enabled && employee.vacation_carry_expiry_date) {
    await sendVacationCarryExpiryNotification({
      tenantId,
      employeeId,
      year,
      carryDays: vacationBalance.carryStartDays,
      expiryDate: employee.vacation_carry_expiry_date,
    });
  }

  const { calculated, previousCarry, available } = await computeBonusAvailable(
    employee,
    year,
    month,
    monthlyTarget,
    monthlyRevenue,
    scheme,
    tiers
  );
  const currentEntry = await getEmployeeBonusEntry(employeeId, year, month);
  const bonusPaid = roundTwo(currentEntry?.payout ?? 0);
  const bonusCarry = roundTwo(currentEntry?.carryOver ?? clamp(available - bonusPaid, 0, available));

  const { year: nextYear, month: nextMonthValue } = nextMonth(year, month);
  const { year: prevYear, month: prevMonthValue } = previousMonth(year, month);

  const monthLabel = `${monthName(month)} ${year}`;
  const prevMonthLabel = `${monthName(prevMonthValue)} ${prevYear}`;
  const nextMonthLabel = `${monthName(nextMonthValue)} ${nextYear}`;
  const carryExpiryLabel =
    employee.vacation_carry_expiry_enabled && employee.vacation_carry_expiry_date
      ? formatDateLabel(employee.vacation_carry_expiry_date, year)
      : null;

  const preferences = ensurePreferences(await getFooterPreferences(employeeId));

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
        {
          id: 'planned-overtime',
          label: 'Geplante Überstunden (inkl. Rest)',
          value: `${formatHours(plannedOvertimeReduction)} (Rest: ${formatHours(remainingAfterPlanned)})`,
          rawValue: plannedOvertimeReduction,
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
          label: 'Urlaubstage pro Jahr',
          value: `${hoursFormatter.format(yearlyVacationDays)} Tage`,
          rawValue: yearlyVacationDays,
        },
        {
          id: 'vacation-carry-over',
          label: carryExpiryLabel
            ? `Resturlaub aus Vorjahr bis ${carryExpiryLabel}`
            : 'Resturlaub aus Vorjahr',
          value: `${hoursFormatter.format(vacationBalance.carryRemainingDays)} Tage`,
          rawValue: vacationBalance.carryRemainingDays,
        },
        {
          id: 'vacation-taken',
          label: `Bereits genommene Urlaubstage (${year})`,
          value: `${hoursFormatter.format(takenVacationDays)} Tage`,
          rawValue: takenVacationDays,
        },
        {
          id: 'vacation-approved',
          label: `Bereits genehmigte Urlaubstage (${year})`,
          value: `${hoursFormatter.format(approvedVacationDays)} Tage`,
          rawValue: approvedVacationDays,
        },
        {
          id: 'vacation-requested',
          label: `Beantragte Urlaubstage (${year})`,
          value: `${hoursFormatter.format(requestedVacationDays)} Tage`,
          rawValue: requestedVacationDays,
        },
        {
          id: 'vacation-rejected',
          label: `Abgelehnte Urlaubstage (${year})`,
          value: `${hoursFormatter.format(rejectedVacationDays)} Tage`,
          rawValue: rejectedVacationDays,
        },
        {
          id: 'vacation-available',
          label: 'Zur Verfügung stehende Urlaubstage',
          value: `${hoursFormatter.format(availableVacationDays)} Tage`,
          rawValue: availableVacationDays,
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

  const adjustments = await listEmployeeOvertimeAdjustments(tenantId, employeeId, { limit: 20 });

  const overtimeSummary: OvertimeSummary = {
    available: availableOvertime,
    paid: monthlyOvertimePayout,
    remaining: roundTwo(Math.max(adjustedCurrentBalance, 0)),
    minPayout: minOvertimePayout,
    maxPayout: maxOvertimePayout,
    currentBalance: adjustedCurrentBalance,
    baseBalance: adjustedBaseBalance,
    manualCorrection: roundTwo(manualCorrection),
    plannedReduction: plannedOvertimeReduction,
    remainingAfterPlanned,
    currentMonthLabel: monthLabel,
    adjustments: adjustments.map((entry) => ({
      id: entry.id,
      year: entry.year,
      month: entry.month,
      deltaHours: entry.deltaHours,
      balanceBefore: entry.balanceBefore,
      balanceAfter: entry.balanceAfter,
      correctionBefore: entry.correctionBefore,
      correctionAfter: entry.correctionAfter,
      createdByAdminName: entry.createdByAdminName,
      createdAt: entry.createdAt,
    })),
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

export async function getAdminEmployeeSummaryReadBlock(
  tenantId: string,
  employeeId: number,
): Promise<AdminEmployeeSummaryReadBlock> {
  const closings = await listMonthlyClosings(employeeId, 24);
  const closedMonths = Array.from(
    new Set(
      closings
        .filter((item) => item.status === 'closed')
        .map((item) => `${item.year}-${String(item.month).padStart(2, '0')}`)
    )
  );
  const vacationCarryNotifications = await listVacationCarryNotificationsForEmployee(
    tenantId,
    employeeId,
    20,
  );

  return {
    closedMonths,
    vacationCarryNotifications,
  };
}

export async function saveAdminSummaryPreferences(
  employeeId: number,
  preferences: FooterPreferences,
): Promise<void> {
  await saveFooterPreferences(employeeId, preferences);
}

export async function saveAdminBonusPayout(
  tenantId: string,
  employeeId: number,
  year: number,
  month: number,
  payout: number,
): Promise<void> {
  const summary = await getMonthlyAdminSummary(tenantId, employeeId, year, month);
  const available = summary.bonus.available;
  const sanitizedPayout = Math.min(Math.max(payout, 0), available);
  const carryOver = roundTwo(Math.max(available - sanitizedPayout, 0));

  await upsertEmployeeBonusEntry(employeeId, year, month, roundTwo(sanitizedPayout), carryOver);
}

export async function saveAdminOvertimePayout(
  tenantId: string,
  employeeId: number,
  year: number,
  month: number,
  payoutHours: number,
): Promise<{ remainingBalance: number }> {
  const summary = await getMonthlyAdminSummary(tenantId, employeeId, year, month);
  const minPayout = Number.isFinite(summary.overtime.minPayout) ? summary.overtime.minPayout : 0;
  const maxPayout = Number.isFinite(summary.overtime.maxPayout) ? summary.overtime.maxPayout : 0;
  const lowerBound = Math.min(minPayout, maxPayout);
  const upperBound = Math.max(minPayout, maxPayout);
  const sanitizedPayout = roundTwo(Math.min(Math.max(payoutHours, lowerBound), upperBound));
  const delta = roundTwo(sanitizedPayout - summary.overtime.paid);
  const remainingBalance = roundTwo(summary.overtime.currentBalance - delta);

  await upsertEmployeeOvertimePayout(employeeId, year, month, sanitizedPayout);

  return { remainingBalance };
}

export async function saveAdminOvertimeBalanceAdjustment(
  tenantId: string,
  employeeId: number,
  year: number,
  month: number,
  adjustmentDelta: number,
  adminId: number | null,
  adminName: string | null,
): Promise<{ newCurrentBalance: number }> {
  const normalizedDelta = roundTwo(adjustmentDelta);
  const summary = await getMonthlyAdminSummary(tenantId, employeeId, year, month);
  const previousManualCorrection = roundTwo(summary.overtime.manualCorrection);
  const newManualCorrection = roundTwo(previousManualCorrection + normalizedDelta);
  const newCurrentBalance = roundTwo(summary.overtime.currentBalance + normalizedDelta);

  try {
    await saveEmployeeOvertimeBalance(tenantId, employeeId, newManualCorrection);
    await createEmployeeOvertimeAdjustment({
      tenantId,
      employeeId,
      year,
      month,
      deltaHours: normalizedDelta,
      balanceBefore: summary.overtime.currentBalance,
      balanceAfter: newCurrentBalance,
      correctionBefore: previousManualCorrection,
      correctionAfter: newManualCorrection,
      createdByAdminId: adminId,
      createdByAdminName: adminName,
      reason: 'manual-delta-adjustment',
    });
  } catch (error) {
    await saveEmployeeOvertimeBalance(tenantId, employeeId, previousManualCorrection).catch(() => undefined);
    throw error;
  }

  return { newCurrentBalance };
}
