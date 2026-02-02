import {
  getShiftPlanDayRecord,
  listShiftPlanDays,
  listShiftPlanDaysForEmployees,
  upsertShiftPlanDays,
  deleteShiftPlanDays,
  deleteShiftPlanDay,
} from '@/lib/data/shift-plan-days';
import { getDailyDay } from '@/lib/data/daily-days';
import { getShiftPlanRow, SHIFT_PLAN_DAY_KEYS } from '@/lib/data/shift-plans';
import {
  listShiftPlanTemplatesWithDays,
  listShiftPlanTemplatesWithDaysForEmployee,
  type ShiftPlanTemplateDayRecord,
} from '@/lib/data/shift-plan-templates';
import { calculateLegalPauseHours, parseTimeString } from '@/lib/services/time-calculations';
import { saveTimeEntry, deleteTimeEntry } from '@/lib/services/time-entry';
import { listBranchesForEmployee, type BranchSummary } from '@/lib/data/branches';
import { isHolidayIsoDate, normalizeHolidayRegion } from '@/lib/services/holidays';

export type ShiftPlanDay = {
  start: string | null;
  end: string | null;
  requiredPauseMinutes: number;
  label: string | null;
  branchId?: number | null;
  branchName?: string | null;
};

export type ShiftPlan = {
  employeeId: number;
  days: Record<string, ShiftPlanDay>;
};

export type PlanHoursInfo = {
  rawHours: number;
  sollHours: number;
  requiredPauseMinutes: number;
  start: string | null;
  end: string | null;
};

export type EditableShiftPlanDay = {
  isoDate: string;
  weekdayLabel: string;
  isPast: boolean;
  start: string;
  end: string;
  requiredPauseMinutes: number;
  label: string;
};

export type EditableShiftPlan = {
  employeeId: number;
  monthKey: string;
  days: EditableShiftPlanDay[];
};

export type SaveShiftPlanMonthInput = {
  monthKey: string;
  days: Array<{
    isoDate: string;
    start: string | null;
    end: string | null;
    requiredPauseMinutes: number | null | undefined;
  }>;
};

type ShiftPlanDaySegmentInput = {
  segmentIndex?: number | null;
  mode?: 'available' | 'unavailable' | null;
  start?: string | null;
  end?: string | null;
  requiredPauseMinutes?: number | null | undefined;
  label?: string | null;
  branchId?: number | null;
};

const WEEKDAY_LABELS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const NO_WORK_LABEL = 'Kein Arbeitstag';
const NO_WORK_LABEL_LOWER = NO_WORK_LABEL.toLowerCase();
const isNoWorkLabel = (label: string | null | undefined): boolean =>
  (label ?? '').trim().toLowerCase() === NO_WORK_LABEL_LOWER;

const PLAN_LABEL_CODE_MAP: Array<{ keyword: string; code: string }> = [
  { keyword: 'feiertag', code: 'FT' },
  { keyword: 'urlaub', code: 'U' },
  { keyword: 'krank', code: 'K' },
  { keyword: 'kurzarbeit', code: 'KU' },
  { keyword: 'überstunden', code: 'Ü' },
  { keyword: 'ueberstunden', code: 'Ü' },
  { keyword: 'abbau', code: 'Ü' },
];

export function deriveCodeFromPlanLabel(label: string | null | undefined): string | null {
  const normalized = (label ?? '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  for (const entry of PLAN_LABEL_CODE_MAP) {
    if (normalized.includes(entry.keyword)) {
      return entry.code;
    }
  }
  return null;
}

