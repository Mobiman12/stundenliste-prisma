'use server';

import { revalidatePath } from 'next/cache';

import { getServerAuthSession } from '@/lib/auth/session';
import { fetchStaffShiftPlanSettings, pushShiftPlanDayToControlPlane } from '@/lib/control-plane';
import { getEmployeeById, updateEmployeePersonnelNumber, type EmployeeRecord } from '@/lib/data/employees';
import { listShiftPlanDays } from '@/lib/data/shift-plan-days';
import { listBranchesForEmployee } from '@/lib/data/branches';
import {
  clearShiftPlanRange,
  listWeeklyShiftTemplatesForEmployee,
  saveShiftPlanDay,
  saveShiftPlanDaySegments,
} from '@/lib/services/shift-plan';
import { recomputeEmployeeOvertime } from '@/lib/services/time-entry';
import { calculateLegalPauseHours } from '@/lib/services/time-calculations';
import { withAppBasePath } from '@/lib/routes';
import { isHolidayIsoDate, normalizeHolidayRegion } from '@/lib/services/holidays';

type ActionResult = {
  success: boolean;
  error?: string;
};

type EmployeeContext = {
  tenantId: string;
  employeeId: number;
  staffId: string | null;
  displayName: string;
  employee: EmployeeRecord;
  allowSelfPlan: boolean;
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NO_WORK_LABEL = 'Kein Arbeitstag';
const NO_WORK_LABEL_LOWER = NO_WORK_LABEL.toLowerCase();
const isNoWorkLabel = (label: string | null | undefined): boolean =>
  (label ?? '').trim().toLowerCase() === NO_WORK_LABEL_LOWER;

function addDays(source: Date, days: number): Date {
  const next = new Date(source);
  next.setDate(next.getDate() + days);
  return next;
}

function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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

function parseTimeToDecimalHours(value: string | null): number | null {
  if (!value) return null;
  const parts = value.split(':');
  if (parts.length !== 2) return null;
  const hours = Number.parseInt(parts[0] ?? '', 10);
  const minutes = Number.parseInt(parts[1] ?? '', 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  const total = hours + minutes / 60;
  return Number.isFinite(total) ? total : null;
}

function parseBranchId(raw: FormDataEntryValue | null): number | null | typeof NaN {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
}

async function loadEmployeeContext(): Promise<{ context?: EmployeeContext; error?: string }> {
  const session = await getServerAuthSession();
  if (!session?.user || !session.user.employeeId || !session.tenantId) {
    return { error: 'Nicht angemeldet.' };
  }

  const tenantId = session.tenantId;
  const employeeId = session.user.employeeId;
  const employee = await getEmployeeById(tenantId, employeeId);
  if (!employee) {
    return { error: 'Mitarbeiter nicht gefunden.' };
  }

  const staffId = employee.personnel_number ?? null;
  const displayName = `${employee.first_name ?? ''} ${employee.last_name ?? ''}`.trim() || employee.username;
  const settings = await fetchStaffShiftPlanSettings({
    tenantId,
    staffId,
    email: employee.email ?? employee.username ?? null,
    firstName: employee.first_name ?? null,
    lastName: employee.last_name ?? null,
    displayName,
  });
  const resolvedStaffId = settings.staffId ?? staffId ?? null;
  if (settings.staffId && settings.staffId !== staffId) {
    await updateEmployeePersonnelNumber(tenantId, employeeId, settings.staffId);
  }

  return {
    context: {
      tenantId,
      employeeId,
      employee,
      staffId: resolvedStaffId,
      displayName,
      allowSelfPlan: settings.allowEmployeeSelfPlan,
    },
  };
}

async function requireEditableContext(): Promise<{ context?: EmployeeContext; error?: string }> {
  const { context, error } = await loadEmployeeContext();
  if (!context) {
    return { error: error ?? 'Nicht angemeldet.' };
  }
  if (!context.allowSelfPlan) {
    return { error: 'Schichtplan ist aktuell nicht freigeschaltet.' };
  }
  return { context };
}

async function syncShiftPlanDay(
  context: EmployeeContext,
  payload: {
    isoDate: string;
    start: string | null;
    end: string | null;
    pause: number;
    label: string | null;
    branchId?: number | null;
    segmentIndex?: number | null;
    mode?: 'available' | 'unavailable' | null;
  }
) {
  await pushShiftPlanDayToControlPlane({
    tenantId: context.tenantId,
    staffId: context.staffId,
    email: context.employee.email ?? context.employee.username ?? null,
    firstName: context.employee.first_name ?? null,
    lastName: context.employee.last_name ?? null,
    displayName: context.displayName || null,
    isoDate: payload.isoDate,
    start: payload.start ?? null,
    end: payload.end ?? null,
    pause: payload.pause ?? 0,
    label: payload.label ?? null,
    branchId: payload.branchId ?? null,
    segmentIndex: payload.segmentIndex ?? null,
    mode: payload.mode ?? null,
  });
}

export async function updateEmployeeShiftPlanDayAction(formData: FormData): Promise<ActionResult> {
  const { context, error } = await requireEditableContext();
  if (!context) {
    return { success: false, error };
  }

  const isoDate = String(formData.get('isoDate') ?? '').trim();
  if (!ISO_DATE_PATTERN.test(isoDate)) {
    return { success: false, error: 'Ungültiges Datum.' };
  }

  const startValue = formData.get('start');
  const endValue = formData.get('end');
  const pauseValue = formData.get('pause');
  const labelValue = formData.get('label');
  const labelRaw = typeof labelValue === 'string' ? labelValue.trim() : '';
  const noWorkDay = isNoWorkLabel(labelRaw);
  const keepTimes = !noWorkDay;
  const start = keepTimes && typeof startValue === 'string' && startValue ? startValue : null;
  const end = keepTimes && typeof endValue === 'string' && endValue ? endValue : null;
  const requiredPause =
    keepTimes && typeof pauseValue === 'string' && pauseValue.length ? Number(pauseValue) : 0;
  const branchId = parseBranchId(formData.get('branchId'));

  if (Number.isNaN(branchId)) {
    return { success: false, error: 'Ungültige Filiale.' };
  }

  try {
    await saveShiftPlanDay(context.tenantId, context.employeeId, {
      isoDate,
      start,
      end,
      requiredPauseMinutes: Number.isFinite(requiredPause) ? requiredPause : 0,
      label: labelRaw.length ? labelRaw : null,
      branchId: branchId ?? null,
    });
    await recomputeEmployeeOvertime(context.tenantId, context.employeeId);
    await syncShiftPlanDay(context, {
      isoDate,
      start: start ?? null,
      end: end ?? null,
      pause: Number.isFinite(requiredPause) ? requiredPause : 0,
      label: labelRaw.length ? labelRaw : null,
      branchId: branchId ?? null,
      segmentIndex: 0,
      mode: noWorkDay ? 'unavailable' : null,
    });
    revalidatePath(withAppBasePath('/mitarbeiter/schichtplan'));
    return { success: true };
  } catch (actionError) {
    console.error('[employee-shift-plan] update failed', actionError);
    return { success: false, error: 'Speichern fehlgeschlagen.' };
  }
}

export async function clearEmployeeShiftPlanWeekAction(formData: FormData): Promise<ActionResult> {
  const { context, error } = await requireEditableContext();
  if (!context) {
    return { success: false, error };
  }

  const weekStartRaw = String(formData.get('weekStart') ?? '').trim();
  if (!ISO_DATE_PATTERN.test(weekStartRaw)) {
    return { success: false, error: 'Ungültiger Wochenstart.' };
  }

  const weekStartDate = new Date(`${weekStartRaw}T00:00:00`);
  if (Number.isNaN(weekStartDate.getTime())) {
    return { success: false, error: 'Ungültiger Wochenstart.' };
  }

  const weekEndDate = addDays(weekStartDate, 6);

  try {
    await clearShiftPlanRange(
      context.employeeId,
      formatIsoDate(weekStartDate),
      formatIsoDate(weekEndDate)
    );
    await recomputeEmployeeOvertime(context.tenantId, context.employeeId);

    for (let offset = 0; offset < 7; offset += 1) {
      const isoDate = formatIsoDate(addDays(weekStartDate, offset));
      await syncShiftPlanDay(context, {
        isoDate,
        start: null,
        end: null,
        pause: 0,
        label: null,
        branchId: null,
        segmentIndex: 0,
      });
    }

    revalidatePath(withAppBasePath('/mitarbeiter/schichtplan'));
    return { success: true };
  } catch (actionError) {
    console.error('[employee-shift-plan] clear week failed', actionError);
    return { success: false, error: 'Woche konnte nicht gelöscht werden.' };
  }
}

export async function syncEmployeeShiftPlanRangeAction(formData: FormData): Promise<ActionResult> {
  const { context, error } = await requireEditableContext();
  if (!context) {
    return { success: false, error };
  }

  const startRaw = String(formData.get('start') ?? '').trim();
  const endRaw = String(formData.get('end') ?? '').trim();
  if (!ISO_DATE_PATTERN.test(startRaw) || !ISO_DATE_PATTERN.test(endRaw) || endRaw < startRaw) {
    return { success: false, error: 'Ungültiger Zeitraum.' };
  }

  const startDate = new Date(`${startRaw}T00:00:00`);
  const endDate = new Date(`${endRaw}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return { success: false, error: 'Ungültiger Zeitraum.' };
  }

  try {
    const records = await listShiftPlanDays(context.employeeId, startRaw, endRaw);
    const byDate = new Map<string, typeof records>();
    for (const record of records) {
      const list = byDate.get(record.day_date) ?? [];
      list.push(record);
      byDate.set(record.day_date, list);
    }

    for (let cursor = new Date(startDate); cursor <= endDate; cursor = addDays(cursor, 1)) {
      const isoDate = formatIsoDate(cursor);
      const entries = byDate.get(isoDate);
      if (!entries || !entries.length) {
        continue;
      }

      for (const entry of entries) {
        await syncShiftPlanDay(context, {
          isoDate,
          start: entry.start_time ?? null,
          end: entry.end_time ?? null,
          pause: Number(entry.required_pause_minutes ?? 0) || 0,
          label: entry.label ?? null,
          branchId: entry.branch_id ?? null,
          segmentIndex: entry.segment_index ?? 0,
          mode: entry.mode === 'unavailable' ? 'unavailable' : null,
        });
      }
    }

    return { success: true };
  } catch (actionError) {
    console.error('[employee-shift-plan] sync range failed', actionError);
    return { success: false, error: 'Synchronisierung fehlgeschlagen.' };
  }
}

export async function fillEmployeeShiftPlanWeekAction(formData: FormData): Promise<ActionResult> {
  const { context, error } = await requireEditableContext();
  if (!context) {
    return { success: false, error };
  }

  const weekStartRaw = String(formData.get('weekStart') ?? '').trim();
  const templateIdRaw = formData.get('templateId');
  const templateId = templateIdRaw ? Number(templateIdRaw) : NaN;
  const labelOverrideRaw = formData.get('label');
  const labelOverride = typeof labelOverrideRaw === 'string' ? labelOverrideRaw.trim() : '';
  const branchId = parseBranchId(formData.get('branchId'));

  if (!ISO_DATE_PATTERN.test(weekStartRaw) || !Number.isFinite(templateId) || templateId <= 0) {
    return { success: false, error: 'Ungültige Eingabe.' };
  }

  if (Number.isNaN(branchId)) {
    return { success: false, error: 'Ungültige Filiale.' };
  }

  const weekStartDate = new Date(`${weekStartRaw}T00:00:00`);
  if (Number.isNaN(weekStartDate.getTime())) {
    return { success: false, error: 'Ungültiger Wochenstart.' };
  }

  const branches = await listBranchesForEmployee(context.tenantId, context.employeeId);
  const resolvedBranch =
    branchId && !Number.isNaN(branchId)
      ? branches.find((branch) => branch.id === branchId) ?? null
      : branches.length === 1
        ? branches[0]
        : null;
  const holidayRegion = normalizeHolidayRegion(resolvedBranch?.federalState ?? resolvedBranch?.country ?? null);

  const template = listWeeklyShiftTemplatesForEmployee(context.employeeId).find(
    (entry) => entry.id === templateId
  );
  if (!template) {
    return { success: false, error: 'Schichtvorlage wurde nicht gefunden.' };
  }

  try {
    for (let offset = 0; offset < 7; offset += 1) {
      const current = addDays(weekStartDate, offset);
      const isoDate = formatIsoDate(current);
      const weekdayIndex = (current.getDay() + 6) % 7; // Monday = 0

      const templateDay = template.days.find((day) => day.weekday === weekdayIndex);
      const templateSegments = templateDay?.segments ?? [];
      const templateHasSegments = templateSegments.length > 0;

      const availableSegment = templateHasSegments
        ? templateSegments.find((segment) => segment.mode === 'available' && (segment.start || segment.end))
        : null;
      const unavailableSegment = templateHasSegments
        ? templateSegments.find((segment) => segment.mode === 'unavailable')
        : null;
      const isHoliday = holidayRegion ? isHolidayIsoDate(isoDate, holidayRegion).isHoliday : false;

      let start: string | null = null;
      let end: string | null = null;
      let pauseMinutes = 0;
      let label: string | null = null;

      if (templateHasSegments) {
        if (availableSegment) {
          start = sanitizeTime(availableSegment.start);
          end = sanitizeTime(availableSegment.end);
          pauseMinutes = Number(availableSegment.requiredPauseMinutes ?? 0) || 0;
          label = availableSegment.label?.trim() || null;
        } else {
          if (unavailableSegment) {
            label = (unavailableSegment.label ?? '').trim() || NO_WORK_LABEL;
            start = sanitizeTime(unavailableSegment.start);
            end = sanitizeTime(unavailableSegment.end);
            pauseMinutes = Number(unavailableSegment.requiredPauseMinutes ?? 0) || 0;
          }
        }
      }

      const startHours = parseTimeToDecimalHours(start);
      const endHours = parseTimeToDecimalHours(end);
      if (startHours !== null && endHours !== null) {
        let duration = endHours - startHours;
        if (duration < 0) {
          duration += 24;
        }
        duration = Math.max(duration, 0);
        const legalPauseMinutes = Math.round(calculateLegalPauseHours(duration) * 60);
        if (pauseMinutes < legalPauseMinutes) {
          pauseMinutes = legalPauseMinutes;
        }
      }

      if (labelOverride) {
        label = labelOverride;
        if (isNoWorkLabel(labelOverride)) {
          start = null;
          end = null;
          pauseMinutes = 0;
        }
      }

      const labelNormalized = (label ?? '').trim().toLowerCase();
      const holidayAvailableLabel =
        labelNormalized.includes('verfügbar') || labelNormalized.includes('verfuegbar');
      const isHolidayUnavailable = isHoliday && !holidayAvailableLabel;
      if (isHolidayUnavailable && !labelNormalized.includes('feiertag')) {
        label = 'Feiertag';
      }

      if (label && isNoWorkLabel(label)) {
        start = null;
        end = null;
        pauseMinutes = 0;
      }

      const templateUnavailable = !availableSegment && Boolean(unavailableSegment);
      const mode: 'available' | 'unavailable' =
        isHolidayUnavailable || isNoWorkLabel(label) || templateUnavailable ? 'unavailable' : 'available';

      if (!start && !end && pauseMinutes <= 0 && (!label || !label.trim())) {
        if (isHoliday) {
          await saveShiftPlanDay(context.tenantId, context.employeeId, {
            isoDate,
            requiredPauseMinutes: 0,
            label: 'Feiertag',
            branchId: branchId ?? null,
            mode: 'unavailable',
          });
          await syncShiftPlanDay(context, {
            isoDate,
            start: null,
            end: null,
            pause: 0,
            label: 'Feiertag',
            branchId: branchId ?? null,
            segmentIndex: 0,
            mode: 'unavailable',
          });
        } else {
          await saveShiftPlanDay(context.tenantId, context.employeeId, {
            isoDate,
            requiredPauseMinutes: 0,
            branchId: null,
          });
          await syncShiftPlanDay(context, {
            isoDate,
            start: null,
            end: null,
            pause: 0,
            label: null,
            branchId: null,
            segmentIndex: 0,
          });
        }
        continue;
      }

      await saveShiftPlanDay(context.tenantId, context.employeeId, {
        isoDate,
        start,
        end,
        requiredPauseMinutes: pauseMinutes,
        label: label ?? undefined,
        branchId: branchId ?? null,
        mode,
      });
      await syncShiftPlanDay(context, {
        isoDate,
        start: start ?? null,
        end: end ?? null,
        pause: pauseMinutes,
        label: label ?? null,
        branchId: branchId ?? null,
        segmentIndex: 0,
        mode,
      });
    }

    await recomputeEmployeeOvertime(context.tenantId, context.employeeId);
    revalidatePath(withAppBasePath('/mitarbeiter/schichtplan'));
    return { success: true };
  } catch (actionError) {
    console.error('[employee-shift-plan] fill week failed', actionError);
    const message =
      actionError instanceof Error && actionError.message
        ? `Woche konnte nicht gefüllt werden: ${actionError.message}`
        : 'Woche konnte nicht gefüllt werden.';
    return { success: false, error: message };
  }
}

type WeekPatternPayload = {
  weekStart: string;
  employees: number[];
  days: Array<{
    isoDate: string;
    segments?: Array<{
      mode?: 'available' | 'unavailable';
      start?: string | null;
      end?: string | null;
      pause?: number | null;
      label?: string | null;
      branchId?: number | null;
    }>;
    mode?: 'available' | 'unavailable';
    start?: string | null;
    end?: string | null;
    pause?: number | null;
    label?: string | null;
    branchId?: number | null;
  }>;
};

export async function createEmployeeWeekPatternAction(formData: FormData): Promise<ActionResult> {
  const { context, error } = await requireEditableContext();
  if (!context) {
    return { success: false, error };
  }

  const rawPayload = formData.get('payload');
  if (typeof rawPayload !== 'string' || !rawPayload.trim()) {
    return { success: false, error: 'Ungültige Anfrage.' };
  }

  let payload: WeekPatternPayload;
  try {
    payload = JSON.parse(rawPayload) as WeekPatternPayload;
  } catch (parseError) {
    console.error('[employee-shift-plan] pattern parse error', parseError);
    return { success: false, error: 'Die Angaben konnten nicht gelesen werden.' };
  }

  const weekStart = (payload.weekStart ?? '').trim();
  if (!ISO_DATE_PATTERN.test(weekStart)) {
    return { success: false, error: 'Ungültiger Wochenstart.' };
  }

  const selectedEmployees = Array.isArray(payload.employees)
    ? payload.employees
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    : [];

  if (!selectedEmployees.length || !selectedEmployees.includes(context.employeeId)) {
    return { success: false, error: 'Bitte mindestens eine Ressource auswählen.' };
  }

  const days = Array.isArray(payload.days) ? payload.days : [];
  if (!days.length) {
    return { success: false, error: 'Keine Tageswerte übermittelt.' };
  }

  try {
    for (const day of days) {
      const isoDate = (day.isoDate ?? '').trim();
      if (!ISO_DATE_PATTERN.test(isoDate)) {
        continue;
      }

      const rawSegments = Array.isArray(day.segments) ? day.segments : [];
      const hasLegacyPayload = Boolean(day.mode || day.start || day.end || day.label || day.pause !== undefined);
      const combinedSegments = rawSegments.length
        ? rawSegments
        : hasLegacyPayload
          ? [
              {
                mode: day.mode,
                start: day.start ?? null,
                end: day.end ?? null,
                pause: day.pause ?? null,
                label: day.label ?? null,
                branchId: day.branchId ?? null,
              },
            ]
          : [];

      const normalizedSegments = combinedSegments
        .map((segment, index) => {
          const labelTrimmed = typeof segment.label === 'string' ? segment.label.trim() : '';
          const mode: 'available' | 'unavailable' =
            segment.mode === 'unavailable' ? 'unavailable' : 'available';
          const noWorkDay = mode === 'unavailable' && isNoWorkLabel(labelTrimmed);
          const startValue = !noWorkDay && typeof segment.start === 'string' ? segment.start.trim() : null;
          const endValue = !noWorkDay && typeof segment.end === 'string' ? segment.end.trim() : null;
          const pauseNumeric = Number(segment.pause ?? 0);
          const pauseValue = !noWorkDay && Number.isFinite(pauseNumeric) ? pauseNumeric : 0;
          const labelValue = labelTrimmed || null;
          const branchValue = Number(segment.branchId ?? 0);
          const branchId = Number.isFinite(branchValue) && branchValue > 0 ? branchValue : null;

          return {
            segmentIndex: index,
            mode,
            start: startValue && startValue.length ? startValue : null,
            end: endValue && endValue.length ? endValue : null,
            requiredPauseMinutes: pauseValue,
            label: labelValue,
            branchId,
          };
        })
        .filter((segment) => {
          const hasTimes = Boolean(segment.start || segment.end);
          const hasLabel = Boolean(segment.label);
          return hasTimes || hasLabel || segment.requiredPauseMinutes > 0;
        });

      await saveShiftPlanDaySegments(context.tenantId, context.employeeId, {
        isoDate,
        segments: normalizedSegments,
      });

      if (!normalizedSegments.length) {
        await syncShiftPlanDay(context, {
          isoDate,
          start: null,
          end: null,
          pause: 0,
          label: null,
          branchId: null,
          segmentIndex: 0,
        });
        continue;
      }

      const primarySegment =
        normalizedSegments.find((segment) => segment.mode === 'available' && (segment.start || segment.end)) ??
        normalizedSegments[0];

      await syncShiftPlanDay(context, {
        isoDate,
        start: primarySegment?.start ?? null,
        end: primarySegment?.end ?? null,
        pause: primarySegment?.requiredPauseMinutes ?? 0,
        label: primarySegment?.label ?? null,
        branchId: primarySegment?.branchId ?? null,
        segmentIndex: primarySegment?.segmentIndex ?? 0,
        mode: primarySegment?.mode ?? null,
      });
    }

    await recomputeEmployeeOvertime(context.tenantId, context.employeeId);
    revalidatePath(withAppBasePath('/mitarbeiter/schichtplan'));
    return { success: true };
  } catch (actionError) {
    console.error('[employee-shift-plan] pattern save failed', actionError);
    return { success: false, error: 'Wochenplan konnte nicht gespeichert werden.' };
  }
}
