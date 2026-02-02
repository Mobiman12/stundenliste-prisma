import {
  deleteEmployeeById,
  employeeExists,
  getBonusScheme,
  getEmployeeAdminDetails,
  listBonusTiers,
  listEmployees,
  replaceBonusTiers,
  saveBonusScheme,
  updateEmployeeAdminDetails,
  updateEmployeeOvertimeBalance,
  updateEmployeeSettings,
  updateEmployeeTillhubUserId,
  createEmployee,
  setEmployeeActiveStatus,
  type BonusScheme,
  type BonusTier,
  type EmployeeAdminDetails,
  type EmployeeListItem,
  type EmployeeSettingsInput,
  type UpdateEmployeeAdminInput,
  type CreateEmployeeInput,
} from '@/lib/data/employees';
import { listEmployeeWeekdayPauses, replaceEmployeeWeekdayPauses } from '@/lib/data/employee-weekday-pauses';
import { listDailyDayRecords, type DailyDayRecord } from '@/lib/data/daily-days';
import { listMonthlyClosings } from '@/lib/data/monthly-closings';
import { getShiftPlanRow, SHIFT_PLAN_DAY_KEYS } from '@/lib/data/shift-plans';
import { calculateIstHours } from '@/lib/services/time-calculations';
import { deriveCodeFromPlanLabel, getShiftPlan } from '@/lib/services/shift-plan';

const NON_AVAILABILITY_KEYWORDS = [
  'nicht verfügbar',
  'nicht verfuegbar',
  'urlaub',
  'krank',
  'krankheit',
  'überstunden',
  'ueberstunden',
  'kurzarbeit',
  'abbau',
  'feiertag',
];


const MIN_EFFECTIVE_HOURS = 0.005;

const sanitizeTimeValue = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    return trimmed.padStart(5, '0');
  }
  return trimmed;
};

function resolveFallbackShiftPlanDay(
  row: ReturnType<typeof getShiftPlanRow> | null,
  isoDate: string,
  label: string | null
): { start: string | null; end: string | null; requiredPauseMinutes: number } | null {
  if (!row) return null;
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const weekDayIndex = (date.getDay() + 6) % 7; // Monday = 0
  const dayKey = SHIFT_PLAN_DAY_KEYS[weekDayIndex];

  const buildEntry = (prefix: 'w1' | 'w2') => {
    const startKey = `${prefix}_${dayKey}_start` as keyof typeof row;
    const endKey = `${prefix}_${dayKey}_end` as keyof typeof row;
    const pauseKey = `${prefix}_${dayKey}_req_pause_min` as keyof typeof row;
    return {
      start: sanitizeTimeValue(row?.[startKey] as string | null | undefined),
      end: sanitizeTimeValue(row?.[endKey] as string | null | undefined),
      requiredPauseMinutes: Number(row?.[pauseKey] ?? 0) || 0,
    };
  };

  const twoWeek = (row?.two_week_cycle ?? '').toLowerCase() === 'yes';
  if (!twoWeek) {
    return buildEntry('w1');
  }
  const normalizedLabel = (label ?? '').trim().toLowerCase();
  return normalizedLabel.includes('spät') ? buildEntry('w2') : buildEntry('w1');
}

const formatPauseString = (minutes: number): string => (minutes > 0 ? `${minutes}min.` : 'Keine');

const computeNetHours = (start: string | null | undefined, end: string | null | undefined, pauseMinutes: number): number => {
  const result = calculateIstHours(start ?? '', end ?? '', null, null, formatPauseString(pauseMinutes));
  return result.netHours;
};

const deriveSyntheticCode = (normalizedLabel: string): string => deriveCodeFromPlanLabel(normalizedLabel) ?? 'PLAN';

async function ensureEmployeeInTenant(tenantId: string, employeeId: number): Promise<void> {
  const exists = await employeeExists(tenantId, employeeId);
  if (!exists) {
    throw new Error('Mitarbeiter wurde nicht gefunden.');
  }
}

