import {
  deleteEmployeeById,
  employeeExists,
  getBonusScheme,
  getEmployeeAdminDetails,
  getEmployeeValidationInfo,
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
  updateEmployeeControlPlaneStaffId,
  setEmployeeOnboardingStatus,
  type BonusScheme,
  type BonusTier,
  type EmployeeAdminDetails,
  type EmployeeListItem,
  type EmployeeSettingsInput,
  type EmployeeValidationInfo,
  type UpdateEmployeeAdminInput,
  type CreateEmployeeInput,
} from '@/lib/data/employees';

export type {
  BonusScheme,
  BonusTier,
  EmployeeAdminDetails,
  EmployeeListItem,
  EmployeeSettingsInput,
  EmployeeValidationInfo,
  UpdateEmployeeAdminInput,
  CreateEmployeeInput,
};
import { replaceEmployeeBranches } from '@/lib/data/branches';
import { listEmployeeWeekdayPauses, replaceEmployeeWeekdayPauses } from '@/lib/data/employee-weekday-pauses';
import { listDailyDayRecords, type DailyDayRecord } from '@/lib/data/daily-days';
import { listMonthlyClosings } from '@/lib/data/monthly-closings';
import { getShiftPlanRowPg, SHIFT_PLAN_DAY_KEYS, type ShiftPlanRow } from '@/lib/data/shift-plans';
import { toLocalIsoDate } from '@/lib/date/local-iso';
import {
  pushStaffLifecycleUpdateToControlPlane,
  sendStaffPasswordActivationLinkToControlPlane,
  upsertStaffInControlPlane,
} from '@/lib/control-plane';
import {
  getEmployeeOnboardingSubmissionSnapshot,
  type EmployeeOnboardingSubmissionSnapshot,
} from '@/lib/services/employee-onboarding';
import { calculateIstHours, calculateLegalPauseHours } from '@/lib/services/time-calculations';
import {
  deleteShiftPlanDaysAfter,
  deriveCodeFromPlanLabel,
  getPlanHoursForDayFromPlan,
  getShiftPlan,
} from '@/lib/services/shift-plan';

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


