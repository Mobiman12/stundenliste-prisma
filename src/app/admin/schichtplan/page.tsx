import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import { listEmployees } from '@/lib/data/employees';
import {
  clearShiftPlanRange,
  getWeeklyShiftPlan,
  listWeeklyShiftTemplates,
  saveShiftPlanDay,
  saveShiftPlanDaySegments,
} from '@/lib/services/shift-plan';
import { recomputeEmployeeOvertime } from '@/lib/services/time-entry';
import { calculateLegalPauseHours } from '@/lib/services/time-calculations';

import ShiftPlanBoard from './ShiftPlanBoard';

type ActionResult = {
  success: boolean;
  error?: string;
};

async function ensureAdminSession() {
  const session = await getServerAuthSession();
  if (!session?.user || session.user.roleId !== 2) {
    redirect(withAppBasePath('/login'));
  }
  const tenantId = session.tenantId;
  if (!tenantId) {
    redirect(withAppBasePath('/login'));
  }
  return { session, tenantId };
}

async function updateShiftPlanDayAction(formData: FormData): Promise<ActionResult> {
  'use server';

  const { tenantId } = await ensureAdminSession();

  const employeeId = Number(formData.get('employeeId'));
  const isoDate = String(formData.get('isoDate') ?? '').trim();
  if (!Number.isFinite(employeeId) || employeeId <= 0 || !isoDate) {
    return { success: false, error: 'Ungültige Eingabe.' };
  }

  const startValue = formData.get('start');
  const endValue = formData.get('end');
  const pauseValue = formData.get('pause');
  const labelValue = formData.get('label');

  const labelRaw = typeof labelValue === 'string' ? labelValue.trim() : '';
  const branchRaw = formData.get('branchId');
  const noWorkDay = isNoWorkLabel(labelRaw);
  const keepTimes = !noWorkDay;
  const start = keepTimes && typeof startValue === 'string' && startValue ? startValue : null;
  const end = keepTimes && typeof endValue === 'string' && endValue ? endValue : null;
  const requiredPause =
    keepTimes && typeof pauseValue === 'string' && pauseValue.length ? Number(pauseValue) : 0;
  const branchId = (() => {
    if (branchRaw === null || branchRaw === undefined || branchRaw === '') {
      return null;
    }
    const parsed = Number(branchRaw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
  })();

  if (Number.isNaN(branchId)) {
    return { success: false, error: 'Ungültige Filiale.' };
  }

  try {
    await saveShiftPlanDay(tenantId, employeeId, {
      isoDate,
      start,
      end,
      requiredPauseMinutes: Number.isFinite(requiredPause) ? requiredPause : 0,
      label: labelRaw.length ? labelRaw : null,
      branchId: branchId ?? null,
    });

    await recomputeEmployeeOvertime(tenantId, employeeId);

    revalidatePath(withAppBasePath('/admin/schichtplan'));

    return { success: true };
  } catch (error) {
    console.error('updateShiftPlanDayAction', error);
    return { success: false, error: 'Speichern fehlgeschlagen.' };
  }
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

const NO_WORK_LABEL = 'Kein Arbeitstag';
const NO_WORK_LABEL_LOWER = NO_WORK_LABEL.toLowerCase();
const isNoWorkLabel = (label: string | null | undefined): boolean =>
  (label ?? '').trim().toLowerCase() === NO_WORK_LABEL_LOWER;

async function clearShiftPlanWeekAction(formData: FormData): Promise<ActionResult> {
  'use server';

  const { tenantId } = await ensureAdminSession();

  const employeeId = Number(formData.get('employeeId'));
  const weekStartRaw = String(formData.get('weekStart') ?? '').trim();

  if (!Number.isFinite(employeeId) || employeeId <= 0 || !ISO_DATE_PATTERN.test(weekStartRaw)) {
    return { success: false, error: 'Ungültige Eingabe.' };
  }

  const weekStartDate = new Date(`${weekStartRaw}T00:00:00`);
  if (Number.isNaN(weekStartDate.getTime())) {
    return { success: false, error: 'Ungültiger Wochenstart.' };
  }

  const weekEndDate = addDays(weekStartDate, 6);

  try {
    await clearShiftPlanRange(employeeId, formatIsoDate(weekStartDate), formatIsoDate(weekEndDate));
    await recomputeEmployeeOvertime(tenantId, employeeId);
    revalidatePath(withAppBasePath('/admin/schichtplan'));
    return { success: true };
  } catch (error) {
    console.error('clearShiftPlanWeekAction', error);
    return { success: false, error: 'Woche konnte nicht gelöscht werden.' };
  }
}

async function fillShiftPlanWeekAction(formData: FormData): Promise<ActionResult> {
  'use server';

  const { tenantId } = await ensureAdminSession();

  const employeeId = Number(formData.get('employeeId'));
  const weekStartRaw = String(formData.get('weekStart') ?? '').trim();
  const templateIdRaw = formData.get('templateId');
  const templateId = templateIdRaw ? Number(templateIdRaw) : NaN;
  const labelOverrideRaw = formData.get('label');
  const labelOverride = typeof labelOverrideRaw === 'string' ? labelOverrideRaw.trim() : '';
  const branchRaw = formData.get('branchId');

  if (
    !Number.isFinite(employeeId) ||
    employeeId <= 0 ||
    !ISO_DATE_PATTERN.test(weekStartRaw) ||
    !Number.isFinite(templateId) ||
    templateId <= 0
  ) {
    return { success: false, error: 'Ungültige Eingabe.' };
  }

  const branchId = (() => {
    if (branchRaw === null || branchRaw === undefined || branchRaw === '') {
      return null;
    }
    const parsed = Number(branchRaw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
  })();

  if (Number.isNaN(branchId)) {
    return { success: false, error: 'Ungültige Filiale.' };
  }

  const weekStartDate = new Date(`${weekStartRaw}T00:00:00`);
  if (Number.isNaN(weekStartDate.getTime())) {
    return { success: false, error: 'Ungültiger Wochenstart.' };
  }

  const template = listWeeklyShiftTemplates().find((entry) => entry.id === templateId);
  if (!template) {
    return { success: false, error: 'Schichtvorlage wurde nicht gefunden.' };
  }

  try {
    for (let offset = 0; offset < 7; offset += 1) {
      const current = new Date(weekStartDate);
      current.setDate(current.getDate() + offset);
      const isoDate = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
      const weekdayIndex = (current.getDay() + 6) % 7; // Monday = 0

      const templateDay = template.days.find((day) => day.weekday === weekdayIndex);
      const templateSegments = templateDay?.segments ?? [];
      const templateHasSegments = templateSegments.length > 0;

      let start: string | null = null;
      let end: string | null = null;
      let pauseMinutes = 0;
      let label: string | null = null;

      if (templateHasSegments) {
        const availableSegment = templateSegments.find(
          (segment) => segment.mode === 'available' && (segment.start || segment.end)
        );
        if (availableSegment) {
          start = sanitizeTime(availableSegment.start);
          end = sanitizeTime(availableSegment.end);
          pauseMinutes = Number(availableSegment.requiredPauseMinutes ?? 0) || 0;
          label = availableSegment.label?.trim() || null;
        } else {
          const unavailableSegment = templateSegments.find((segment) => segment.mode === 'unavailable');
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

      if (label && isNoWorkLabel(label)) {
        start = null;
        end = null;
        pauseMinutes = 0;
      }

      if (!start && !end && pauseMinutes <= 0 && (!label || !label.trim())) {
        await saveShiftPlanDay(tenantId, employeeId, { isoDate, requiredPauseMinutes: 0, branchId: null });
        continue;
      }

      await saveShiftPlanDay(tenantId, employeeId, {
        isoDate,
        start,
        end,
        requiredPauseMinutes: pauseMinutes,
        label: label ?? undefined,
        branchId: branchId ?? null,
      });
    }

    await recomputeEmployeeOvertime(tenantId, employeeId);

    revalidatePath(withAppBasePath('/admin/schichtplan'));
    return { success: true };
  } catch (error) {
    console.error('fillShiftPlanWeekAction', error);
    const message =
      error instanceof Error && error.message
        ? `Woche konnte nicht gefüllt werden: ${error.message}`
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

async function createWeekPatternAction(formData: FormData): Promise<ActionResult> {
  'use server';

  const { tenantId } = await ensureAdminSession();

  const rawPayload = formData.get('payload');
  if (typeof rawPayload !== 'string' || !rawPayload.trim()) {
    return { success: false, error: 'Ungültige Anfrage.' };
  }

  let payload: WeekPatternPayload;
  try {
    payload = JSON.parse(rawPayload) as WeekPatternPayload;
  } catch (error) {
    console.error('createWeekPatternAction parse error', error);
    return { success: false, error: 'Die Angaben konnten nicht gelesen werden.' };
  }

  const weekStart = (payload.weekStart ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return { success: false, error: 'Ungültiger Wochenstart.' };
  }

  const employeeIds = Array.isArray(payload.employees)
    ? payload.employees
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    : [];

  if (!employeeIds.length) {
    return { success: false, error: 'Bitte mindestens eine Ressource auswählen.' };
  }

  const days = Array.isArray(payload.days) ? payload.days : [];
  if (!days.length) {
    return { success: false, error: 'Keine Tageswerte übermittelt.' };
  }

  try {
    const affectedEmployees = new Set<number>();
    for (const employeeId of employeeIds) {
      for (const day of days) {
        const isoDate = (day.isoDate ?? '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
          continue;
        }

        const rawSegments = Array.isArray(day.segments) ? day.segments : [];
        const hasLegacyPayload = Boolean(
          day.mode || day.start || day.end || day.label || day.pause !== undefined
        );
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

        await saveShiftPlanDaySegments(tenantId, employeeId, {
          isoDate,
          segments: normalizedSegments,
        });
      }
      affectedEmployees.add(employeeId);
    }

    for (const id of affectedEmployees) {
      await recomputeEmployeeOvertime(tenantId, id);
    }

    revalidatePath(withAppBasePath('/admin/schichtplan'));
    return { success: true };
  } catch (error) {
    console.error('createWeekPatternAction error', error);
    return { success: false, error: 'Wochenplan konnte nicht gespeichert werden.' };
  }
}

export default async function ShiftPlanPage({
  searchParams,
}: {
  searchParams?: Promise<{ week?: string }>;
}) {
  const { tenantId } = await ensureAdminSession();

  const allEmployees = await listEmployees(tenantId);
  const employees = allEmployees.filter((employee) => employee.showInCalendar);
  if (!employees.length) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold text-slate-900">Schichtplan</h1>
        <p className="text-sm text-slate-500">
          Es sind keine Mitarbeiter für die Kalenderanzeige freigeschaltet.
        </p>
      </section>
    );
  }

  const resolvedSearch = searchParams ? await searchParams : undefined;
  const weekParam = typeof resolvedSearch?.week === 'string' ? resolvedSearch.week : undefined;
  const plan = await getWeeklyShiftPlan(
    employees.map((employee) => ({
      id: employee.id,
      displayName: employee.displayName,
      username: employee.username,
      branches: employee.branches,
    })),
    { week: weekParam ?? null }
  );
  const templates = listWeeklyShiftTemplates();

  return (
    <ShiftPlanBoard
      week={plan}
      employees={employees}
      updateAction={updateShiftPlanDayAction}
      clearWeekAction={clearShiftPlanWeekAction}
      fillWeekAction={fillShiftPlanWeekAction}
      createPatternAction={createWeekPatternAction}
      templates={templates}
    />
  );
}
