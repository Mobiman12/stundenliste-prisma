import {
  deleteDailyDayByDate,
  getDailyDay,
  listDailyDayRecords,
  listDailyDays,
  clearAdminChangeMeta,
  updateAdminChangeMeta,
  upsertDailyDay,
  type DailyDayRecord,
  type DailyDaySummary,
  type UpsertDailyDayInput,
} from '@/lib/data/daily-days';
import { listLeaveRequestsForEmployee, listLeaveRequestsForEmployeeInDateRange } from '@/lib/data/leave-requests';
import {
  employeeExists,
  getEmployeeOvertimeSettings,
  updateEmployeeOvertimeBalance,
  getEmployeeValidationInfo,
} from '@/lib/data/employees';
import { recalculateOvertime, type DailyOvertimeInput } from '@/lib/services/overtime';
import {
  deriveCodeFromPlanLabel,
  getPlanHoursForDay,
  getPlanHoursForDayFromPlan,
} from '@/lib/services/shift-plan-hours';
import { getShiftPlan } from '@/lib/services/shift-plan-read';
import { isMonthClosedForEmployee } from '@/lib/services/employee/monthly-closing';
import { isHolidayIsoDate, normalizeHolidayRegion } from '@/lib/services/holidays';
import { calculateIstHours, calculateLegalPauseHours } from '@/lib/services/time-calculations';
import { validateTimeEntry } from '@/lib/services/time-entry-validation';
import { fetchTillhubDailyGrossForStaff } from '@/lib/services/tillhub';

const MEAL_BLOCKED_CODES = new Set(['U', 'UH', 'UBF', 'K', 'KK', 'KR', 'KKR', 'KU', 'FT']);
const NON_REVENUE_CODES = new Set(['U', 'UH', 'UBF', 'K', 'KK', 'KR', 'KKR', 'KU', 'FT']);
const RANGE_ELIGIBLE_CODES = new Set(['U', 'UH', 'K', 'KK', 'KKR', 'KR', 'KU']);

export interface CreateAdminTimeEntryInput {
  tenantId: string;
  employeeId: number;
  dayDateRaw: string;
  rangeEndDateRaw?: string | null;
  kommt1Raw?: string | null;
  geht1Raw?: string | null;
  kommt2Raw?: string | null;
  geht2Raw?: string | null;
  pauseRaw?: string | null;
  codeRaw?: string | null;
  mittagRaw?: string | null;
  bruttoRaw?: string | null;
  bemerkungenRaw?: string | null;
  performedBy: {
    type: 'admin';
    id: number | null;
    name: string | null;
  };
}

export interface DeleteAdminTimeEntryInput {
  tenantId: string;
  employeeId: number;
  dayDateRaw: string;
}

function formatMonthLabel(year: number, month: number): string {
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
  const index = month - 1;
  const name = MONTH_NAMES[index] ?? '';
  return name ? `${name} ${year}` : `${String(month).padStart(2, '0')}.${year}`;
}

function extractYearMonth(isoDate: string): { year: number; month: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return null;
  }
  const year = Number.parseInt(isoDate.slice(0, 4), 10);
  const month = Number.parseInt(isoDate.slice(5, 7), 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return null;
  }
  return { year, month };
}

function normalizeTimeInput(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    return raw.padStart(5, '0');
  }
  if (/^\d{3,4}$/.test(raw)) {
    const padded = raw.padStart(4, '0');
    return `${padded.slice(0, 2)}:${padded.slice(2)}`;
  }
  return null;
}