async function syncPlanAbsenceWithDailyDay(
  tenantId: string,
  employeeId: number,
  isoDate: string,
  label: string | null,
  holidayRegion?: string | null,
) {
  let derivedCode = deriveCodeFromPlanLabel(label);
  const existing = await getDailyDay(employeeId, isoDate);

  if (derivedCode === 'U' && holidayRegion) {
    const holidayInfo = isHolidayIsoDate(isoDate, holidayRegion);
    if (holidayInfo.isHoliday) {
      derivedCode = 'FT';
    }
  }

  if (!derivedCode) {
    if (existing && (existing.admin_last_change_by ?? '') === 'Schichtplan') {
      await deleteTimeEntry(tenantId, employeeId, isoDate);
    }
    return;
  }

  if (existing && (existing.admin_last_change_by ?? '') !== 'Schichtplan') {
    return;
  }

  try {
    const payload = {
      employeeId,
      dayDate: isoDate,
      code: derivedCode,
      schicht: label ?? '',
      kommt1: '00:00',
      geht1: '00:00',
      kommt2: null,
      geht2: null,
      pause: 'Keine',
      mittag: 'Nein',
      performedBy: { type: 'admin' as const, id: null, name: 'Schichtplan' },
    };
    await saveTimeEntry({ ...payload, tenantId });
  } catch (error) {
    console.error('Failed to synchronise shift plan entry', { employeeId, isoDate, label, error });
  }
}

function sanitizeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    return trimmed.padStart(5, '0');
  }
  return trimmed;
}

function buildPlanHours(start: string | null, end: string | null, requiredPauseMinutes: number): PlanHoursInfo | null {
  const startTime = parseTimeString(start ?? undefined);
  const endTime = parseTimeString(end ?? undefined);

  if (!startTime || !endTime) {
    return {
      rawHours: 0,
      sollHours: 0,
      requiredPauseMinutes,
      start,
      end,
    };
  }

  const raw = Math.max(
    0,
    (endTime.hour + endTime.minute / 60) - (startTime.hour + startTime.minute / 60)
  );

  if (raw <= 0.01) {
    return {
      rawHours: 0,
      sollHours: 0,
      requiredPauseMinutes,
      start,
      end,
    };
  }

  const legalPause = calculateLegalPauseHours(raw);
  const requiredPauseHours = (requiredPauseMinutes ?? 0) / 60;
  const soll = Math.max(raw - Math.max(legalPause, requiredPauseHours), 0);

  return {
    rawHours: Number(raw.toFixed(2)),
    sollHours: Number(soll.toFixed(2)),
    requiredPauseMinutes,
    start,
    end,
  };
}

function weeklyFallback(employeeId: number, isoDate: string, schicht: string | null | undefined): PlanHoursInfo | null {
  const row = getShiftPlanRow(employeeId);
  if (!row) {
    return null;
  }
  const entry = getWeeklyFallbackDay(row, isoDate, schicht);
  if (!entry) {
    return null;
  }
  return buildPlanHours(entry.start, entry.end, entry.requiredPauseMinutes);
}

function getWeeklyFallbackDay(
  row: ReturnType<typeof getShiftPlanRow>,
  isoDate: string,
  schicht: string | null | undefined
): ShiftPlanDay | null {
  if (!row) return null;

  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;

  const weekDayIndex = (date.getDay() + 6) % 7; // Monday = 0
  const dayKey = SHIFT_PLAN_DAY_KEYS[weekDayIndex];

  const getEntry = (prefix: 'w1' | 'w2'): ShiftPlanDay => {
    const startKey = `${prefix}_${dayKey}_start` as keyof typeof row;
    const endKey = `${prefix}_${dayKey}_end` as keyof typeof row;
    const pauseKey = `${prefix}_${dayKey}_req_pause_min` as keyof typeof row;
    return {
      start: sanitizeTime(row?.[startKey] as string | null | undefined),
      end: sanitizeTime(row?.[endKey] as string | null | undefined),
      requiredPauseMinutes: Number(row?.[pauseKey] ?? 0) || 0,
      label: null,
    };
  };

  const twoWeek = (row.two_week_cycle ?? '').toLowerCase() === 'yes';
  if (!twoWeek) {
    return getEntry('w1');
  }
  const normalizedSchicht = (schicht ?? '').trim().toLowerCase();
  return normalizedSchicht === 'spät' ? getEntry('w2') : getEntry('w1');
}