export interface DailyOverviewEntry {
  isoDate: string;
  displayDate: string;
  brutto: number;
  bruttoFormatted: string;
  kommt1: string | null;
  geht1: string | null;
  kommt2: string | null;
  geht2: string | null;
  pause: string | null;
  mittag: string | null;
  planStatus: string | null;
  istHours: number;
  sollHours: number;
  overtimeDelta: number;
  code: string;
  codeDisplay: string;
  remark: string | null;
}

export interface DailyOverviewTotals {
  istHours: number;
  sollHours: number;
  overtimeDelta: number;
  daysCount: number;
}

export interface DailyOverviewResult {
  years: number[];
  months: number[];
  selectedYear: number;
  selectedMonth: number;
  entries: DailyOverviewEntry[];
  totals: DailyOverviewTotals;
}

export interface EmployeeWeekdayPause {
  weekday: number;
  minutes: number;
}

function formatCodeDisplay(row: DailyDayRecord): string {
  const overtime = Number(row.overtime_delta ?? 0);
  if (Math.abs(overtime) >= 0.005) {
    const prefix = overtime >= 0 ? '+Ü=' : '-Ü=';
    return `${prefix}${Math.abs(overtime).toFixed(2)}h`.replace('.', ',');
  }
  return (row.code ?? '').trim();
}

function toDailyOverviewEntry(row: DailyDayRecord): DailyOverviewEntry {
  const istResult = calculateIstHours(row.kommt1, row.geht1, row.kommt2, row.geht2, row.pause ?? 'Keine');
  const sollHours = Number(row.plan_hours ?? 0);

  return {
    isoDate: row.day_date,
    displayDate: new Date(`${row.day_date}T00:00:00`).toLocaleDateString('de-DE'),
    brutto: Number(row.brutto ?? 0),
    bruttoFormatted: `${Number(row.brutto ?? 0).toFixed(2)} €`.replace('.', ','),
    kommt1: row.kommt1,
    geht1: row.geht1,
    kommt2: row.kommt2,
    geht2: row.geht2,
    pause: row.pause ?? 'Keine',
    mittag: row.mittag ?? null,
    planStatus: (row.schicht ?? '').trim() || null,
    istHours: istResult.netHours,
    sollHours,
    overtimeDelta: Number(row.overtime_delta ?? 0),
    code: row.code ?? '',
    codeDisplay: formatCodeDisplay(row),
    remark: row.bemerkungen ?? null,
  };
}

function sortEntries(entries: DailyOverviewEntry[]): DailyOverviewEntry[] {
  return [...entries].sort((a, b) => (a.isoDate < b.isoDate ? -1 : 1));
}

