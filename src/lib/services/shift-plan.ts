import {
  listShiftPlanDays,
  listShiftPlanDaysForEmployees,
  upsertShiftPlanDays,
  deleteShiftPlanDays,
  deleteShiftPlanDay,
  deleteShiftPlanDaysAfter as deleteShiftPlanDaysAfterData,
} from '@/lib/data/shift-plan-days';
import { listLeaveRequestsForEmployeesInDateRange } from '@/lib/data/leave-requests';
import { getPrisma } from '@/lib/prisma';
import { listShiftPlanRowsPg } from '@/lib/data/shift-plans';
import {
  listShiftPlanTemplatesWithDays,
  listShiftPlanTemplatesWithDaysForEmployee,
  type ShiftPlanTemplateDayRecord,
} from '@/lib/data/shift-plan-templates';
import {
  buildPlanHours,
  deriveCodeFromPlanLabel,
  getWeeklyFallbackDayFromRow,
  getWeeklyFallbackPlanHoursForDay as resolveWeeklyFallbackPlanHours,
} from '@/lib/services/shift-plan-hours';
import { syncShiftPlanAbsenceWithDailyDay } from '@/lib/services/shift-plan-daily-sync';
import { listBranchesForEmployee, type BranchSummary } from '@/lib/data/branches';
import { normalizeHolidayRegion } from '@/lib/services/holidays';
export {
  deriveCodeFromPlanLabel,
  getPlanHoursForDay,
  getWeeklyFallbackPlanHoursForDay,
  getPlanHoursForDayFromPlan,
} from '@/lib/services/shift-plan-hours';
export type { PlanHoursInfo } from '@/lib/services/shift-plan-hours';

export { getShiftPlan } from '@/lib/services/shift-plan-read';
export type { ShiftPlan, ShiftPlanDay } from '@/lib/services/shift-plan-read';

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
const isTimedAbsenceLabel = (label: string | null | undefined): boolean => {
  const normalized = (label ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return normalized.includes('urlaub') || normalized.includes('krank');
};

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

function sanitizeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    return trimmed.padStart(5, '0');
  }
  return trimmed;
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

async function getEmployeeExitDateById(employeeId: number): Promise<string | null> {
  const prisma = getPrisma();
  const row = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { exitDate: true },
  });
  return row?.exitDate ?? null;
}

async function getEmployeeExitDateByTenant(tenantId: string, employeeId: number): Promise<string | null> {
  const prisma = getPrisma();
  const row = await prisma.employee.findFirst({
    where: { id: employeeId, tenantId },
    select: { exitDate: true },
  });
  return row?.exitDate ?? null;
}