function normalizePause(value: string | null | undefined): string | null {
  const raw = value?.trim() ?? '';
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    return `${raw}min.`;
  }
  return raw;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function compareIsoDate(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function addDaysIso(isoDate: string, delta: number): string {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + delta);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function enumerateIsoDates(startIso: string, endIso: string): string[] {
  if (!isIsoDate(startIso) || !isIsoDate(endIso)) {
    return [];
  }
  const result: string[] = [];
  let current = startIso;
  while (compareIsoDate(current, endIso) <= 0) {
    result.push(current);
    if (current === endIso) {
      break;
    }
    current = addDaysIso(current, 1);
  }
  return result;
}

export interface SaveTimeEntryInput {
  tenantId: string;
  employeeId: number;
  dayDate: string;
  brutto?: number | null;
  kommt1?: string | null;
  geht1?: string | null;
  kommt2?: string | null;
  geht2?: string | null;
  pause?: string | null;
  code?: string | null;
  bemerkungen?: string | null;
  mittag?: string | null;
  schicht?: string | null;
  performedBy?: {
    type: 'employee' | 'admin';
    id: number | null;
    name: string | null;
  };
  preserveOvertimeTimes?: boolean;
}

const ADMIN_TRACKED_FIELDS: Array<{
  key: 'kommt1' | 'geht1' | 'kommt2' | 'geht2' | 'pause' | 'code' | 'bemerkungen' | 'brutto' | 'mittag' | 'schicht';
  label: string;
  formatter?: (value: unknown) => string;
}> = [
  { key: 'kommt1', label: 'Kommt 1' },
  { key: 'geht1', label: 'Geht 1' },
  { key: 'kommt2', label: 'Kommt 2' },
  { key: 'geht2', label: 'Geht 2' },
  { key: 'pause', label: 'Pause' },
  { key: 'mittag', label: 'Mittag' },
  { key: 'code', label: 'Code' },
  { key: 'schicht', label: 'Schicht' },
  {
    key: 'brutto',
    label: 'Umsatz',
    formatter: (value) => {
      if (value === null || value === undefined || value === '') {
        return '—';
      }
      const num = typeof value === 'number' ? value : Number.parseFloat(String(value));
      if (!Number.isFinite(num)) {
        return '—';
      }
      return `${num.toFixed(2).replace('.', ',')} €`;
    },
  },
  { key: 'bemerkungen', label: 'Notiz' },
];

function formatAdminValue(key: (typeof ADMIN_TRACKED_FIELDS)[number]['key'], value: unknown): string {
  const field = ADMIN_TRACKED_FIELDS.find((item) => item.key === key);
  if (!field) {
    return '—';
  }
  if (field.formatter) {
    return field.formatter(value);
  }
  if (value === null || value === undefined) {
    return '—';
  }
  const str = String(value).trim();
  return str.length ? str : '—';
}

function normalizeAdminValue(
  key: (typeof ADMIN_TRACKED_FIELDS)[number]['key'],
  value: unknown
): string | number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (key === 'brutto') {
    const num = typeof value === 'number' ? value : Number.parseFloat(String(value));
    if (!Number.isFinite(num)) {
      return null;
    }
    return Math.round(num * 100) / 100;
  }
  const str = String(value).trim();
  if (!str.length) {
    return null;
  }
  if (key === 'code') {
    return str.toUpperCase();
  }
  return str;
}

function getPayloadValue(payload: UpsertDailyDayInput, key: (typeof ADMIN_TRACKED_FIELDS)[number]['key']) {
  switch (key) {
    case 'kommt1':
      return payload.kommt1 ?? null;
    case 'geht1':
      return payload.geht1 ?? null;
    case 'kommt2':
      return payload.kommt2 ?? null;
    case 'geht2':
      return payload.geht2 ?? null;
    case 'pause':
      return payload.pause ?? null;
    case 'code':
      return payload.code ?? null;
    case 'bemerkungen':
      return payload.bemerkungen ?? null;
    case 'brutto':
      return payload.brutto ?? null;
    case 'mittag':
      return payload.mittag ?? null;
    case 'schicht':
      return payload.schicht ?? null;
    default:
      return null;
  }
}

function getRecordValue(record: DailyDayRecord | null, key: (typeof ADMIN_TRACKED_FIELDS)[number]['key']) {
  if (!record) {
    return null;
  }
  switch (key) {
    case 'kommt1':
      return record.kommt1 ?? null;
    case 'geht1':
      return record.geht1 ?? null;
    case 'kommt2':
      return record.kommt2 ?? null;
    case 'geht2':
      return record.geht2 ?? null;
    case 'pause':
      return record.pause ?? null;
    case 'code':
      return record.code ?? null;
    case 'bemerkungen':
      return record.bemerkungen ?? null;
    case 'brutto':
      return record.brutto ?? null;
    case 'mittag':
      return record.mittag ?? null;
    case 'schicht':
      return record.schicht ?? null;
    default:
      return null;
  }
}

