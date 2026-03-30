import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { createShiftPlanTemplateForEmployee, deleteShiftPlanTemplateForEmployee } from '@/lib/data/shift-plan-templates';
import { withAppBasePath } from '@/lib/routes';
import { fetchStaffShiftPlanSettings } from '@/lib/control-plane';
import { getEmployeeById } from '@/lib/data/employees';
import { updateEmployeeControlPlaneStaffId } from '@/lib/data/employees';
import { listBranchesForEmployee } from '@/lib/data/branches';
import { listShiftPlanDays } from '@/lib/data/shift-plan-days';
import { listLeaveRequestsForEmployeeInDateRange } from '@/lib/data/leave-requests';
import { deriveCodeFromPlanLabel, listWeeklyShiftTemplatesForEmployee } from '@/lib/services/shift-plan';

import EmployeeShiftPlanCalendar, { type ShiftPlanDayInfo } from './shiftplan-calendar';
import {
  clearEmployeeShiftPlanWeekAction,
  fillEmployeeShiftPlanWeekAction,
  syncEmployeeShiftPlanRangeAction,
  updateEmployeeShiftPlanDayAction,
} from './actions';
import EmployeeTemplateManager from './TemplateManager';
import CreateTemplateButton from './CreateTemplateButton';

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

type ActionResult = {
  success: boolean;
  error?: string;
};

type TemplatePayload = {
  name: string;
  days: Array<{
    weekday: number;
    mode: 'available' | 'unavailable';
    start?: string | null;
    end?: string | null;
    pause?: number | null;
    label?: string | null;
  }>;
};

const NO_WORK_LABEL = 'Kein Arbeitstag';
const NO_WORK_LABEL_LOWER = NO_WORK_LABEL.toLowerCase();
const isNoWorkLabel = (label: string | null | undefined): boolean =>
  (label ?? '').trim().toLowerCase() === NO_WORK_LABEL_LOWER;

function sanitizePayload(raw: TemplatePayload): TemplatePayload {
  const name = (raw.name ?? '').trim();
  const days = Array.isArray(raw.days) ? raw.days : [];
  return {
    name,
    days: days
      .map((day) => {
        const mode: 'available' | 'unavailable' = day.mode === 'unavailable' ? 'unavailable' : 'available';
        return {
          weekday: Number(day.weekday),
          mode,
          start: typeof day.start === 'string' ? day.start : null,
          end: typeof day.end === 'string' ? day.end : null,
          pause: Number(day.pause ?? 0) || 0,
          label: typeof day.label === 'string' ? day.label : null,
        };
      })
      .filter((day) => Number.isInteger(day.weekday) && day.weekday >= 0 && day.weekday <= 6),
  };
}

async function createEmployeeTemplateAction(formData: FormData): Promise<ActionResult> {
  'use server';

  const session = await getServerAuthSession();
  if (!session?.user || !session.user.employeeId) {
    return { success: false, error: 'Nicht angemeldet.' };
  }

  const payloadRaw = formData.get('payload');
  if (typeof payloadRaw !== 'string' || !payloadRaw.trim()) {
    return { success: false, error: 'Ungültige Anfrage.' };
  }

  try {
    const parsed = JSON.parse(payloadRaw) as TemplatePayload;
    const payload = sanitizePayload(parsed);
    if (!payload.name) {
      return { success: false, error: 'Bitte einen Namen für die Vorlage angeben.' };
    }
    if (!payload.days.length) {
      return { success: false, error: 'Die Vorlage benötigt mindestens einen Tag.' };
    }

    await createShiftPlanTemplateForEmployee(session.user.employeeId, {
      name: payload.name,
      days: payload.days.map((day) => ({
        weekday: day.weekday,
        mode: day.mode,
        start:
          day.mode === 'available' || !isNoWorkLabel(day.label)
            ? day.start ?? null
            : null,
        end:
          day.mode === 'available' || !isNoWorkLabel(day.label)
            ? day.end ?? null
            : null,
        requiredPauseMinutes:
          day.mode === 'available' || !isNoWorkLabel(day.label) ? day.pause ?? 0 : 0,
        label: day.label?.trim() ? day.label.trim() : null,
      })),
    });

    revalidatePath(withAppBasePath('/mitarbeiter/schichtplan'));
    return { success: true };
  } catch (error) {
    console.error('createEmployeeTemplateAction', error);
    return { success: false, error: 'Vorlage konnte nicht gespeichert werden.' };
  }
}