function ensureShiftPlanDateAllowed(isoDate: string, exitDate: string | null): void {
  if (exitDate && isoDate > exitDate) {
    throw new Error(`Nach dem Austrittsdatum (${exitDate}) können keine Schichtzeiten mehr erfasst werden.`);
  }
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
  const exitDate = await getEmployeeExitDateById(employeeId);

  await deleteShiftPlanDays(employeeId, monthStart, monthEnd);

  const entries = input.days
    .map((day) => ({
      dayDate: day.isoDate,
      startTime: sanitizeTime(day.start),
      endTime: sanitizeTime(day.end),
      requiredPauseMinutes: day.requiredPauseMinutes ?? 0,
    }))
    .filter((entry) => entry.startTime || entry.endTime || (entry.requiredPauseMinutes ?? 0) > 0);

  for (const entry of entries) {
    ensureShiftPlanDateAllowed(entry.dayDate, exitDate);
  }

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

  const exitDate = await getEmployeeExitDateByTenant(tenantId, employeeId);
  ensureShiftPlanDateAllowed(isoDate, exitDate);

  const segments = Array.isArray(input.segments) ? input.segments : [];
  const availableBranches = await listBranchesForEmployee(tenantId, employeeId);
  const fallbackBranchId = availableBranches.length === 1 ? availableBranches[0].id : null;
  const fallbackAbsencePlan = await resolveWeeklyFallbackPlanHours(employeeId, isoDate, null);
  const existingDaySegments = await listShiftPlanDays(employeeId, isoDate, isoDate);
  const existingAvailableSegments = existingDaySegments
    .filter((segment) => segment.mode !== 'unavailable' && segment.start_time && segment.end_time)
    .sort((a, b) => (a.segment_index ?? 0) - (b.segment_index ?? 0));
  const existingDayFallback =
    existingAvailableSegments.length > 0
      ? {
          start: sanitizeTime(existingAvailableSegments[0]?.start_time),
          end: sanitizeTime(existingAvailableSegments[existingAvailableSegments.length - 1]?.end_time),
          requiredPauseMinutes: Number(existingAvailableSegments[0]?.required_pause_minutes ?? 0) || 0,
        }
      : null;

  const normalizedSegments = segments
    .map((segment, index) => {
      const labelRaw = segment.label?.trim() ?? '';
      const mode: 'available' | 'unavailable' = segment.mode === 'unavailable' ? 'unavailable' : 'available';
      const noWorkDay = mode === 'unavailable' && isNoWorkLabel(labelRaw);
      let start = noWorkDay ? null : sanitizeTime(segment.start ?? null);
      let end = noWorkDay ? null : sanitizeTime(segment.end ?? null);
      const pauseNumeric = Number(segment.requiredPauseMinutes ?? 0);
      const pauseValue = Number.isFinite(pauseNumeric) ? Math.max(0, Math.round(pauseNumeric)) : 0;
      let requiredPauseMinutes = noWorkDay ? 0 : pauseValue;
      const label = labelRaw.length ? labelRaw : null;

      if (
        mode === 'unavailable' &&
        !noWorkDay &&
        (!start || !end) &&
        isTimedAbsenceLabel(labelRaw) &&
        (
          (existingDayFallback?.start && existingDayFallback?.end) ||
          (
            fallbackAbsencePlan?.rawHours &&
            fallbackAbsencePlan.rawHours > 0.001 &&
            fallbackAbsencePlan.start &&
            fallbackAbsencePlan.end
          )
        )
      ) {
        const timedFallback = existingDayFallback?.start && existingDayFallback?.end
          ? existingDayFallback
          : fallbackAbsencePlan;
        if (!start) {
          start = timedFallback?.start ?? null;
        }
        if (!end) {
          end = timedFallback?.end ?? null;
        }
        if (requiredPauseMinutes <= 0) {
          requiredPauseMinutes = Math.max(0, Number(timedFallback?.requiredPauseMinutes ?? 0) || 0);
        }
      }

      const normalizedStart = noWorkDay ? null : sanitizeTime(start ?? null);
      const normalizedEnd = noWorkDay ? null : sanitizeTime(end ?? null);

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
      const hasContent = Boolean((normalizedStart && normalizedEnd) || label || requiredPauseMinutes > 0);

      return {
        hasContent,
        entry: {
          dayDate: isoDate,
          segmentIndex,
          mode,
          startTime: normalizedStart,
          endTime: normalizedEnd,
          requiredPauseMinutes,
          label,
          branchId,
        },
      };
    })
    .filter((segment) => segment.hasContent);

  // Guardrail: never let a full-day vacation placeholder overwrite a day that already has
  // an approved overtime-reduction request. This protects against stale external sync payloads.
  const isVacationPlaceholderOverwrite =
    normalizedSegments.length === 1 &&
    normalizedSegments[0]?.entry.mode === 'unavailable' &&
    (normalizedSegments[0]?.entry.label ?? '').trim().toLowerCase().includes('urlaub');
  if (isVacationPlaceholderOverwrite) {
    const prisma = getPrisma();
    const approvedOvertime = await prisma.leaveRequest.findFirst({
      where: {
        employeeId,
        type: 'overtime',
        status: 'approved',
        cancelledAt: null,
        startDate: { lte: isoDate },
        endDate: { gte: isoDate },
      },
      select: { id: true, startTime: true, endTime: true },
      orderBy: { id: 'desc' },
    });
    const hasApprovedOvertime = Boolean(approvedOvertime);
    console.warn('[shift-plan] vacation placeholder write detected', {
      tenantId,
      employeeId,
      isoDate,
      hasApprovedOvertime,
      approvedOvertimeRequestId: approvedOvertime?.id ?? null,
      approvedOvertimeStart: approvedOvertime?.startTime ?? null,
      approvedOvertimeEnd: approvedOvertime?.endTime ?? null,
    });
    if (hasApprovedOvertime) {
      console.warn('[shift-plan] ignored vacation placeholder overwrite due to approved overtime', {
        tenantId,
        employeeId,
        isoDate,
      });
      return;
    }
  }

  const branchContext = (() => {
    const branchId =
      normalizedSegments.find((segment) => segment.entry.branchId)?.entry.branchId ?? fallbackBranchId ?? null;
    if (!branchId) return null;
    return availableBranches.find((branch) => branch.id === branchId) ?? null;
  })();
  const holidayRegion = normalizeHolidayRegion(branchContext?.federalState ?? branchContext?.country ?? null);
  const hasAvailableTimeSegment = normalizedSegments.some(
    (segment) => segment.entry.mode === 'available' && segment.entry.startTime && segment.entry.endTime,
  );
  const absenceLabel =
    normalizedSegments.find((segment) => segment.entry.mode === 'unavailable' && segment.entry.label)?.entry.label ??
    normalizedSegments.find((segment) => segment.entry.label)?.entry.label ??
    null;

  if (!normalizedSegments.length) {
    await deleteShiftPlanDay(employeeId, isoDate);
    await syncShiftPlanAbsenceWithDailyDay({ tenantId, employeeId, isoDate, label: null, holidayRegion });
    return;
  }

  await deleteShiftPlanDay(employeeId, isoDate);
  await upsertShiftPlanDays(
    employeeId,
      normalizedSegments.map((segment) => segment.entry)
  );
  await syncShiftPlanAbsenceWithDailyDay({
    tenantId,
    employeeId,
    isoDate,
    label: hasAvailableTimeSegment ? null : absenceLabel,
    holidayRegion,
  });
}