function buildAdminChangeSummary(
  existing: DailyDayRecord | null,
  payload: UpsertDailyDayInput
): { type: 'create' | 'update'; summary: string } | null {
  if (!existing) {
    const parts: string[] = [];
    for (const field of ADMIN_TRACKED_FIELDS) {
      const nextValue = getPayloadValue(payload, field.key);
      const normalizedNext = normalizeAdminValue(field.key, nextValue);
      if (normalizedNext === null) {
        continue;
      }
      const formatted = formatAdminValue(field.key, nextValue);
      if (formatted === '—') {
        continue;
      }
      parts.push(`${field.label}: ${formatted}`);
    }
    const summary = parts.length ? `Neu: ${parts.join(', ')}` : 'Neuer Eintrag angelegt.';
    return { type: 'create', summary };
  }

  const changes: string[] = [];
  for (const field of ADMIN_TRACKED_FIELDS) {
    const previousValue = getRecordValue(existing, field.key);
    const nextValue = getPayloadValue(payload, field.key);
    const normalizedPrev = normalizeAdminValue(field.key, previousValue);
    const normalizedNext = normalizeAdminValue(field.key, nextValue);

    const valuesEqual =
      normalizedPrev === normalizedNext ||
      (typeof normalizedPrev === 'number' &&
        typeof normalizedNext === 'number' &&
        Math.abs(normalizedPrev - normalizedNext) < 0.005);

    if (valuesEqual) {
      continue;
    }
    const formattedPrev = formatAdminValue(field.key, previousValue);
    const formattedNext = formatAdminValue(field.key, nextValue);
    changes.push(`${field.label}: ${formattedPrev} → ${formattedNext}`);
  }

  if (!changes.length) {
    return null;
  }

  return { type: 'update', summary: changes.join(', ') };
}

function mapRecordToOvertimeInput(record: DailyDayRecord): DailyOvertimeInput {
  return {
    id: record.id,
    dayDate: record.day_date,
    code: record.code,
    kommt1: record.kommt1,
    geht1: record.geht1,
    kommt2: record.kommt2,
    geht2: record.geht2,
    pause: record.pause,
    schicht: record.schicht,
    brutto: record.brutto ?? undefined,
    planHours: record.plan_hours ?? undefined,
    sickHours: record.sick_hours ?? undefined,
    childSickHours: record.child_sick_hours ?? undefined,
    shortWorkHours: record.short_work_hours ?? undefined,
    vacationHours: record.vacation_hours ?? undefined,
    holidayHours: record.holiday_hours ?? undefined,
    overtimeDelta: record.overtime_delta ?? undefined,
    forcedOverflow: record.forced_overflow ?? undefined,
  };
}

function applyRecalculatedDay(record: DailyDayRecord, update: ReturnType<typeof recalculateOvertime>['updatedDays'][number]) {
  const payload: UpsertDailyDayInput = {
    employeeId: record.employee_id,
    dayDate: record.day_date,
    brutto: record.brutto,
    kommt1: record.kommt1,
    geht1: record.geht1,
    kommt2: record.kommt2,
    geht2: record.geht2,
    pause: record.pause,
    code: record.code,
    bemerkungen: record.bemerkungen,
    mittag: record.mittag,
    schicht: record.schicht,
    sickHours: update.sickHours,
    childSickHours: update.childSickHours,
    shortWorkHours: update.shortWorkHours,
    vacationHours: update.vacationHours,
    holidayHours: record.holiday_hours,
    overtimeDelta: update.overtimeDelta,
    planHours: update.planHours,
    forcedOverflow: update.forcedOverflow,
    forcedOverflowReal: record.forced_overflow_real,
    requiredPauseUnder6Minutes: record.required_pause_under6_minutes,
  };
  upsertDailyDay(payload);
}

function parseIsoDate(isoDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const parsed = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function enumerateDates(startIso: string, endIso: string): string[] {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  if (!start || !end || start > end) return [];
  const result: string[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, '0');
    const day = String(cursor.getDate()).padStart(2, '0');
    result.push(`${year}-${month}-${day}`);
  }
  return result;
}

function toDurationHours(startTime: string | null | undefined, endTime: string | null | undefined): number {
  if (!startTime || !endTime) return 0;
  const parse = (value: string): number | null => {
    const normalized = value.trim();
    const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number.parseInt(match[1] ?? '', 10);
    const minutes = Number.parseInt(match[2] ?? '', 10);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return null;
    }
    return hours * 60 + minutes;
  };
  const start = parse(startTime);
  const end = parse(endTime);
  if (start === null || end === null || end <= start) return 0;
  return Number(((end - start) / 60).toFixed(2));
}