export async function getShiftPlan(employeeId: number, options?: { from?: string; to?: string }): Promise<ShiftPlan> {
  const records = await listShiftPlanDays(employeeId, options?.from, options?.to);
  const days: Record<string, ShiftPlanDay> = {};
  for (const record of records) {
    days[record.day_date] = {
      start: sanitizeTime(record.start_time),
      end: sanitizeTime(record.end_time),
      requiredPauseMinutes: record.required_pause_minutes ?? 0,
      label: record.label?.trim() || null,
      branchId: record.branch_id ?? null,
      branchName: record.branch_name ?? null,
    };
  }
  return {
    employeeId,
    days,
  };
}

export async function getPlanHoursForDay(
  employeeId: number,
  isoDate: string,
  schicht: string | null | undefined = null
): Promise<PlanHoursInfo | null> {
  const record = await getShiftPlanDayRecord(employeeId, isoDate);
  if (record) {
    return buildPlanHours(
      sanitizeTime(record.start_time),
      sanitizeTime(record.end_time),
      record.required_pause_minutes ?? 0
    );
  }
  return weeklyFallback(employeeId, isoDate, schicht);
}

export function getPlanHoursForDayFromPlan(
  plan: ShiftPlan,
  isoDate: string,
  schicht: string | null | undefined = null
): PlanHoursInfo | null {
  const entry = plan.days[isoDate];
  if (entry) {
    return buildPlanHours(entry.start, entry.end, entry.requiredPauseMinutes);
  }
  const hasDailyEntries = Object.keys(plan.days).length > 0;
  if (!hasDailyEntries) {
    return weeklyFallback(plan.employeeId, isoDate, schicht);
  }
  return null;
}

function getMonthKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function parseMonthKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}$/.test(trimmed)) {
    return null;
  }
  const year = Number.parseInt(trimmed.slice(0, 4), 10);
  const month = Number.parseInt(trimmed.slice(5, 7), 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function daysOfMonth(monthKey: string): string[] {
  const year = Number.parseInt(monthKey.slice(0, 4), 10);
  const month = Number.parseInt(monthKey.slice(5, 7), 10);
  const days: string[] = [];
  const totalDays = new Date(year, month, 0).getDate();
  for (let day = 1; day <= totalDays; day += 1) {
    days.push(`${monthKey}-${String(day).padStart(2, '0')}`);
  }
  return days;
}

export async function getEditableShiftPlan(employeeId: number, monthKey?: string): Promise<EditableShiftPlan> {
  const now = new Date();
  const resolvedMonthKey = parseMonthKey(monthKey) ?? getMonthKey(now);
  const daysInMonth = daysOfMonth(resolvedMonthKey);
  const monthStart = `${resolvedMonthKey}-01`;
  const monthEnd = `${resolvedMonthKey}-${String(daysInMonth.length).padStart(2, '0')}`;
  const existing = await listShiftPlanDays(employeeId, monthStart, monthEnd);
  const recordMap = new Map<
    string,
    {
      start: string | null;
      end: string | null;
      required_pause_minutes: number;
      label: string | null;
    }
  >();
  for (const record of existing) {
    recordMap.set(record.day_date, {
      start: sanitizeTime(record.start_time),
      end: sanitizeTime(record.end_time),
      required_pause_minutes: record.required_pause_minutes ?? 0,
      label: record.label?.trim() || null,
    });
  }

  const todayIso = getMonthKey(now) === resolvedMonthKey ? `${resolvedMonthKey}-${String(now.getDate()).padStart(2, '0')}` : null;

  const days: EditableShiftPlanDay[] = daysInMonth.map((iso) => {
    const date = new Date(`${iso}T00:00:00`);
    const weekdayLabel = Number.isNaN(date.getTime()) ? '' : WEEKDAY_LABELS[date.getDay()] ?? '';
    const existingEntry = recordMap.get(iso);
    return {
      isoDate: iso,
      weekdayLabel,
      isPast: todayIso ? iso < todayIso : false,
      start: existingEntry?.start ?? '',
      end: existingEntry?.end ?? '',
      requiredPauseMinutes: existingEntry?.required_pause_minutes ?? 0,
      label: existingEntry?.label ?? '',
    };
  });

  return {
    employeeId,
    monthKey: resolvedMonthKey,
    days,
  };
}

export async function saveShiftPlanMonth(employeeId: number, input: SaveShiftPlanMonthInput): Promise<void> {
  const monthKey = parseMonthKey(input.monthKey);
  if (!monthKey) {
    throw new Error('Ungültiger Monatswert');
  }
  const daysInMonth = daysOfMonth(monthKey);
  const monthStart = `${monthKey}-01`;
  const monthEnd = `${monthKey}-${String(daysInMonth.length).padStart(2, '0')}`;

  await deleteShiftPlanDays(employeeId, monthStart, monthEnd);

  const entries = input.days
    .map((day) => ({
      dayDate: day.isoDate,
      startTime: sanitizeTime(day.start),
      endTime: sanitizeTime(day.end),
      requiredPauseMinutes: day.requiredPauseMinutes ?? 0,
    }))
    .filter((entry) => entry.startTime || entry.endTime || (entry.requiredPauseMinutes ?? 0) > 0);

  if (entries.length) {
    await upsertShiftPlanDays(employeeId, entries);
  }
}

export async function saveShiftPlanDaySegments(
  tenantId: string,
  employeeId: number,
  input: {
    isoDate: string;
    segments: ShiftPlanDaySegmentInput[];
  }
): Promise<void> {
  const isoDate = (input.isoDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error('Ungültiges Datum');
  }

  const segments = Array.isArray(input.segments) ? input.segments : [];
  const availableBranches = await listBranchesForEmployee(tenantId, employeeId);
  const fallbackBranchId = availableBranches.length === 1 ? availableBranches[0].id : null;

  const normalizedSegments = segments
    .map((segment, index) => {
      const labelRaw = segment.label?.trim() ?? '';
      const mode: 'available' | 'unavailable' = segment.mode === 'unavailable' ? 'unavailable' : 'available';
      const noWorkDay = mode === 'unavailable' && isNoWorkLabel(labelRaw);
      const start = noWorkDay ? null : sanitizeTime(segment.start ?? null);
      const end = noWorkDay ? null : sanitizeTime(segment.end ?? null);
      const pauseNumeric = Number(segment.requiredPauseMinutes ?? 0);
      const pauseValue = Number.isFinite(pauseNumeric) ? Math.max(0, Math.round(pauseNumeric)) : 0;
      const requiredPauseMinutes = noWorkDay ? 0 : pauseValue;
      const label = labelRaw.length ? labelRaw : null;

      let branchId: number | null = null;
      if (segment.branchId !== undefined && segment.branchId !== null) {
        const parsed = Number(segment.branchId);
        if (Number.isFinite(parsed) && parsed > 0) {
          if (availableBranches.some((branch) => branch.id === Number(parsed))) {
            branchId = Number(parsed);
          } else {
            branchId = fallbackBranchId;
          }
        }
      } else if (fallbackBranchId) {
        branchId = fallbackBranchId;
      }

      if (noWorkDay) {
        branchId = null;
      }

      const segmentIndex = Math.max(0, Math.floor(Number(segment.segmentIndex ?? index) || 0));
      const hasContent = Boolean((start && end) || label || requiredPauseMinutes > 0);

      return {
        hasContent,
        entry: {
          dayDate: isoDate,
          segmentIndex,
          mode,
          startTime: start,
          endTime: end,
          requiredPauseMinutes,
          label,
          branchId,
        },
      };
    })
    .filter((segment) => segment.hasContent);

  const branchContext = (() => {
    const branchId =
      normalizedSegments.find((segment) => segment.entry.branchId)?.entry.branchId ?? fallbackBranchId ?? null;
    if (!branchId) return null;
    return availableBranches.find((branch) => branch.id === branchId) ?? null;
  })();
  const holidayRegion = normalizeHolidayRegion(branchContext?.federalState ?? branchContext?.country ?? null);
  const absenceLabel =
    normalizedSegments.find((segment) => segment.entry.mode === 'unavailable' && segment.entry.label)?.entry.label ??
    normalizedSegments.find((segment) => segment.entry.label)?.entry.label ??
    null;

  if (!normalizedSegments.length) {
    await deleteShiftPlanDay(employeeId, isoDate);
    await syncPlanAbsenceWithDailyDay(tenantId, employeeId, isoDate, null, holidayRegion);
    return;
  }

  await deleteShiftPlanDay(employeeId, isoDate);
  await upsertShiftPlanDays(
    employeeId,
    normalizedSegments.map((segment) => segment.entry)
  );
  await syncPlanAbsenceWithDailyDay(tenantId, employeeId, isoDate, absenceLabel, holidayRegion);
}

export async function saveShiftPlanDay(
  tenantId: string,
  employeeId: number,
  input: {
    isoDate: string;
    start?: string | null;
    end?: string | null;
    requiredPauseMinutes?: number | null | undefined;
    label?: string | null;
    branchId?: number | null;
    segmentIndex?: number | null;
    mode?: 'available' | 'unavailable' | null;
  }
): Promise<void> {
  await saveShiftPlanDaySegments(tenantId, employeeId, {
    isoDate: input.isoDate,
    segments: [
      {
        segmentIndex: input.segmentIndex ?? 0,
        mode: input.mode ?? 'available',
        start: input.start ?? null,
        end: input.end ?? null,
        requiredPauseMinutes: input.requiredPauseMinutes ?? 0,
        label: input.label ?? null,
        branchId: input.branchId ?? null,
      },
    ],
  });
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function clearShiftPlanRange(employeeId: number, fromIso: string, toIso: string): Promise<void> {
  const start = (fromIso ?? '').trim();
  const end = (toIso ?? '').trim();
  if (!ISO_DATE_PATTERN.test(start) || !ISO_DATE_PATTERN.test(end)) {
    throw new Error('Ungültiger Zeitraum');
  }
  if (end < start) {
    throw new Error('Ungültiger Zeitraum');
  }
  await deleteShiftPlanDays(employeeId, start, end);
}

type WeekMeta = {
  weekStart: string;
  weekEnd: string;
  weekNumber: number;
  days: Array<{
    isoDate: string;
    weekdayShort: string;
    dayLabel: string;
    isToday: boolean;
  }>;
};

function getIsoWeekNumber(date: Date): number {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function resolveWeekMeta(raw?: string | null): WeekMeta {
  const today = new Date();
  const initial = (() => {
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return new Date(today.getFullYear(), today.getMonth(), today.getDate());
    }
    const parsed = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      return new Date(today.getFullYear(), today.getMonth(), today.getDate());
    }
    return parsed;
  })();

  const weekStartDate = new Date(initial);
  const weekdayIndex = (weekStartDate.getDay() + 6) % 7; // Monday = 0
  weekStartDate.setDate(weekStartDate.getDate() - weekdayIndex);
  weekStartDate.setHours(0, 0, 0, 0);

  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setDate(weekEndDate.getDate() + 6);

  const formatter = new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });

  const days: WeekMeta['days'] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const current = new Date(weekStartDate);
    current.setDate(weekStartDate.getDate() + offset);
    const isoDate = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
    const formatted = formatter.format(current);
    const [weekdayShort, rest] = formatted.split(',', 2);
    days.push({
      isoDate,
      weekdayShort: (weekdayShort ?? '').replace('.', ''),
      dayLabel: rest ? rest.trim() : formatted,
      isToday:
        current.getFullYear() === today.getFullYear() &&
        current.getMonth() === today.getMonth() &&
        current.getDate() === today.getDate(),
    });
  }

  return {
    weekStart: days[0]?.isoDate ?? '',
    weekEnd: days[6]?.isoDate ?? '',
    weekNumber: getIsoWeekNumber(weekStartDate),
    days,
  };
}