export async function getDailyOverview(
  tenantId: string,
  employeeId: number,
  preferredYear?: number,
  preferredMonth?: number
): Promise<DailyOverviewResult> {
  await ensureEmployeeInTenant(tenantId, employeeId);
  const records = await listDailyDayRecords(employeeId);
  const fullPlan = await getShiftPlan(employeeId);
  const planIsoDates = Object.entries(fullPlan.days)
    .filter(([, day]) => {
      const hasLabel = Boolean(day.label?.trim());
      const hasTime = Boolean(day.start || day.end);
      return hasLabel || hasTime;
    })
    .map(([isoDate]) => isoDate);

  const isoDateSet = new Set<string>();
  for (const record of records) {
    isoDateSet.add(record.day_date);
  }
  for (const iso of planIsoDates) {
    isoDateSet.add(iso);
  }

  if (!isoDateSet.size) {
    const current = new Date();
    return {
      years: [],
      months: [],
      selectedYear: current.getFullYear(),
      selectedMonth: current.getMonth() + 1,
      entries: [],
      totals: { istHours: 0, sollHours: 0, overtimeDelta: 0, daysCount: 0 },
    };
  }

  const allDates = Array.from(isoDateSet)
    .map((iso) => new Date(`${iso}T00:00:00`))
    .filter((date) => !Number.isNaN(date.getTime()));

  if (!allDates.length) {
    const current = new Date();
    return {
      years: [],
      months: [],
      selectedYear: current.getFullYear(),
      selectedMonth: current.getMonth() + 1,
      entries: [],
      totals: { istHours: 0, sollHours: 0, overtimeDelta: 0, daysCount: 0 },
    };
  }
  const periodSet = new Set(
    allDates.map((date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`)
  );

  const periods = Array.from(periodSet)
    .map((key) => {
      const [yearStr, monthStr] = key.split('-');
      return {
        year: Number.parseInt(yearStr, 10),
        month: Number.parseInt(monthStr, 10),
        key,
      };
    })
    .filter((item) => Number.isFinite(item.year) && Number.isFinite(item.month))
    .sort((a, b) => a.year - b.year || a.month - b.month);

  const monthsByYear = new Map<number, number[]>();
  for (const period of periods) {
    const existingMonths = monthsByYear.get(period.year) ?? [];
    existingMonths.push(period.month);
    monthsByYear.set(period.year, existingMonths);
  }
  for (const monthList of monthsByYear.values()) {
    monthList.sort((a, b) => a - b);
  }

  const years = Array.from(monthsByYear.keys()).sort((a, b) => a - b);

  const closings = listMonthlyClosings(employeeId, 240);
  const closingStatusMap = new Map(
    closings.map((closing) => [
      `${closing.year}-${String(closing.month).padStart(2, '0')}`,
      closing.status,
    ])
  );

  const isClosed = (year: number, month: number) =>
    closingStatusMap.get(`${year}-${String(month).padStart(2, '0')}`) === 'closed';
  const periodExists = (year: number, month: number) =>
    periodSet.has(`${year}-${String(month).padStart(2, '0')}`);

  const findNextOpenPeriod = (minYear: number, minMonth: number) =>
    periods.find(
      (period) =>
        (period.year > minYear || (period.year === minYear && period.month >= minMonth)) &&
        !isClosed(period.year, period.month)
    );

  const findLastOpenPeriod = () =>
    [...periods].reverse().find((period) => !isClosed(period.year, period.month));

  let targetYear = preferredYear ?? 0;
  let targetMonth = preferredMonth ?? 0;

  if (!(preferredYear && preferredMonth && periodExists(preferredYear, preferredMonth))) {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;

    targetYear = 0;
    targetMonth = 0;

    if (periodExists(currentYear, currentMonth) && !isClosed(currentYear, currentMonth)) {
      targetYear = currentYear;
      targetMonth = currentMonth;
    } else {
      const nextOpen = findNextOpenPeriod(currentYear, currentMonth);
      if (nextOpen) {
        targetYear = nextOpen.year;
        targetMonth = nextOpen.month;
      } else {
        const lastOpen = findLastOpenPeriod();
        if (lastOpen) {
          targetYear = lastOpen.year;
          targetMonth = lastOpen.month;
        }
      }
    }

    if (!targetYear || !targetMonth) {
      const fallback = periods[periods.length - 1];
      targetYear = fallback?.year ?? currentYear;
      targetMonth = fallback?.month ?? currentMonth;
    }
  }

  if (!years.includes(targetYear)) {
    years.push(targetYear);
    years.sort((a, b) => a - b);
  }

  const monthsForYear = monthsByYear.get(targetYear) ?? [];
  if (!monthsForYear.includes(targetMonth)) {
    monthsForYear.push(targetMonth);
    monthsForYear.sort((a, b) => a - b);
    monthsByYear.set(targetYear, monthsForYear);
  }

  const monthlyEntries = records.filter((row) => {
    const date = new Date(`${row.day_date}T00:00:00`);
    return date.getFullYear() === targetYear && date.getMonth() + 1 === targetMonth;
  });

  const baseEntries = monthlyEntries.map(toDailyOverviewEntry);
  const entryByDate = new Map(baseEntries.map((entry) => [entry.isoDate, entry]));

  const paddedMonth = String(targetMonth).padStart(2, '0');
  const monthStartIso = `${targetYear}-${paddedMonth}-01`;
  const lastDayOfMonth = new Date(targetYear, targetMonth, 0).getDate();
  const monthEndIso = `${targetYear}-${paddedMonth}-${String(lastDayOfMonth).padStart(2, '0')}`;

  const fallbackRow = getShiftPlanRow(employeeId);
  const syntheticEntries: DailyOverviewEntry[] = [];
  for (const [isoDate, planDay] of Object.entries(fullPlan.days)) {
    if (isoDate < monthStartIso || isoDate > monthEndIso) {
      continue;
    }
    const planLabel = planDay.label?.trim();
    if (!planLabel) {
      continue;
    }
    const normalizedPlanLabel = planLabel.toLowerCase();
    const isRelevantLabel = NON_AVAILABILITY_KEYWORDS.some((keyword) => normalizedPlanLabel.includes(keyword));
    if (!isRelevantLabel) {
      continue;
    }
    const existing = entryByDate.get(isoDate);
    if (existing) {
      if (!existing.planStatus) {
        existing.planStatus = planLabel;
      }
      continue;
    }

    const hasShiftTimes = Boolean(planDay.start || planDay.end);
    if (hasShiftTimes && !isRelevantLabel) {
      continue;
    }

    let sollHours = computeNetHours(planDay.start, planDay.end, planDay.requiredPauseMinutes ?? 0);
    if (sollHours <= MIN_EFFECTIVE_HOURS) {
      const fallbackDay = resolveFallbackShiftPlanDay(fallbackRow, isoDate, planLabel);
      if (fallbackDay) {
        sollHours = computeNetHours(fallbackDay.start, fallbackDay.end, fallbackDay.requiredPauseMinutes);
      }
    }
    const roundedSollHours = Number(sollHours.toFixed(2));
    const syntheticCode = deriveSyntheticCode(normalizedPlanLabel);

    const displayDate = new Date(`${isoDate}T00:00:00`).toLocaleDateString('de-DE');
    const synthetic: DailyOverviewEntry = {
      isoDate,
      displayDate,
      brutto: 0,
      bruttoFormatted: '0,00 €',
      kommt1: planDay.start ?? null,
      geht1: planDay.end ?? null,
      kommt2: null,
      geht2: null,
      pause: 'Keine',
      mittag: 'Nein',
      planStatus: planLabel,
      istHours: 0,
      sollHours: roundedSollHours,
      overtimeDelta: 0,
      code: syntheticCode,
      codeDisplay: planLabel,
      remark: null,
    };
    syntheticEntries.push(synthetic);
  }

  const combinedEntries = sortEntries([...baseEntries, ...syntheticEntries]);

  const totals = combinedEntries.reduce((acc, entry) => {
    acc.istHours += entry.istHours;
    acc.sollHours += entry.sollHours;
    acc.overtimeDelta += entry.overtimeDelta;
    acc.daysCount += 1;
    return acc;
  }, { istHours: 0, sollHours: 0, overtimeDelta: 0, daysCount: 0 });

  const entries = combinedEntries;

  return {
    years,
    months: monthsForYear,
    selectedYear: targetYear,
    selectedMonth: targetMonth,
    entries,
    totals,
  };
}

export async function getAdminEmployeeList(tenantId: string): Promise<EmployeeListItem[]> {
  return listEmployees(tenantId, { includeInactive: true });
}

export async function getAdminEmployeeDetails(
  tenantId: string,
  employeeId: number
): Promise<EmployeeAdminDetails | null> {
  return getEmployeeAdminDetails(tenantId, employeeId);
}

export async function saveAdminEmployeeDetails(
  tenantId: string,
  input: UpdateEmployeeAdminInput
): Promise<void> {
  await updateEmployeeAdminDetails(tenantId, input);
}

export async function createAdminEmployee(
  tenantId: string,
  input: CreateEmployeeInput
): Promise<number> {
  return createEmployee(tenantId, input);
}

export async function setEmployeeActive(
  tenantId: string,
  employeeId: number,
  isActive: boolean
): Promise<void> {
  await setEmployeeActiveStatus(tenantId, employeeId, isActive);
}

export async function removeEmployee(tenantId: string, employeeId: number): Promise<void> {
  await deleteEmployeeById(tenantId, employeeId);
}

export async function adminEmployeeExists(tenantId: string, employeeId: number): Promise<boolean> {
  return employeeExists(tenantId, employeeId);
}

export async function saveEmployeeSettings(
  tenantId: string,
  input: EmployeeSettingsInput
): Promise<void> {
  await updateEmployeeSettings(tenantId, input);
}

export async function getEmployeeWeekdayPauses(
  tenantId: string,
  employeeId: number
): Promise<EmployeeWeekdayPause[]> {
  await ensureEmployeeInTenant(tenantId, employeeId);
  const records = await listEmployeeWeekdayPauses(employeeId);
  const map = new Map<number, number>();
  for (const record of records) {
    const weekday = Number(record.weekday);
    if (Number.isInteger(weekday) && weekday >= 0 && weekday <= 6) {
      map.set(weekday, Number(record.minutes ?? 0));
    }
  }

  const result: EmployeeWeekdayPause[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    result.push({ weekday, minutes: map.get(weekday) ?? 0 });
  }
  return result;
}

export async function saveEmployeeWeekdayPauses(
  tenantId: string,
  employeeId: number,
  entries: EmployeeWeekdayPause[]
): Promise<void> {
  await ensureEmployeeInTenant(tenantId, employeeId);
  const sanitized: { weekday: number; minutes: number }[] = entries
    .filter((entry) => Number.isInteger(entry.weekday) && entry.weekday >= 0 && entry.weekday <= 6)
    .map((entry) => ({ weekday: entry.weekday, minutes: Math.max(0, Math.round(entry.minutes)) }));

  await replaceEmployeeWeekdayPauses(employeeId, sanitized);
}

export async function saveEmployeeOvertimeBalance(
  tenantId: string,
  employeeId: number,
  balance: number
): Promise<void> {
  await updateEmployeeOvertimeBalance(tenantId, employeeId, balance);
}

export async function saveEmployeeTillhubUser(
  tenantId: string,
  employeeId: number,
  tillhubUserId: string | null
): Promise<void> {
  await updateEmployeeTillhubUserId(tenantId, employeeId, tillhubUserId);
}

export async function getEmployeeBonusConfiguration(
  tenantId: string,
  employeeId: number
): Promise<{
  scheme: BonusScheme;
  tiers: BonusTier[];
}> {
  await ensureEmployeeInTenant(tenantId, employeeId);
  return {
    scheme: await getBonusScheme(tenantId, employeeId),
    tiers: await listBonusTiers(tenantId, employeeId),
  };
}

export async function saveEmployeeBonusConfiguration(
  tenantId: string,
  employeeId: number,
  scheme: BonusScheme,
  tiers: BonusTier[]
): Promise<void> {
  await ensureEmployeeInTenant(tenantId, employeeId);
  await saveBonusScheme(tenantId, employeeId, scheme);
  const normalizedTiers = tiers
    .filter((tier) => Number.isFinite(tier.threshold) && Number.isFinite(tier.percent))
    .map((tier) => ({ threshold: Number(tier.threshold), percent: Number(tier.percent) }))
    .sort((a, b) => a.threshold - b.threshold);
  await replaceBonusTiers(tenantId, employeeId, normalizedTiers);
}