async function getApprovedOvertimeReductionHoursForDate(
  tenantId: string,
  employeeId: number,
  isoDate: string,
): Promise<number> {
  const requests = await listLeaveRequestsForEmployeeInDateRange(tenantId, employeeId, isoDate, isoDate, 200);
  let totalHours = 0;
  for (const request of requests) {
    if (request.type !== 'overtime') continue;
    if (request.status !== 'approved') continue;
    if (request.cancelled_at) continue;
    if (isoDate < request.start_date || isoDate > request.end_date) continue;
    const duration = toDurationHours(request.start_time, request.end_time);
    if (duration > 0) {
      totalHours += duration;
    }
  }
  return Number(totalHours.toFixed(2));
}

export async function recomputeEmployeeOvertime(tenantId: string, employeeId: number): Promise<void> {
  const records = await listDailyDayRecords(employeeId);
  if (!records.length) {
    // continue: approved overtime reduction can exist without any daily records yet
  }

  const overtimeInputs = records.map(mapRecordToOvertimeInput);
  const overtimeSettings = await getEmployeeOvertimeSettings(tenantId, employeeId);
  const shiftPlan = await getShiftPlan(employeeId);

  const recordDates = new Set(records.map((record) => record.day_date));
  const syntheticOvertimeDates = new Set<string>();
  for (const [isoDate, planDay] of Object.entries(shiftPlan.days)) {
    if (!planDay || recordDates.has(isoDate)) {
      continue;
    }
    const syntheticCode = deriveCodeFromPlanLabel(planDay.label);
    if (!syntheticCode) {
      continue;
    }
    const planInfo = getPlanHoursForDayFromPlan(shiftPlan, isoDate, planDay.label ?? '')
      ?? await getPlanHoursForDay(employeeId, isoDate, planDay.label ?? '');
    if (!planInfo || planInfo.sollHours <= 0.001) {
      continue;
    }
    overtimeInputs.push({
      dayDate: isoDate,
      code: syntheticCode,
      planHours: planInfo.sollHours,
      pause: 'Keine',
      schicht: planDay.label ?? '',
    });
    if (syntheticCode === 'Ü') {
      syntheticOvertimeDates.add(isoDate);
    }
  }

  // Approved overtime reductions must affect overtime balance immediately,
  // even when the employee has not yet submitted the actual day entry.
  const leaveRequests = await listLeaveRequestsForEmployee(tenantId, employeeId, 5000);
  for (const request of leaveRequests) {
    if (request.type !== 'overtime') continue;
    if (request.status !== 'approved') continue;
    if (request.cancelled_at) continue;

    const explicitDurationHours = toDurationHours(request.start_time, request.end_time);
    for (const isoDate of enumerateDates(request.start_date, request.end_date)) {
      if (syntheticOvertimeDates.has(isoDate)) {
        continue;
      }
      const existingRecord = records.find((entry) => entry.day_date === isoDate);
      if (existingRecord && (existingRecord.code ?? '').trim().toUpperCase() === 'Ü') {
        continue;
      }
      const planInfo = getPlanHoursForDayFromPlan(shiftPlan, isoDate, request.reason ?? '')
        ?? await getPlanHoursForDay(employeeId, isoDate, request.reason ?? '');
      const deductionHours = explicitDurationHours > 0 ? explicitDurationHours : Number(planInfo?.sollHours ?? 0);
      if (!Number.isFinite(deductionHours) || deductionHours <= 0.001) {
        continue;
      }
      overtimeInputs.push({
        dayDate: isoDate,
        code: 'Ü',
        planHours: Number(deductionHours.toFixed(2)),
        pause: 'Keine',
        schicht: 'Überstundenabbau',
      });
      syntheticOvertimeDates.add(isoDate);
    }
  }
  const result = recalculateOvertime(
    overtimeInputs,
    {
      maxMinusHours: overtimeSettings.maxMinusHours,
      maxOvertimeHours: overtimeSettings.maxOvertimeHours,
    },
    {
      planHoursProvider: (entry) => {
        if (entry.planHours && entry.planHours > 0) {
          return entry.planHours;
        }
        const info = getPlanHoursForDayFromPlan(shiftPlan, entry.dayDate, entry.schicht ?? '');
        return info?.sollHours ?? 0;
      },
    }
  );

  const recordById = new Map(records.map((record) => [record.id, record]));
  for (const updated of result.updatedDays) {
    if (!updated.id) {
      // Synthetic rows (e.g. approved overtime reductions without daily entry)
      // must affect balance only, never overwrite an existing day record.
      continue;
    }
    const baseRecord = recordById.get(updated.id);
    if (!baseRecord) continue;
    applyRecalculatedDay(baseRecord, updated);
  }

  await updateEmployeeOvertimeBalance(tenantId, employeeId, result.balanceHours);
}

