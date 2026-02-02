import {
  deleteDailyDayByDate,
  getDailyDay,
  listDailyDayRecords,
  listDailyDays,
  clearAdminChangeMeta,
  updateAdminChangeMeta,
  upsertDailyDay,
  type DailyDayRecord,
  type UpsertDailyDayInput,
} from '@/lib/data/daily-days';
import {
  getEmployeeOvertimeSettings,
  updateEmployeeOvertimeBalance,
  getEmployeeValidationInfo,
} from '@/lib/data/employees';
import { recalculateOvertime } from '@/lib/services/overtime';
import {
  deriveCodeFromPlanLabel,
  getPlanHoursForDay,
  getPlanHoursForDayFromPlan,
  getShiftPlan,
} from '@/lib/services/shift-plan';
import { calculateIstHours, calculateLegalPauseHours } from '@/lib/services/time-calculations';

const MEAL_BLOCKED_CODES = new Set(['U', 'UH', 'UBF', 'K', 'KK', 'KR', 'KKR', 'KU', 'FT']);

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

function mapRecordToOvertimeInput(record: DailyDayRecord) {
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

export async function recomputeEmployeeOvertime(tenantId: string, employeeId: number): Promise<void> {
  const records = await listDailyDayRecords(employeeId);
  if (!records.length) {
    await updateEmployeeOvertimeBalance(tenantId, employeeId, 0);
    return;
  }

  const overtimeInputs = records.map(mapRecordToOvertimeInput);
  const overtimeSettings = await getEmployeeOvertimeSettings(tenantId, employeeId);
  const shiftPlan = await getShiftPlan(employeeId);

  const recordDates = new Set(records.map((record) => record.day_date));
  for (const [isoDate, planDay] of Object.entries(shiftPlan.days)) {
    if (!planDay || recordDates.has(isoDate)) {
      continue;
    }
    const syntheticCode = deriveCodeFromPlanLabel(planDay.label);
    if (!syntheticCode) {
      continue;
    }
    const planInfo = getPlanHoursForDayFromPlan(shiftPlan, isoDate, planDay.label ?? '')
      ?? getPlanHoursForDay(employeeId, isoDate, planDay.label ?? '');
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

  const recordByDate = new Map(records.map((record) => [record.day_date, record]));
  for (const updated of result.updatedDays) {
    const baseRecord = recordByDate.get(updated.dayDate);
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

  const planInfo = getPlanHoursForDay(input.employeeId, input.dayDate, input.schicht ?? '');
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

  let planHours = 0;
  let storedRequiredPauseMinutes = 0;

  if (planInfo) {
    const baseRequiredPauseMinutes = Math.max(planInfo.requiredPauseMinutes ?? 0, 0);
    const legalPauseMinutes = calculateLegalPauseHours(planInfo.rawHours) * 60;
    const mandatoryPauseSetting = Math.max(minPauseUnder6Setting, 0);

    let enforcedPauseMinutes = Math.max(baseRequiredPauseMinutes, legalPauseMinutes);
    if (legalPauseMinutes >= 30 && mandatoryPauseSetting > enforcedPauseMinutes) {
      enforcedPauseMinutes = mandatoryPauseSetting;
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

  if (MEAL_BLOCKED_CODES.has(codeNormalized)) {
    mittag = 'Nein';
  }

  const payload: UpsertDailyDayInput = {
    employeeId: input.employeeId,
    dayDate: input.dayDate,
    brutto: input.brutto ?? null,
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

export async function deleteTimeEntry(tenantId: string, employeeId: number, dayDate: string): Promise<void> {
  await deleteDailyDayByDate(employeeId, dayDate);
  await recomputeEmployeeOvertime(tenantId, employeeId);
}

export async function listTimeEntries(employeeId: number): Promise<DailyDaySummary[]> {
  return listDailyDays(employeeId);
}