function parseCarryExpiryMonthDay(
  monthValue: string | null,
  dayValue: string | null
): { value: string | null; error?: string } {
  const month = Number.parseInt(String(monthValue ?? ''), 10);
  const day = Number.parseInt(String(dayValue ?? ''), 10);
  if (!Number.isFinite(month) || !Number.isFinite(day)) {
    return { value: null, error: 'Bitte Monat und Tag für den Resturlaub-Verfall auswählen.' };
  }
  if (month < 1 || month > 12) {
    return { value: null, error: 'Ungültiger Monat für den Resturlaub-Verfall.' };
  }
  const daysInMonth = new Date(Date.UTC(2024, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) {
    return { value: null, error: 'Ungültiger Tag für den ausgewählten Monat.' };
  }
  if (month < 3 || (month === 3 && day < 31)) {
    return { value: null, error: 'Der Resturlaub-Verfall darf nicht vor dem 31.03. liegen.' };
  }
  return {
    value: `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function resolveHourlyWageFromCompensation(
  compensationType: 'hourly' | 'fixed',
  weeklyHours: number | null,
  hourlyWageInput: number | null,
  monthlySalaryGrossInput: number | null
): { hourlyWage: number | null; monthlySalaryGross: number | null; error?: string } {
  if (compensationType === 'fixed') {
    if (monthlySalaryGrossInput === null || !Number.isFinite(monthlySalaryGrossInput) || monthlySalaryGrossInput < 0) {
      return {
        hourlyWage: null,
        monthlySalaryGross: null,
        error: 'Bitte ein gültiges monatliches Festgehalt (brutto) eingeben.',
      };
    }
    if (weeklyHours === null || !Number.isFinite(weeklyHours) || weeklyHours <= 0) {
      return {
        hourlyWage: null,
        monthlySalaryGross: null,
        error: 'Für Festgehalt sind Wochenstunden > 0 erforderlich, damit der Stundenlohn berechnet werden kann.',
      };
    }
    const averageMonthlyHours = (weeklyHours * 13) / 3;
    if (!Number.isFinite(averageMonthlyHours) || averageMonthlyHours <= 0) {
      return {
        hourlyWage: null,
        monthlySalaryGross: null,
        error: 'Stundenlohn konnte aus Festgehalt und Wochenstunden nicht berechnet werden.',
      };
    }
    const derivedHourlyWage = roundToTwo(monthlySalaryGrossInput / averageMonthlyHours);
    return {
      hourlyWage: derivedHourlyWage,
      monthlySalaryGross: roundToTwo(monthlySalaryGrossInput),
    };
  }

  if (hourlyWageInput !== null && (!Number.isFinite(hourlyWageInput) || hourlyWageInput < 0)) {
    return { hourlyWage: null, monthlySalaryGross: null, error: 'Bitte einen gültigen Stundenlohn eingeben.' };
  }

  return {
    hourlyWage: hourlyWageInput === null ? null : roundToTwo(hourlyWageInput),
    monthlySalaryGross: null,
  };
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

function resolveFallbackShiftPlanDay(
  row: ShiftPlanRow | null,
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

const deriveSyntheticCode = (normalizedLabel: string): string => deriveCodeFromPlanLabel(normalizedLabel) ?? 'PLAN';

async function ensureEmployeeInTenant(tenantId: string, employeeId: number): Promise<void> {
  const exists = await employeeExists(tenantId, employeeId);
  if (!exists) {
    throw new Error('Mitarbeiter wurde nicht gefunden.');
  }
}

async function ensureEmployeeControlPlaneLink(
  tenantId: string,
  employeeId: number
): Promise<string> {
  const employee = await getEmployeeAdminDetails(tenantId, employeeId);
  if (!employee) {
    throw new Error('Mitarbeiter wurde nicht gefunden.');
  }

  const existingStaffId = employee.control_plane_staff_id?.trim();
  if (existingStaffId) {
    return existingStaffId;
  }

  const displayName =
    [employee.first_name?.trim(), employee.last_name?.trim()].filter(Boolean).join(' ').trim() ||
    employee.username?.trim() ||
    `Mitarbeiter ${employee.id}`;

  const upsert = await upsertStaffInControlPlane({
    tenantId,
    displayName,
    firstName: employee.first_name,
    lastName: employee.last_name,
    email: employee.email,
    phone: employee.phone,
    role: String(employee.role_id),
    bookingPin: employee.booking_pin,
    passwordHash: employee.password,
    showInCalendar: employee.show_in_calendar,
    apps: { timeshift: true },
  });

  const resolvedStaffId = upsert?.staffId?.trim();
  if (!resolvedStaffId) {
    throw new Error('Control-Plane-Verknüpfung konnte nicht erstellt werden.');
  }

  await updateEmployeeControlPlaneStaffId(tenantId, employeeId, resolvedStaffId);
  return resolvedStaffId;
}

function isOnboardingSubmissionComplete(snapshot: EmployeeOnboardingSubmissionSnapshot | null): boolean {
  if (!snapshot) return false;
  const submission = snapshot.submission ?? {};
  const requiredKeys = [
    'firstName',
    'lastName',
    'email',
    'phone',
    'street',
    'houseNumber',
    'country',
    'zipCode',
    'city',
    'federalState',
    'birthDate',
    'taxClass',
    'steuerId',
    'socialSecurityNumber',
    'healthInsurance',
    'healthInsuranceNumber',
    'iban',
    'bic',
    'entryDate',
    'tarifGroup',
    'employmentType',
    'workTimeModel',
    'weeklyHours',
    'probationMonths',
    'compensationType',
    'vacationDaysTotal',
  ];

  return requiredKeys.every((key) => {
    const value = submission[key];
    if (value !== undefined && value !== null) {
      return String(value).trim().length > 0;
    }
    const preset = snapshot.adminPreset;
    if (!preset) return false;
    switch (key) {
      case 'entryDate':
        return Boolean(preset.entryDate);
      case 'tarifGroup':
        return Boolean(preset.tarifGroup);
      case 'employmentType':
        return Boolean(preset.employmentType);
      case 'workTimeModel':
        return Boolean(preset.workTimeModel);
      case 'weeklyHours':
        return Number.isFinite(preset.weeklyHours) && preset.weeklyHours > 0;
      case 'probationMonths':
        return Number.isFinite(preset.probationMonths) && preset.probationMonths >= 0;
      case 'compensationType':
        return preset.compensationType === 'hourly' || preset.compensationType === 'fixed';
      case 'vacationDaysTotal':
        return Number.isFinite(preset.vacationDaysTotal) && preset.vacationDaysTotal > 0;
      default:
        return false;
    }
  });
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
  const employee = await getEmployeeAdminDetails(tenantId, employeeId);
  const pauseSettings = {
    enabled: Boolean(employee?.mandatoryPauseEnabled),
    minPauseUnder6Minutes: Number(employee?.min_pause_under6_minutes ?? 0) || 0,
    mandatoryPauseMinWorkMinutes: Number(employee?.mandatory_pause_min_work_minutes ?? 0) || 0,
  };
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

  const closings = await listMonthlyClosings(employeeId, 240);
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

  const baseEntries = monthlyEntries.map((row) => {
    const entry = toDailyOverviewEntry(row);
    const code = (row.code ?? '').trim().toUpperCase();
    if (code === 'KU' || code === 'UBF') {
      entry.sollHours = 0;
      return entry;
    }

    const storedPlanHours = Number(row.plan_hours ?? 0);
    // Keep persisted plan_hours as source of truth for existing entries.
    // Only fallback to shift-plan derived SOLL if no plan_hours was stored.
    const needsPlanFallback = !Number.isFinite(storedPlanHours) || Math.abs(storedPlanHours) < 0.005;
    const planInfo = needsPlanFallback
      ? getPlanHoursForDayFromPlan(fullPlan, row.day_date, row.schicht ?? '')
      : null;
    if (planInfo && planInfo.rawHours > 0) {
      entry.sollHours = applyMandatoryPauseToPlanHours(
        planInfo.rawHours,
        planInfo.requiredPauseMinutes ?? 0,
        pauseSettings
      );
    }
    return entry;
  });
  const entryByDate = new Map(baseEntries.map((entry) => [entry.isoDate, entry]));

  const paddedMonth = String(targetMonth).padStart(2, '0');
  const monthStartIso = `${targetYear}-${paddedMonth}-01`;
  const lastDayOfMonth = new Date(targetYear, targetMonth, 0).getDate();
  const monthEndIso = `${targetYear}-${paddedMonth}-${String(lastDayOfMonth).padStart(2, '0')}`;

  const fallbackRow = await getShiftPlanRowPg(employeeId);
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

export async function getAdminEmployeeValidationInfo(
  tenantId: string,
  employeeId: number
): Promise<EmployeeValidationInfo | null> {
  return getEmployeeValidationInfo(tenantId, employeeId);
}

export async function saveAdminEmployeeDetails(
  tenantId: string,
  input: UpdateEmployeeAdminInput
): Promise<void> {
  await updateEmployeeAdminDetails(tenantId, input);
}

export async function saveAdminEmployeeBranches(
  tenantId: string,
  employeeId: number,
  branchIds: number[]
): Promise<void> {
  await replaceEmployeeBranches(tenantId, employeeId, branchIds);
}

export async function saveAdminEmployeeOnboardingStatus(
  tenantId: string,
  employeeId: number,
  onboardingStatus: string
): Promise<void> {
  await setEmployeeOnboardingStatus(tenantId, employeeId, onboardingStatus);
}

export async function saveAdminEmployeeControlPlaneStaffId(
  tenantId: string,
  employeeId: number,
  controlPlaneStaffId: string
): Promise<void> {
  await updateEmployeeControlPlaneStaffId(tenantId, employeeId, controlPlaneStaffId);
}


export interface UpdateAdminEmployeeProfileInput {
  employeeId: number;
  federalState: string | null;
  birthDate: string | null;
  showInCalendar: boolean;
  vacationCarryExpiryEnabledRaw: string | null;
  vacationCarryExpiryMonth: string | null;
  vacationCarryExpiryDay: string | null;
  iban: string | null;
  bic: string | null;
  weeklyHours: number | null;
  compensationTypeRaw: string | null;
  hourlyWageInput: number | null;
  monthlySalaryGrossInput: number | null;
  entryDateRaw: string | null;
  exitDateRaw: string | null;
  firstName: string | null;
  lastName: string | null;
  street: string | null;
  houseNumber: string | null;
  zipCode: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  kinderfreibetrag: number | null;
  taxClass: string | null;
  steuerId: string | null;
  socialSecurityNumber: string | null;
  healthInsurance: string | null;
  healthInsuranceNumber: string | null;
  nationality: string | null;
  maritalStatus: string | null;
  employmentType: string | null;
  workTimeModel: string | null;
  probationMonths: number | null;
  tarifGroup: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  vacationDaysTotal: number | null;
  importedOvertimeBalance: number | null;
  importedMinusstundenBalance: number | null;
  importedVacationTaken: number | null;
  importedBonusEarned: number | null;
}

export async function updateAdminEmployeeProfile(
  tenantId: string,
  input: UpdateAdminEmployeeProfileInput
): Promise<void> {
  const existing = await getEmployeeAdminDetails(tenantId, input.employeeId);
  if (!existing) {
    throw new Error('Mitarbeiter wurde nicht gefunden.');
  }

  const compensationTypeNormalized = String(
    input.compensationTypeRaw ?? existing.compensation_type ?? 'hourly'
  )
    .trim()
    .toLowerCase();
  const compensationType: 'hourly' | 'fixed' = compensationTypeNormalized === 'fixed' ? 'fixed' : 'hourly';
  const compensationResolution = resolveHourlyWageFromCompensation(
    compensationType,
    input.weeklyHours,
    input.hourlyWageInput,
    input.monthlySalaryGrossInput
  );
  if (compensationResolution.error) {
    throw new Error(compensationResolution.error);
  }

  const vacationCarryExpiryEnabled =
    input.vacationCarryExpiryEnabledRaw === 'Ja'
      ? true
      : input.vacationCarryExpiryEnabledRaw === 'Nein'
        ? false
        : Boolean(existing.vacation_carry_expiry_enabled);
  let vacationCarryExpiryDate: string | null = null;
  if (vacationCarryExpiryEnabled) {
    const parsedCarryExpiry = parseCarryExpiryMonthDay(
      input.vacationCarryExpiryMonth,
      input.vacationCarryExpiryDay
    );
    if (parsedCarryExpiry.error) {
      throw new Error(parsedCarryExpiry.error);
    }
    vacationCarryExpiryDate = parsedCarryExpiry.value;
  }

  const entryDate = input.entryDateRaw?.trim() || existing.entry_date;
  const exitDate =
    input.exitDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(input.exitDateRaw) ? input.exitDateRaw : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
    throw new Error('Ungültiges Eintrittsdatum.');
  }
  if (exitDate && exitDate < entryDate) {
    throw new Error('Austrittsdatum darf nicht vor dem Eintrittsdatum liegen.');
  }

  const firstName = input.firstName || existing.first_name;
  const lastName = input.lastName || existing.last_name;
  const payload: UpdateEmployeeAdminInput = {
    id: input.employeeId,
    first_name: firstName,
    last_name: lastName,
    street: input.street ?? null,
    house_number: input.houseNumber ?? null,
    zip_code: input.zipCode ?? null,
    city: input.city ?? null,
    birth_date: input.birthDate,
    entry_date: entryDate,
    exit_date: exitDate,
    phone: input.phone ?? null,
    email: input.email ?? null,
    // Access (username/password/bookingPin/role) is managed centrally in the Control-Plane.
    // Keep the existing values in Timesheet to avoid accidental drift.
    booking_pin: existing.booking_pin,
    federal_state: input.federalState,
    weekly_hours: input.weeklyHours,
    kinderfreibetrag: input.kinderfreibetrag ?? (existing.kinderfreibetrag ?? 0),
    tax_class: input.taxClass ?? null,
    hourly_wage: compensationResolution.hourlyWage,
    compensation_type: compensationType,
    monthly_salary_gross: compensationResolution.monthlySalaryGross,
    iban: input.iban,
    bic: input.bic,
    steuer_id: input.steuerId ?? null,
    social_security_number: input.socialSecurityNumber ?? null,
    health_insurance: input.healthInsurance ?? null,
    health_insurance_number: input.healthInsuranceNumber ?? null,
    nationality: input.nationality ?? null,
    marital_status: input.maritalStatus ?? null,
    employment_type: input.employmentType ?? null,
    work_time_model: input.workTimeModel ?? null,
    probation_months: input.probationMonths,
    tarif_group: input.tarifGroup ?? null,
    emergency_contact_name: input.emergencyContactName ?? null,
    emergency_contact_phone: input.emergencyContactPhone ?? null,
    emergency_contact_relation: input.emergencyContactRelation ?? null,
    vacation_days: existing.vacation_days,
    vacation_days_last_year: existing.vacation_days_last_year,
    vacation_days_total: input.vacationDaysTotal ?? existing.vacation_days_total,
    vacation_carry_expiry_enabled: vacationCarryExpiryEnabled,
    vacation_carry_expiry_date: vacationCarryExpiryDate,
    role_id: existing.role_id,
    username: existing.username,
    passwordHash: undefined,
    imported_overtime_balance: input.importedOvertimeBalance ?? existing.imported_overtime_balance,
    imported_minusstunden_balance:
      input.importedMinusstundenBalance ?? existing.imported_minusstunden_balance,
    imported_vacation_taken: input.importedVacationTaken ?? existing.imported_vacation_taken,
    imported_bonus_earned: input.importedBonusEarned ?? existing.imported_bonus_earned,
    show_in_calendar: input.showInCalendar,
  };

  await saveAdminEmployeeDetails(tenantId, payload);

  await syncAdminEmployeeProfileToControlPlane(tenantId, {
    existing,
    firstName,
    lastName,
    email: input.email ?? null,
    phone: input.phone ?? null,
    street: payload.street,
    houseNumber: payload.house_number,
    zipCode: payload.zip_code,
    city: payload.city,
    federalState: input.federalState,
    birthDate: input.birthDate,
    showInCalendar: input.showInCalendar,
  });

  if (exitDate) {
    await deleteShiftPlanDaysAfter(input.employeeId, exitDate);

    const todayIso = toLocalIsoDate();
    if (exitDate < todayIso) {
      await setEmployeeActive(tenantId, input.employeeId, false);
      await pushAdminEmployeeExitLifecycleUpdate(tenantId, existing.control_plane_staff_id);
    }
  }
}

export async function syncAdminEmployeeProfileToControlPlane(
  tenantId: string,
  input: {
    existing: EmployeeAdminDetails;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    street: string | null;
    houseNumber: string | null;
    zipCode: string | null;
    city: string | null;
    federalState: string | null;
    birthDate: string | null;
    showInCalendar: boolean;
  }
): Promise<void> {
  const controlPlaneStaffId = input.existing.control_plane_staff_id?.trim();
  if (!controlPlaneStaffId) {
    return;
  }

  const country = input.federalState?.startsWith('AT-')
    ? 'AT'
    : input.federalState?.startsWith('CH-')
      ? 'CH'
      : 'DE';

  const synced = await upsertStaffInControlPlane({
    tenantId,
    staffId: controlPlaneStaffId,
    isActive: Boolean(input.existing.isActive),
    displayName:
      [input.firstName?.trim(), input.lastName?.trim()].filter(Boolean).join(' ').trim() ||
      input.existing.username?.trim() ||
      `Mitarbeiter ${input.existing.id}`,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    role: String(input.existing.role_id ?? 1),
    bookingPin: input.existing.booking_pin,
    passwordHash: input.existing.password,
    showInCalendar: input.showInCalendar,
    apps: {
      calendar: input.showInCalendar,
      timeshift: Boolean(input.existing.isActive),
      website: false,
    },
    profile: {
      street: input.street,
      houseNumber: input.houseNumber,
      zipCode: input.zipCode,
      city: input.city,
      country,
      federalState: input.federalState,
      birthDate: input.birthDate,
      phones: input.phone ? [{ type: 'Haupt', number: input.phone }] : [],
    },
  });

  if (!synced?.staffId) {
    throw new Error('Profil wurde gespeichert, aber die Sync zur Mitarbeiterverwaltung ist fehlgeschlagen.');
  }
}

export async function pushAdminEmployeeExitLifecycleUpdate(
  tenantId: string,
  controlPlaneStaffId: string | null | undefined
): Promise<void> {
  const resolvedStaffId = controlPlaneStaffId?.trim();
  if (!resolvedStaffId) {
    return;
  }

  await pushStaffLifecycleUpdateToControlPlane({
    tenantId,
    staffId: resolvedStaffId,
    action: 'deactivate',
    reason: 'exit_date_passed',
  });
}

export async function completeAdminEmployeeOnboardingLifecycle(
  tenantId: string,
  employeeId: number
): Promise<{ activationLinkSent: boolean }> {
  const refreshed = await getEmployeeAdminDetails(tenantId, employeeId);

  const syncStaffLink = async (preferredStaffId?: string): Promise<string> => {
    if (!refreshed) return '';
    const requiresInitialPinSetup =
      (refreshed.onboarding_status ?? '').trim().toLowerCase() === 'pin_setup_required';
    const country = refreshed.federal_state?.startsWith('AT-')
      ? 'AT'
      : refreshed.federal_state?.startsWith('CH-')
        ? 'CH'
        : 'DE';
    const upsert = await upsertStaffInControlPlane({
      tenantId,
      staffId: preferredStaffId?.trim() || refreshed.control_plane_staff_id?.trim() || undefined,
      isActive: true,
      displayName:
        [refreshed.first_name?.trim(), refreshed.last_name?.trim()].filter(Boolean).join(' ').trim() ||
        refreshed.username?.trim() ||
        `Mitarbeiter ${refreshed.id}`,
      firstName: refreshed.first_name,
      lastName: refreshed.last_name,
      email: refreshed.email,
      phone: refreshed.phone,
      role: String(refreshed.role_id ?? 1),
      ...(requiresInitialPinSetup ? {} : { bookingPin: refreshed.booking_pin }),
      passwordHash: refreshed.password,
      showInCalendar: Boolean(refreshed.show_in_calendar),
      apps: {
        calendar: Boolean(refreshed.show_in_calendar),
        timeshift: true,
        website: false,
      },
      profile: {
        street: refreshed.street ?? null,
        houseNumber: refreshed.house_number ?? null,
        zipCode: refreshed.zip_code ?? null,
        city: refreshed.city ?? null,
        country,
        federalState: refreshed.federal_state ?? null,
        birthDate: refreshed.birth_date ?? null,
        phones: refreshed.phone ? [{ type: 'Haupt', number: refreshed.phone }] : [],
      },
    });
    const resolvedStaffId = upsert?.staffId?.trim() ?? '';
    if (!resolvedStaffId) return '';
    if ((refreshed.control_plane_staff_id?.trim() || '') !== resolvedStaffId) {
      await updateEmployeeControlPlaneStaffId(tenantId, employeeId, resolvedStaffId);
    }
    return resolvedStaffId;
  };

  let staffId = refreshed?.control_plane_staff_id?.trim() || '';
  if (!staffId) {
    staffId = await syncStaffLink();
  }

  let activationLinkSent = false;
  if (staffId) {
    activationLinkSent = await sendStaffPasswordActivationLinkToControlPlane({
      tenantId,
      staffId,
    });
  }

  if (!activationLinkSent) {
    const resolvedStaffId = await syncStaffLink(staffId);
    if (resolvedStaffId) {
      staffId = resolvedStaffId;
      activationLinkSent = await sendStaffPasswordActivationLinkToControlPlane({
        tenantId,
        staffId,
      });
    }
  }

  return { activationLinkSent };
}

export async function acceptAdminEmployeeOnboarding(
  tenantId: string,
  employeeId: number
): Promise<{ status: 'success' | 'error'; message: string }> {
  const [employee, onboardingSubmission] = await Promise.all([
    getEmployeeAdminDetails(tenantId, employeeId),
    getEmployeeOnboardingSubmissionSnapshot(tenantId, employeeId),
  ]);

  if (!employee) {
    return { status: 'error', message: 'Mitarbeiter wurde nicht gefunden.' };
  }
  if (employee.onboarding_status !== 'pending') {
    return { status: 'success', message: 'Personalbogen wurde bereits übernommen.' };
  }
  if (!onboardingSubmission) {
    return { status: 'error', message: 'Kein übermittelter Personalbogen gefunden.' };
  }
  if (!isOnboardingSubmissionComplete(onboardingSubmission)) {
    return {
      status: 'error',
      message: 'Personalbogen ist noch nicht vollständig. Bitte fehlende Daten zuerst ergänzen.',
    };
  }

  await setEmployeeActive(tenantId, employeeId, true);
  await saveAdminEmployeeBranches(tenantId, employeeId, []);
  await saveAdminEmployeeOnboardingStatus(tenantId, employeeId, 'pin_setup_required');
  const { activationLinkSent } = await completeAdminEmployeeOnboardingLifecycle(tenantId, employeeId);

  return {
    status: 'success',
    message: activationLinkSent
      ? 'Daten übernommen. Mitarbeiter wurde im Projekt aktiviert. Aktivierungslink wurde versendet. Die Buchungs-PIN wird beim ersten Login abgefragt.'
      : 'Daten übernommen. Mitarbeiter wurde im Projekt aktiviert. Aktivierungslink konnte nicht automatisch versendet werden.',
  };
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
  const employee = await getEmployeeAdminDetails(tenantId, employeeId);
  if (!employee) {
    throw new Error('Mitarbeiter wurde nicht gefunden.');
  }

  const isOnboardingActivation = isActive && (employee.onboarding_status ?? '').trim().toLowerCase() === 'pending';
  let controlPlaneStaffId = employee.control_plane_staff_id?.trim() || null;
  if (isActive && !controlPlaneStaffId) {
    controlPlaneStaffId = await ensureEmployeeControlPlaneLink(tenantId, employeeId);
  }

  await setEmployeeActiveStatus(tenantId, employeeId, isActive);
  const refreshed = await getEmployeeAdminDetails(tenantId, employeeId);
  if (!refreshed) {
    throw new Error('Mitarbeiter wurde nicht gefunden.');
  }

  const effectiveStaffId = controlPlaneStaffId?.trim();
  if (effectiveStaffId) {
    const country = refreshed.federal_state?.startsWith('AT-')
      ? 'AT'
      : refreshed.federal_state?.startsWith('CH-')
        ? 'CH'
        : 'DE';
    const upsert = await upsertStaffInControlPlane({
      tenantId,
      staffId: effectiveStaffId,
      isActive,
      displayName:
        [refreshed.first_name?.trim(), refreshed.last_name?.trim()].filter(Boolean).join(' ').trim() ||
        refreshed.username?.trim() ||
        `Mitarbeiter ${refreshed.id}`,
      firstName: refreshed.first_name,
      lastName: refreshed.last_name,
      email: refreshed.email,
      phone: refreshed.phone,
      role: String(refreshed.role_id ?? 1),
      ...(isOnboardingActivation ? {} : { bookingPin: refreshed.booking_pin }),
      passwordHash: refreshed.password,
      showInCalendar: Boolean(refreshed.show_in_calendar),
      apps: {
        calendar: Boolean(refreshed.show_in_calendar),
        timeshift: true,
        website: false,
      },
      profile: {
        street: refreshed.street ?? null,
        houseNumber: refreshed.house_number ?? null,
        zipCode: refreshed.zip_code ?? null,
        city: refreshed.city ?? null,
        country,
        federalState: refreshed.federal_state ?? null,
        birthDate: refreshed.birth_date ?? null,
        phones: refreshed.phone ? [{ type: 'Haupt', number: refreshed.phone }] : [],
      },
    });
    const resolvedStaffId = upsert?.staffId?.trim() ?? '';
    if (!resolvedStaffId) {
      throw new Error('Control-Plane-Verknüpfung konnte nicht synchronisiert werden.');
    }
    if (resolvedStaffId !== effectiveStaffId) {
      await updateEmployeeControlPlaneStaffId(tenantId, employeeId, resolvedStaffId);
    }
  }
}

export interface UpdateAdminEmployeeSettingsInput {
  employeeId: number;
  maxMinusHours: number | null;
  maxOvertimeHours: number | null;
  sachbezuege: string;
  sachbezuegeAmount: number;
  mindJahresumsatz: number;
  sachbezugVerpflegung: string;
  monthlyBonusProvided: boolean;
  monthlyBonusPercent: number;
  importedOvertimeBalanceInput: number | null;
  importedMinusstundenBalanceInput: number | null;
  importedVacationCarryDaysInput: number | null;
  importedBonusEarnedInput: number | null;
  openingTypeRaw: string | null;
  openingValuesLockedRaw: string | null;
  openingEffectiveDateRaw: string | null;
  openingOvertimeBalanceInput: number | null;
  openingVacationCarryDaysInput: number | null;
  openingVacationTakenYtdInput: number | null;
  openingBonusCarryInput: number | null;
  mandatoryPauseEnabled: boolean;
  mandatoryPauseMinWorkMinutes: number;
  minPauseUnder6Minutes: number;
}

export async function updateAdminEmployeeSettings(
  tenantId: string,
  input: UpdateAdminEmployeeSettingsInput
): Promise<string | null> {
  const existing = await getEmployeeAdminDetails(tenantId, input.employeeId);
  if (!existing) {
    return 'Mitarbeiter nicht gefunden.';
  }

  let mandatoryPauseMinWorkMinutes = 0;
  let minPauseUnder6Minutes = 0;
  if (input.mandatoryPauseEnabled) {
    mandatoryPauseMinWorkMinutes = input.mandatoryPauseMinWorkMinutes;
    minPauseUnder6Minutes = input.minPauseUnder6Minutes;

    if (!Number.isFinite(mandatoryPauseMinWorkMinutes) || mandatoryPauseMinWorkMinutes <= 0) {
      return 'Bitte eine tägliche Arbeitszeit für die Pflichtpause auswählen.';
    }
    if (mandatoryPauseMinWorkMinutes > 360 || mandatoryPauseMinWorkMinutes % 15 !== 0) {
      return 'Ungültige tägliche Arbeitszeit für die Pflichtpause.';
    }

    const allowedPause = new Set([15, 30, 45, 60, 90, 120]);
    if (!allowedPause.has(minPauseUnder6Minutes)) {
      return 'Ungültige Pflichtpause (Minuten).';
    }
  }

  const monatlicherBonusProzent = input.monthlyBonusProvided
    ? input.monthlyBonusPercent
    : Number(existing.monatlicher_bonus_prozent ?? 0);
  const openingTypeRaw = String(input.openingTypeRaw ?? existing.opening_type ?? 'new').trim();
  const openingType: 'new' | 'existing' = openingTypeRaw === 'existing' ? 'existing' : 'new';
  const openingValuesLocked =
    input.openingValuesLockedRaw === 'Ja'
      ? true
      : input.openingValuesLockedRaw === 'Nein'
        ? false
        : Boolean(existing.opening_values_locked);
  const openingEffectiveDate =
    input.openingEffectiveDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(input.openingEffectiveDateRaw)
      ? input.openingEffectiveDateRaw
      : existing.opening_effective_date ?? existing.entry_date ?? null;
  const openingOvertimeBalance =
    input.openingOvertimeBalanceInput ?? Number(existing.opening_overtime_balance ?? 0);
  const openingVacationCarryDays =
    input.openingVacationCarryDaysInput ?? Number(existing.opening_vacation_carry_days ?? 0);
  const openingVacationTakenYtd =
    input.openingVacationTakenYtdInput ?? Number(existing.opening_vacation_taken_ytd ?? 0);
  const openingBonusCarry = input.openingBonusCarryInput ?? Number(existing.opening_bonus_carry ?? 0);
  const existingOpeningOvertimeBalance = Number(existing.opening_overtime_balance ?? 0);
  const existingOpeningVacationCarryDays = Number(existing.opening_vacation_carry_days ?? 0);
  const existingOpeningVacationTakenYtd = Number(existing.opening_vacation_taken_ytd ?? 0);
  const existingOpeningBonusCarry = Number(existing.opening_bonus_carry ?? 0);
  const openingChanged =
    openingType !== existing.opening_type ||
    openingEffectiveDate !== (existing.opening_effective_date ?? null) ||
    Math.abs(openingOvertimeBalance - existingOpeningOvertimeBalance) > 0.0001 ||
    Math.abs(openingVacationCarryDays - existingOpeningVacationCarryDays) > 0.0001 ||
    Math.abs(openingVacationTakenYtd - existingOpeningVacationTakenYtd) > 0.0001 ||
    Math.abs(openingBonusCarry - existingOpeningBonusCarry) > 0.0001;

  if (existing.opening_values_locked && openingChanged) {
    return 'Eröffnungswerte sind gesperrt. Bitte zuerst die Sperre auf Nein setzen.';
  }

  const payload: EmployeeSettingsInput = {
    employeeId: input.employeeId,
    maxMinusHours: input.maxMinusHours,
    maxOvertimeHours: input.maxOvertimeHours,
    sachbezuege: input.sachbezuege,
    sachbezuegeAmount: input.sachbezuegeAmount,
    mindJahresumsatz: input.mindJahresumsatz,
    sachbezugVerpflegung: input.sachbezugVerpflegung,
    monatlicherBonusProzent,
    importedOvertimeBalance: input.importedOvertimeBalanceInput ?? Number(existing.imported_overtime_balance ?? 0),
    importedMinusstundenBalance:
      input.importedMinusstundenBalanceInput ?? Number(existing.imported_minusstunden_balance ?? 0),
    importedVacationCarryDays:
      input.importedVacationCarryDaysInput ?? Number(existing.imported_vacation_taken ?? 0),
    importedBonusEarned: input.importedBonusEarnedInput ?? Number(existing.imported_bonus_earned ?? 0),
    openingType,
    openingValuesLocked,
    openingEffectiveDate,
    openingOvertimeBalance,
    openingVacationCarryDays,
    openingVacationTakenYtd,
    openingBonusCarry,
    mandatoryPauseMinWorkMinutes,
    minPauseUnder6Minutes,
    mandatoryPauseEnabled: input.mandatoryPauseEnabled,
  };

  await saveEmployeeSettings(tenantId, payload);
  if (openingChanged) {
    // Opening values represent the baseline. When that baseline changes, any legacy
    // manual overtime correction must be reset to avoid stale offsets.
    await saveEmployeeOvertimeBalance(tenantId, input.employeeId, 0);
  }

  return null;
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