export async function saveTimeEntry(input: SaveTimeEntryInput): Promise<number> {
  const tenantId = input.tenantId;
  const actor = input.performedBy ?? { type: 'employee' as const, id: null, name: null };
  const adminName = actor.type === 'admin' && actor.name ? actor.name.trim() : null;
  const adminDisplayName = adminName && adminName.length ? adminName : 'Admin';
  const existingRecord = await getDailyDay(input.employeeId, input.dayDate);

  const planInfo = await getPlanHoursForDay(input.employeeId, input.dayDate, input.schicht ?? '');
  const employeeInfo = await getEmployeeValidationInfo(tenantId, input.employeeId);

  let codeNormalized = (input.code ?? '').trim().toUpperCase();

  let kommt1 = input.kommt1 ?? null;
  let geht1 = input.geht1 ?? null;
  let kommt2 = input.kommt2 ?? null;
  let geht2 = input.geht2 ?? null;
  let pause = input.pause ?? 'Keine';
  let mittag = (input.mittag ?? 'Nein').toLowerCase() === 'ja' ? 'Ja' : 'Nein';

  const ist = calculateIstHours(kommt1 ?? '', geht1 ?? '', kommt2 ?? '', geht2 ?? '', pause ?? 'Keine');

  const minPauseUnder6Setting = Math.max(employeeInfo?.minPauseUnder6Minutes ?? 0, 0);
  const mandatoryPauseMinWorkSetting = Math.max(employeeInfo?.mandatoryPauseMinWorkMinutes ?? 0, 0);

  let planHours = 0;
  let storedRequiredPauseMinutes = 0;

  if (planInfo) {
    const baseRequiredPauseMinutes = Math.max(planInfo.requiredPauseMinutes ?? 0, 0);
    const legalPauseMinutes = calculateLegalPauseHours(planInfo.rawHours) * 60;
    const mandatoryPauseSetting = Math.max(minPauseUnder6Setting, 0);

    let enforcedPauseMinutes = Math.max(baseRequiredPauseMinutes, legalPauseMinutes);
    if (mandatoryPauseSetting > 0) {
      const rawMinutes = Math.round(Math.max(planInfo.rawHours, 0) * 60);
      const mandatoryApplies =
        rawMinutes > 0 &&
        rawMinutes <= 360 &&
        (mandatoryPauseMinWorkSetting <= 0 || rawMinutes + 0.9 >= mandatoryPauseMinWorkSetting);
      if (mandatoryApplies && mandatoryPauseSetting > enforcedPauseMinutes) {
        enforcedPauseMinutes = mandatoryPauseSetting;
      }
    }

    const netHours = Math.max(planInfo.rawHours - enforcedPauseMinutes / 60, 0);
    planHours = Number(netHours.toFixed(2));
    storedRequiredPauseMinutes = Math.round(enforcedPauseMinutes);
  }

  let planHoursForSave = planHours;

  let sickHours = 0;
  let childSickHours = 0;
  let shortWorkHours = 0;
  let vacationHours = 0;
  let holidayHours = 0;

  const setAllTimesToZero = () => {
    kommt1 = '00:00';
    geht1 = '00:00';
    kommt2 = null;
    geht2 = null;
    pause = 'Keine';
  };

  const isEmptyTimeValue = (value: string | null) => {
    const normalized = (value ?? '').trim().toLowerCase();
    return (
      normalized === '' ||
      normalized === '00:00' ||
      normalized === '0' ||
      normalized === '0:00' ||
      normalized === '0min' ||
      normalized === '0min.' ||
      normalized === 'keine'
    );
  };

  switch (codeNormalized) {
    case 'U':
      setAllTimesToZero();
      mittag = 'Nein';
      vacationHours = planHours;
      break;
    case 'UH': {
      const halfPlan = planHours / 2;
      const epsilon = 0.01;
      if (halfPlan > 0 && ist.netHours > halfPlan + epsilon) {
        throw new Error('Bei halbem Urlaub darf maximal die Hälfte der Sollzeit gearbeitet werden. Bitte Zeiten oder Code anpassen.');
      }
      vacationHours = halfPlan;
      break;
    }
    case 'K':
      setAllTimesToZero();
      mittag = 'Nein';
      sickHours = planHours;
      break;
    case 'KK':
      setAllTimesToZero();
      mittag = 'Nein';
      childSickHours = planHours;
      break;
    case 'KU':
      setAllTimesToZero();
      mittag = 'Nein';
      shortWorkHours = planHours;
      planHoursForSave = 0;
      break;
    case 'KR': {
      sickHours = Math.max(planHours - ist.netHours, 0);
      const matchesPlanTimes =
        planInfo &&
        planInfo.start &&
        planInfo.end &&
        (input.kommt1 ?? '') === planInfo.start &&
        (input.geht1 ?? '') === planInfo.end &&
        isEmptyTimeValue(input.kommt2 ?? null) &&
        isEmptyTimeValue(input.geht2 ?? null);
      if (planInfo && planHours > 0 && Math.abs(sickHours - planHours) < 0.01 && matchesPlanTimes) {
        codeNormalized = 'K';
        setAllTimesToZero();
        mittag = 'Nein';
        sickHours = planHours;
      }
      break;
    }
    case 'KKR': {
      childSickHours = Math.max(planHours - ist.netHours, 0);
      const matchesPlanTimes =
        planInfo &&
        planInfo.start &&
        planInfo.end &&
        (input.kommt1 ?? '') === planInfo.start &&
        (input.geht1 ?? '') === planInfo.end &&
        isEmptyTimeValue(input.kommt2 ?? null) &&
        isEmptyTimeValue(input.geht2 ?? null);
      if (planInfo && planHours > 0 && Math.abs(childSickHours - planHours) < 0.01 && matchesPlanTimes) {
        codeNormalized = 'KK';
        setAllTimesToZero();
        mittag = 'Nein';
        childSickHours = planHours;
      }
      break;
    }
    case 'FT':
      if (ist.netHours <= 0.01) {
        holidayHours = planHours;
        setAllTimesToZero();
        mittag = 'Nein';
      }
      break;
    case 'UBF':
      setAllTimesToZero();
      mittag = 'Nein';
      planHoursForSave = 0;
      break;
    case 'Ü': {
      const planStart = planInfo?.start ?? '';
      const planEnd = planInfo?.end ?? '';
      const secondBlockEmpty = isEmptyTimeValue(kommt2) && isEmptyTimeValue(geht2);
      const pauseIsZero = isEmptyTimeValue(pause);
      if (
        !input.preserveOvertimeTimes &&
        planStart &&
        planEnd &&
        (kommt1 ?? '') === planStart &&
        (geht1 ?? '') === planEnd &&
        secondBlockEmpty &&
        pauseIsZero
      ) {
        setAllTimesToZero();
        mittag = 'Nein';
      }
      break;
    }
    default:
      break;
  }

  if (codeNormalized === 'RA' && planHoursForSave > 0) {
    const approvedOvertimeReductionHours = await getApprovedOvertimeReductionHoursForDate(
      tenantId,
      input.employeeId,
      input.dayDate,
    );
    if (approvedOvertimeReductionHours > 0) {
      planHoursForSave = Number((planHoursForSave + approvedOvertimeReductionHours).toFixed(2));
    }
  }

  if (MEAL_BLOCKED_CODES.has(codeNormalized)) {
    mittag = 'Nein';
  }

  let effectiveBrutto = input.brutto ?? null;
  const tillhubUserId = employeeInfo?.tillhubUserId?.trim();
  if (
    (effectiveBrutto === null || effectiveBrutto <= 0) &&
    tillhubUserId &&
    !NON_REVENUE_CODES.has(codeNormalized)
  ) {
    try {
      const { gross } = await fetchTillhubDailyGrossForStaff({
        staffId: tillhubUserId,
        date: input.dayDate,
        tenantId,
      });
      if (typeof gross === 'number' && Number.isFinite(gross)) {
        effectiveBrutto = gross;
      }
    } catch (error) {
      console.warn('[tillhub] saveTimeEntry gross import failed', {
        tenantId,
        employeeId: input.employeeId,
        dayDate: input.dayDate,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const payload: UpsertDailyDayInput = {
    employeeId: input.employeeId,
    dayDate: input.dayDate,
    brutto: effectiveBrutto,
    kommt1,
    geht1,
    kommt2,
    geht2,
    pause,
    code: codeNormalized,
    bemerkungen: input.bemerkungen ? input.bemerkungen : null,
    mittag,
    schicht: input.schicht ?? '',
    sickHours,
    childSickHours,
    shortWorkHours,
    vacationHours,
    holidayHours,
    overtimeDelta: 0,
    planHours: planHoursForSave,
    forcedOverflow: 0,
    forcedOverflowReal: 0,
    requiredPauseUnder6Minutes: storedRequiredPauseMinutes,
  };

  const entryId = await upsertDailyDay(payload);
  await recomputeEmployeeOvertime(tenantId, input.employeeId);

  if (actor.type === 'admin') {
    const summary = buildAdminChangeSummary(existingRecord, payload);
    if (summary) {
      updateAdminChangeMeta(input.employeeId, input.dayDate, {
        at: new Date().toISOString(),
        by: adminDisplayName,
        type: summary.type,
        summary: summary.summary,
      });
    }
  } else {
    clearAdminChangeMeta(input.employeeId, input.dayDate);
  }

  return entryId;
}

export async function createAdminTimeEntry(
  input: CreateAdminTimeEntryInput
): Promise<{ status: 'success' | 'error'; message: string }> {
  if (!(await employeeExists(input.tenantId, input.employeeId))) {
    return { status: 'error', message: 'Mitarbeiter wurde nicht gefunden.' };
  }

  const dayDateRaw = input.dayDateRaw.trim();
  if (!dayDateRaw) {
    return { status: 'error', message: 'Bitte ein Datum auswählen.' };
  }
  if (!isIsoDate(dayDateRaw)) {
    return { status: 'error', message: 'Ungültiges Datum.' };
  }

  const validationProfile = await getEmployeeValidationInfo(input.tenantId, input.employeeId);
  if (!validationProfile) {
    return { status: 'error', message: 'Mitarbeiterdaten konnten nicht geladen werden.' };
  }

  const kommt1 = normalizeTimeInput(input.kommt1Raw);
  const geht1 = normalizeTimeInput(input.geht1Raw);
  const kommt2 = normalizeTimeInput(input.kommt2Raw);
  const geht2 = normalizeTimeInput(input.geht2Raw);
  const pause = normalizePause(input.pauseRaw);
  const code = input.codeRaw?.trim().length ? input.codeRaw.trim() : 'RA';
  const mittag = (input.mittagRaw ?? 'Nein').trim().toLowerCase() === 'ja' ? 'Ja' : 'Nein';
  const normalizedCode = code.toUpperCase();

  if (normalizedCode === 'Ü' && (!kommt1 || !geht1)) {
    return { status: 'error', message: 'Für Überstundenabbau bitte Start- und Endzeit eingeben.' };
  }

  let rangeStart = dayDateRaw;
  let rangeEnd = dayDateRaw;
  const rangeEndRaw = input.rangeEndDateRaw?.trim() ?? '';

  if (rangeEndRaw && RANGE_ELIGIBLE_CODES.has(normalizedCode)) {
    if (!isIsoDate(rangeEndRaw)) {
      return { status: 'error', message: 'Der Zeitraum konnte nicht gelesen werden.' };
    }
    if (compareIsoDate(rangeEndRaw, rangeStart) < 0) {
      rangeStart = rangeEndRaw;
      rangeEnd = dayDateRaw;
    } else {
      rangeEnd = rangeEndRaw;
    }
  }

  const datesToProcess = enumerateIsoDates(rangeStart, rangeEnd);
  if (!datesToProcess.length) {
    return { status: 'error', message: 'Der Zeitraum konnte nicht gelesen werden.' };
  }

  for (const isoDate of datesToProcess) {
    const extracted = extractYearMonth(isoDate);
    if (!extracted) {
      return { status: 'error', message: 'Der Zeitraum enthält ein ungültiges Datum.' };
    }
    if (await isMonthClosedForEmployee(input.employeeId, extracted.year, extracted.month)) {
      return {
        status: 'error',
        message: `Der Monat ${formatMonthLabel(extracted.year, extracted.month)} ist bereits abgeschlossen.`,
      };
    }
  }

  const federalState = normalizeHolidayRegion(validationProfile.federalState);
  const bruttoValue = Number.parseFloat(String(input.bruttoRaw ?? ''));
  const brutto = Number.isFinite(bruttoValue) ? bruttoValue : null;
  const bemerkungen = input.bemerkungenRaw?.trim() || null;

  const warnings: string[] = [];
  let holidayCount = 0;

  for (const isoDate of datesToProcess) {
    const holidayInfo = normalizedCode === 'U' ? isHolidayIsoDate(isoDate, federalState) : { isHoliday: false };
    const effectiveCode = holidayInfo.isHoliday ? 'FT' : normalizedCode;
    if (holidayInfo.isHoliday) {
      holidayCount += 1;
    }

    const effectiveKommt1 = effectiveCode === 'FT' || normalizedCode === 'U' ? null : kommt1;
    const effectiveGeht1 = effectiveCode === 'FT' || normalizedCode === 'U' ? null : geht1;
    const effectiveKommt2 = effectiveCode === 'FT' || normalizedCode === 'U' ? null : kommt2;
    const effectiveGeht2 = effectiveCode === 'FT' || normalizedCode === 'U' ? null : geht2;
    const effectivePause = effectiveCode === 'FT' || normalizedCode === 'U' ? 'Keine' : pause;
    const effectiveMittag = effectiveCode === 'FT' || normalizedCode === 'U' ? 'Nein' : mittag;

    const planInfo = await getPlanHoursForDay(input.employeeId, isoDate);
    const validation = validateTimeEntry({
      kommt1: effectiveKommt1,
      geht1: effectiveGeht1,
      kommt2: effectiveKommt2,
      geht2: effectiveGeht2,
      pause: effectivePause,
      code: effectiveCode,
      mittag: effectiveMittag,
      planInfo,
      mandatoryPauseMinWorkMinutes: validationProfile.mandatoryPauseMinWorkMinutes,
      minPauseUnder6Minutes: validationProfile.minPauseUnder6Minutes,
      requiresMealFlag: (validationProfile.sachbezugVerpflegung ?? 'Nein').toLowerCase() === 'ja',
    });

    if (validation.errors.length) {
      const dateLabel = new Date(`${isoDate}T00:00:00`).toLocaleDateString('de-DE');
      return { status: 'error', message: `${dateLabel}: ${validation.errors[0]}` };
    }

    if (validation.warnings.length && !warnings.length) {
      warnings.push(validation.warnings[0]);
    }

    await saveTimeEntry({
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      dayDate: isoDate,
      brutto,
      kommt1: effectiveKommt1,
      geht1: effectiveGeht1,
      kommt2: effectiveKommt2,
      geht2: effectiveGeht2,
      pause: effectivePause,
      code: effectiveCode || 'RA',
      bemerkungen,
      mittag: effectiveMittag,
      performedBy: input.performedBy,
    });
  }

  const startLabel = new Date(`${rangeStart}T00:00:00`).toLocaleDateString('de-DE');
  const endLabel = new Date(`${rangeEnd}T00:00:00`).toLocaleDateString('de-DE');
  const messageBase =
    rangeStart === rangeEnd
      ? `Eintrag am ${startLabel} wurde gespeichert.`
      : `Zeitraum ${startLabel} – ${endLabel} wurde gespeichert.`;

  return {
    status: 'success',
    message: `${messageBase}${holidayCount ? ` ${holidayCount} ${holidayCount === 1 ? 'Tag wurde' : 'Tage wurden'} automatisch als Feiertag (FT) erfasst.` : ''}${warnings.length ? ` Hinweis: ${warnings[0]}` : ''}`,
  };
}

export async function deleteAdminTimeEntry(
  input: DeleteAdminTimeEntryInput
): Promise<{ status: 'success' | 'error'; message: string }> {
  if (!(await employeeExists(input.tenantId, input.employeeId))) {
    return { status: 'error', message: 'Mitarbeiter wurde nicht gefunden.' };
  }

  const dayDate = input.dayDateRaw.trim();
  if (!dayDate) {
    return { status: 'error', message: 'Datum konnte nicht gelesen werden.' };
  }

  const extracted = extractYearMonth(dayDate);
  if (!extracted) {
    return { status: 'error', message: 'Ungültiges Datum.' };
  }

  if (await isMonthClosedForEmployee(input.employeeId, extracted.year, extracted.month)) {
    return {
      status: 'error',
      message: `Der Monat ${formatMonthLabel(extracted.year, extracted.month)} ist abgeschlossen und kann nicht bearbeitet werden.`,
    };
  }

  await deleteTimeEntry(input.tenantId, input.employeeId, dayDate);

  return {
    status: 'success',
    message: `Tag ${new Date(`${dayDate}T00:00:00`).toLocaleDateString('de-DE')} wurde gelöscht.`,
  };
}

export async function deleteTimeEntry(tenantId: string, employeeId: number, dayDate: string): Promise<void> {
  await deleteDailyDayByDate(employeeId, dayDate);
  await recomputeEmployeeOvertime(tenantId, employeeId);
}

export async function listTimeEntries(employeeId: number): Promise<DailyDaySummary[]> {
  return listDailyDays(employeeId);
}