export type WeeklyShiftPlanCell = {
  isoDate: string;
  start: string | null;
  end: string | null;
  requiredPauseMinutes: number;
  label: string | null;
  segments: Array<{
    segmentIndex: number;
    mode: 'available' | 'unavailable';
    start: string | null;
    end: string | null;
    requiredPauseMinutes: number;
    label: string | null;
    branchId: number | null;
    branchName: string | null;
  }>;
  source: 'daily' | 'fallback' | 'empty';
  branchId: number | null;
  branchName: string | null;
};

export type WeeklyShiftPlanRow = {
  employeeId: number;
  displayName: string;
  username: string;
  cells: WeeklyShiftPlanCell[];
  branches: BranchSummary[];
};

export type WeeklyShiftPlan = WeekMeta & {
  rows: WeeklyShiftPlanRow[];
};

export type WeeklyShiftTemplateSegment = {
  mode: 'available' | 'unavailable';
  start: string | null;
  end: string | null;
  requiredPauseMinutes: number;
  label: string | null;
};

export type WeeklyShiftTemplate = {
  id: number;
  name: string;
  days: Array<{
    weekday: number;
    segments: WeeklyShiftTemplateSegment[];
  }>;
};

export function listWeeklyShiftTemplates(): WeeklyShiftTemplate[] {
  const records = listShiftPlanTemplatesWithDays();
  return records.map(({ template, days }) => {
    const dayMap = new Map<number, WeeklyShiftTemplateSegment[]>();
    for (const day of days) {
      const segments = dayMap.get(day.weekday) ?? [];
      const mode = day.mode === 'unavailable' ? 'unavailable' : 'available';
      const label = day.label?.trim() || null;
      const keepTimes = mode === 'available';
      const start = keepTimes ? sanitizeTime(day.start_time) : null;
      const end = keepTimes ? sanitizeTime(day.end_time) : null;
      const requiredPauseMinutes = keepTimes ? Number(day.required_pause_minutes ?? 0) || 0 : 0;
      segments.push({
        mode,
        start,
        end,
        requiredPauseMinutes,
        label,
      });
      dayMap.set(day.weekday, segments);
    }

    const dayEntries: WeeklyShiftTemplate['days'] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const segments = dayMap.get(weekday) ?? [];
      dayEntries.push({
        weekday,
        segments,
      });
    }

    return {
      id: template.id,
      name: template.name,
      days: dayEntries,
    };
  });
}