export async function deleteShiftPlanDaysAfter(employeeId: number, isoDateExclusive: string): Promise<void> {
  await deleteShiftPlanDaysAfterData(employeeId, isoDateExclusive);
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
  hasPendingVacationRequest: boolean;
  pendingVacationNote: string | null;
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

export async function listWeeklyShiftTemplates(tenantId: string): Promise<WeeklyShiftTemplate[]> {
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    return [];
  }

  const records = await listShiftPlanTemplatesWithDays(normalizedTenantId);
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

export async function listWeeklyShiftTemplatesForEmployee(employeeId: number): Promise<WeeklyShiftTemplate[]> {
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    return [];
  }
  const records = await listShiftPlanTemplatesWithDaysForEmployee(employeeId);
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
  options?: { week?: string | null; tenantId?: string | null }
): Promise<WeeklyShiftPlan> {
  const meta = resolveWeekMeta(options?.week ?? null);
  const employeeIds = employees.map((employee) => employee.id);
  const [records, leaveRequests, shiftPlanRows] = await Promise.all([
    listShiftPlanDaysForEmployees(employeeIds, meta.weekStart, meta.weekEnd),
    options?.tenantId
      ? listLeaveRequestsForEmployeesInDateRange(
          options.tenantId,
          employeeIds,
          meta.weekStart,
          meta.weekEnd,
          5000,
        )
      : Promise.resolve([]),
    listShiftPlanRowsPg(employeeIds),
  ]);
  const shiftPlanRowByEmployee = shiftPlanRows;
  const recordMap = new Map<number, Map<string, RawShiftDayEntry[]>>();
  const pendingVacationByEmployeeDate = new Set<string>();

  const resolveUnavailableFallback = (
    employeeId: number,
    isoDate: string,
    label: string | null | undefined,
  ): { start: string; end: string; requiredPauseMinutes: number } | null => {
    const normalizedLabel = (label ?? '').trim();
    if (!normalizedLabel) return null;
    if (isNoWorkLabel(normalizedLabel)) return null;
    if (!deriveCodeFromPlanLabel(normalizedLabel)) return null;

    const row = shiftPlanRowByEmployee.get(employeeId) ?? null;
    if (!row) return null;

    const fallbackDay = getWeeklyFallbackDayFromRow(row, isoDate, normalizedLabel);
    if (!fallbackDay) return null;
    const fallbackHours = buildPlanHours(
      fallbackDay.start,
      fallbackDay.end,
      fallbackDay.requiredPauseMinutes,
    );
    if (!fallbackHours || fallbackHours.rawHours <= 0.001 || !fallbackHours.start || !fallbackHours.end) {
      return null;
    }

    return {
      start: fallbackHours.start,
      end: fallbackHours.end,
      requiredPauseMinutes: fallbackHours.requiredPauseMinutes ?? 0,
    };
  };

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

  for (const request of leaveRequests) {
    if (request.type !== 'vacation') continue;
    if (request.status !== 'pending') continue;
    if (request.cancelled_at) continue;
    for (const isoDate of enumerateDates(request.start_date, request.end_date)) {
      if (isoDate < meta.weekStart || isoDate > meta.weekEnd) continue;
      pendingVacationByEmployeeDate.add(`${request.employee_id}:${isoDate}`);
    }
  }

  const rows: WeeklyShiftPlanRow[] = employees.map((employee) => {
    const perEmployee = recordMap.get(employee.id);
    const cells: WeeklyShiftPlanCell[] = meta.days.map((day) => {
      const entries = perEmployee?.get(day.isoDate) ?? [];
      entries.sort((a, b) => a.segmentIndex - b.segmentIndex);
      const firstEntry = entries[0];
      if (entries.length) {
        const normalizedSegments = entries.map((entry) => {
          let start = entry.start ?? null;
          let end = entry.end ?? null;
          let requiredPauseMinutes = entry.requiredPauseMinutes ?? 0;
          if (entry.mode === 'unavailable' && (!start || !end)) {
            const fallback = resolveUnavailableFallback(employee.id, day.isoDate, entry.label);
            if (fallback) {
              start = fallback.start;
              end = fallback.end;
              requiredPauseMinutes = fallback.requiredPauseMinutes;
            }
          }
          return {
            segmentIndex: entry.segmentIndex,
            mode: entry.mode,
            start,
            end,
            requiredPauseMinutes,
            label: entry.label ?? null,
            branchId: entry.branchId ?? null,
            branchName: entry.branchName ?? null,
          };
        });
        const firstSegment = normalizedSegments[0] ?? null;
        const hasPendingVacationRequest = pendingVacationByEmployeeDate.has(
          `${employee.id}:${day.isoDate}`,
        );
        return {
          isoDate: day.isoDate,
          start: firstSegment?.start ?? null,
          end: firstSegment?.end ?? null,
          requiredPauseMinutes: firstSegment?.requiredPauseMinutes ?? 0,
          label: firstSegment?.label ?? firstEntry?.label ?? null,
          segments: normalizedSegments,
          source: 'daily',
          branchId: firstEntry?.branchId ?? null,
          branchName: firstEntry?.branchName ?? null,
          hasPendingVacationRequest,
          pendingVacationNote: hasPendingVacationRequest ? 'Urlaub angefragt' : null,
        };
      }
      const hasPendingVacationRequest = pendingVacationByEmployeeDate.has(
        `${employee.id}:${day.isoDate}`,
      );
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
        hasPendingVacationRequest,
        pendingVacationNote: hasPendingVacationRequest ? 'Urlaub angefragt' : null,
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