async function deleteEmployeeTemplateAction(formData: FormData): Promise<ActionResult> {
  'use server';

  const session = await getServerAuthSession();
  if (!session?.user || !session.user.employeeId) {
    return { success: false, error: 'Nicht angemeldet.' };
  }

  const templateId = Number(formData.get('templateId'));
  if (!Number.isFinite(templateId) || templateId <= 0) {
    return { success: false, error: 'Ungültige Vorlage.' };
  }

  try {
    await deleteShiftPlanTemplateForEmployee(session.user.employeeId, templateId);
    revalidatePath(withAppBasePath('/mitarbeiter/schichtplan'));
    return { success: true };
  } catch (error) {
    console.error('deleteEmployeeTemplateAction', error);
    return { success: false, error: 'Vorlage konnte nicht gelöscht werden.' };
  }
}

export default async function EmployeeShiftPlanPage() {
  const session = await getServerAuthSession();
  if (!session?.user) {
    redirect(withAppBasePath('/login?mode=employee'));
  }
  if (!session.user.employeeId) {
    redirect(withAppBasePath('/admin'));
  }

  const employeeId = session.user.employeeId;
  const tenantId = session.tenantId ?? null;
  if (!tenantId) {
    redirect(withAppBasePath('/login?mode=employee'));
  }

  const employee = await getEmployeeById(tenantId, employeeId);
  if (!employee) {
    redirect(withAppBasePath('/login?mode=employee'));
  }

  const staffId = employee.control_plane_staff_id ?? employee.personnel_number ?? null;
  const shiftPlanSettings = await fetchStaffShiftPlanSettings({
    tenantId,
    staffId,
    email: employee.email ?? employee.username ?? null,
    firstName: employee.first_name ?? null,
    lastName: employee.last_name ?? null,
    displayName: `${employee.first_name ?? ''} ${employee.last_name ?? ''}`.trim() || null,
  });

  if (shiftPlanSettings.staffId && shiftPlanSettings.staffId !== employee.control_plane_staff_id) {
    await updateEmployeeControlPlaneStaffId(tenantId, employeeId, shiftPlanSettings.staffId);
  }

  const templates = await listWeeklyShiftTemplatesForEmployee(employeeId);
  const branches = await listBranchesForEmployee(tenantId, employeeId);

  const today = new Date();
  // Employee self-planning should not be constrained to a few months.
  // We keep a bounded window for performance but allow multi-year planning.
  const rangeStartDate = new Date(today.getFullYear() - 1, 0, 1);
  const rangeEndDate = new Date(today.getFullYear() + 3, 11, 31);
  const rangeStart = toIsoDate(rangeStartDate);
  const rangeEnd = toIsoDate(rangeEndDate);

  const shiftPlanRecords = await listShiftPlanDays(employeeId, rangeStart, rangeEnd);
  const leaveRequests = await listLeaveRequestsForEmployeeInDateRange(
    tenantId,
    employeeId,
    rangeStart,
    rangeEnd,
    5000,
  );
  const pendingVacationDates = new Set<string>();
  for (const request of leaveRequests) {
    if (request.type !== 'vacation') continue;
    if (request.status !== 'pending') continue;
    if (request.cancelled_at) continue;
    const start = new Date(`${request.start_date}T00:00:00`);
    const end = new Date(`${request.end_date}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      pendingVacationDates.add(toIsoDate(cursor));
    }
  }
  const segmentsByDate = new Map<
    string,
    Array<{
      segmentIndex: number;
      mode: 'available' | 'unavailable';
      start: string | null;
      end: string | null;
      pauseMinutes: number;
      label: string | null;
      branchId: number | null;
      branchName: string | null;
    }>
  >();
  for (const record of shiftPlanRecords) {
    const entries = segmentsByDate.get(record.day_date) ?? [];
    entries.push({
      segmentIndex: record.segment_index ?? 0,
      mode: record.mode === 'unavailable' ? 'unavailable' : 'available',
      start: record.start_time ?? null,
      end: record.end_time ?? null,
      pauseMinutes: Number(record.required_pause_minutes ?? 0) || 0,
      label: record.label ?? null,
      branchId: record.branch_id ?? null,
      branchName: record.branch_name ?? null,
    });
    segmentsByDate.set(record.day_date, entries);
  }
  for (const entries of segmentsByDate.values()) {
    entries.sort((a, b) => a.segmentIndex - b.segmentIndex);
  }

  const days: ShiftPlanDayInfo[] = [];
  for (let cursor = new Date(rangeStartDate); cursor <= rangeEndDate; cursor.setDate(cursor.getDate() + 1)) {
    const isoDate = toIsoDate(cursor);
    const segments = segmentsByDate.get(isoDate) ?? [];
    const first = segments[0] ?? null;
    const availableTimedSegments = segments.filter(
      (segment) => segment.mode === 'available' && segment.start && segment.end
    );
    const timedSegments = segments.filter((segment) => segment.start && segment.end);
    const effectiveTimedSegments = availableTimedSegments.length ? availableTimedSegments : timedSegments;
    const hasAvailableSegments = availableTimedSegments.length > 0;
    const hasUnavailable = segments.some((segment) => segment.mode === 'unavailable');
    const start = effectiveTimedSegments.length ? effectiveTimedSegments[0]?.start ?? null : null;
    const end = effectiveTimedSegments.length
      ? effectiveTimedSegments[effectiveTimedSegments.length - 1]?.end ?? null
      : null;
    const pauseMinutes = first?.pauseMinutes ?? 0;
    const label =
      segments.find((segment) => segment.mode === 'unavailable' && segment.label)?.label ??
      segments.find((segment) => segment.label)?.label ??
      null;
    const branchId = segments.length === 1 ? first?.branchId ?? null : null;
    const branchName =
      segments.length === 1
        ? first?.branchName ?? null
        : segments.length > 1
          ? 'Mehrere Standorte'
          : null;
    const normalizedLabel = (label ?? '').trim().toLowerCase();
    const isAvailable =
      hasAvailableSegments ||
      (!hasUnavailable &&
        (!normalizedLabel ||
          normalizedLabel.includes('verfügbar') ||
          normalizedLabel.includes('verfuegbar') ||
          normalizedLabel.includes('available')));
    const hasPendingVacationRequest = pendingVacationDates.has(isoDate);
    const code = deriveCodeFromPlanLabel(label);
    days.push({
      isoDate,
      start,
      end,
      pauseMinutes,
      label,
      code,
      isAvailable,
      hasPendingVacationRequest,
      branchId,
      branchName,
      segments,
    });
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Mein Schichtplan</h2>
          <p className="text-sm text-slate-500">Monatsübersicht deiner hinterlegten Schichten und Abwesenheiten.</p>
        </div>
      </div>
      {shiftPlanSettings.allowEmployeeSelfPlan && templates.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Für ein schnelles Erstellen deines Schichtplan, kannst Du Vorlagen erstellen.
        </div>
      ) : null}
      {shiftPlanSettings.allowEmployeeSelfPlan ? (
        <div className="flex items-center justify-start">
          <CreateTemplateButton />
        </div>
      ) : null}
      <EmployeeShiftPlanCalendar
        days={days}
        initialDate={toIsoDate(today)}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        editable={shiftPlanSettings.allowEmployeeSelfPlan}
        templates={templates}
        updateAction={updateEmployeeShiftPlanDayAction}
        fillWeekAction={fillEmployeeShiftPlanWeekAction}
        clearWeekAction={clearEmployeeShiftPlanWeekAction}
        syncRangeAction={shiftPlanSettings.allowEmployeeSelfPlan ? syncEmployeeShiftPlanRangeAction : undefined}
        branches={branches}
      />
      {shiftPlanSettings.allowEmployeeSelfPlan ? (
        <EmployeeTemplateManager
          templates={templates}
          branches={branches}
          createAction={createEmployeeTemplateAction}
          deleteAction={deleteEmployeeTemplateAction}
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Schichtplan-Vorlagen stehen erst zur Verfügung, wenn der Admin die Bearbeitung freischaltet.
        </div>
      )}
    </section>
  );
}