export function listWeeklyShiftTemplatesForEmployee(employeeId: number): WeeklyShiftTemplate[] {
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    return [];
  }
  const records = listShiftPlanTemplatesWithDaysForEmployee(employeeId);
  const isLegacyEmptyAbsence = (record: ShiftPlanTemplateDayRecord): boolean => {
    const label = (record.label ?? '').trim().toLowerCase();
    if (record.mode !== 'unavailable' || label !== 'abwesend') {
      return false;
    }
    const pause = Number(record.required_pause_minutes ?? 0) || 0;
    return !record.start_time && !record.end_time && pause <= 0;
  };
  return records.map(({ template, days }) => {
    const dayMap = new Map<number, WeeklyShiftTemplateSegment[]>();
    for (const day of days) {
      if (isLegacyEmptyAbsence(day)) {
        continue;
      }
      const segments = dayMap.get(day.weekday) ?? [];
      const mode = day.mode === 'unavailable' ? 'unavailable' : 'available';
      const label = day.label?.trim() || null;
      const keepTimes = mode === 'available';
      const start = keepTimes ? sanitizeTime(day.start_time) : null;
      const end = keepTimes ? sanitizeTime(day.end_time) : null;
      const requiredPauseMinutes = keepTimes ? Number(day.required_pause_minutes ?? 0) || 0 : 0;
      segments.push({
        mode,
        start,
        end,
        requiredPauseMinutes,
        label,
      });
      dayMap.set(day.weekday, segments);
    }

    const dayEntries: WeeklyShiftTemplate['days'] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const segments = dayMap.get(weekday) ?? [];
      dayEntries.push({
        weekday,
        segments,
      });
    }

    return {
      id: template.id,
      name: template.name,
      days: dayEntries,
    };
  });
}

type RawShiftDayEntry = {
  segmentIndex: number;
  mode: 'available' | 'unavailable';
  start: string | null;
  end: string | null;
  requiredPauseMinutes: number;
  label: string | null;
  branchId: number | null;
  branchName: string | null;
};

export async function getWeeklyShiftPlan(
  employees: Array<{ id: number; displayName: string; username: string; branches?: BranchSummary[] }>,
  options?: { week?: string | null }
): Promise<WeeklyShiftPlan> {
  const meta = resolveWeekMeta(options?.week ?? null);
  const employeeIds = employees.map((employee) => employee.id);
  const records = await listShiftPlanDaysForEmployees(employeeIds, meta.weekStart, meta.weekEnd);
  const recordMap = new Map<number, Map<string, RawShiftDayEntry[]>>();

  for (const record of records) {
    if (!recordMap.has(record.employee_id)) {
      recordMap.set(record.employee_id, new Map());
    }
    const perEmployee = recordMap.get(record.employee_id)!;
    const entries = perEmployee.get(record.day_date) ?? [];
    entries.push({
      segmentIndex: record.segment_index ?? 0,
      mode: record.mode === 'unavailable' ? 'unavailable' : 'available',
      start: sanitizeTime(record.start_time),
      end: sanitizeTime(record.end_time),
      requiredPauseMinutes: record.required_pause_minutes ?? 0,
      label: record.label?.trim() || null,
      branchId: record.branch_id ?? null,
      branchName: record.branch_name ?? null,
    });
    perEmployee.set(record.day_date, entries);
  }

  const rows: WeeklyShiftPlanRow[] = employees.map((employee) => {
    const perEmployee = recordMap.get(employee.id);
    const cells: WeeklyShiftPlanCell[] = meta.days.map((day) => {
      const entries = perEmployee?.get(day.isoDate) ?? [];
      entries.sort((a, b) => a.segmentIndex - b.segmentIndex);
      const firstEntry = entries[0];
      if (entries.length) {
        return {
          isoDate: day.isoDate,
          start: firstEntry?.start ?? null,
          end: firstEntry?.end ?? null,
          requiredPauseMinutes: firstEntry?.requiredPauseMinutes ?? 0,
          label: firstEntry?.label ?? null,
          segments: entries.map((entry) => ({
            segmentIndex: entry.segmentIndex,
            mode: entry.mode,
            start: entry.start ?? null,
            end: entry.end ?? null,
            requiredPauseMinutes: entry.requiredPauseMinutes ?? 0,
            label: entry.label ?? null,
            branchId: entry.branchId ?? null,
            branchName: entry.branchName ?? null,
          })),
          source: 'daily',
          branchId: firstEntry?.branchId ?? null,
          branchName: firstEntry?.branchName ?? null,
        };
      }
      return {
        isoDate: day.isoDate,
        start: null,
        end: null,
        requiredPauseMinutes: 0,
        label: null,
        segments: [],
        source: 'empty',
        branchId: null,
        branchName: null,
      };
    });

    return {
      employeeId: employee.id,
      displayName: employee.displayName,
      username: employee.username,
      cells,
      branches: employee.branches ?? [],
    };
  });

  return {
    ...meta,
    rows,
  };
}
