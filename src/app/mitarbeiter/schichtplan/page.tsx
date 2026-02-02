import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { createShiftPlanTemplateForEmployee, deleteShiftPlanTemplateForEmployee } from '@/lib/data/shift-plan-templates';
import { withAppBasePath } from '@/lib/routes';
import { fetchStaffShiftPlanSettings } from '@/lib/control-plane';
import { getEmployeeById } from '@/lib/data/employees';
import { listBranchesForEmployee } from '@/lib/data/branches';
import { getShiftPlan, deriveCodeFromPlanLabel, listWeeklyShiftTemplatesForEmployee } from '@/lib/services/shift-plan';

import EmployeeShiftPlanCalendar, { type ShiftPlanDayInfo } from './shiftplan-calendar';
import {
  clearEmployeeShiftPlanWeekAction,
  fillEmployeeShiftPlanWeekAction,
  syncEmployeeShiftPlanRangeAction,
  updateEmployeeShiftPlanDayAction,
} from './actions';
import EmployeeTemplateManager from './TemplateManager';

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
      .map((day) => ({
        weekday: Number(day.weekday),
        mode: day.mode === 'unavailable' ? 'unavailable' : 'available',
        start: typeof day.start === 'string' ? day.start : null,
        end: typeof day.end === 'string' ? day.end : null,
        pause: Number(day.pause ?? 0) || 0,
        label: typeof day.label === 'string' ? day.label : null,
      }))
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

    createShiftPlanTemplateForEmployee(session.user.employeeId, {
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
    deleteShiftPlanTemplateForEmployee(session.user.employeeId, templateId);
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

  const staffId = employee.personnel_number ?? null;
  const shiftPlanSettings = await fetchStaffShiftPlanSettings({
    tenantId,
    staffId,
    email: employee.email ?? employee.username ?? null,
    firstName: employee.first_name ?? null,
    lastName: employee.last_name ?? null,
    displayName: `${employee.first_name ?? ''} ${employee.last_name ?? ''}`.trim() || null,
  });

  const shiftPlan = await getShiftPlan(employeeId);
  const templates = listWeeklyShiftTemplatesForEmployee(employeeId);
  const branches = await listBranchesForEmployee(tenantId, employeeId);

  const today = new Date();
  const rangeStartDate = new Date(today.getFullYear(), today.getMonth() - 3, 1);
  const rangeEndDate = new Date(today.getFullYear(), today.getMonth() + 4, 0);

  const days: ShiftPlanDayInfo[] = [];
  for (let cursor = new Date(rangeStartDate); cursor <= rangeEndDate; cursor.setDate(cursor.getDate() + 1)) {
    const isoDate = toIsoDate(cursor);
    const entry = shiftPlan.days[isoDate] ?? null;
    const start = entry?.start ?? null;
    const end = entry?.end ?? null;
    const pauseMinutes = entry?.requiredPauseMinutes ?? 0;
    const label = entry?.label ?? null;
    const branchId = entry?.branchId ?? null;
    const branchName = entry?.branchName ?? null;
    const normalizedLabel = (label ?? '').trim().toLowerCase();
    const isAvailable =
      !normalizedLabel ||
      normalizedLabel.includes('verfügbar') ||
      normalizedLabel.includes('verfuegbar') ||
      normalizedLabel.includes('available');
    const code = deriveCodeFromPlanLabel(label);

    days.push({
      isoDate,
      start,
      end,
      pauseMinutes,
      label,
      code,
      isAvailable,
      branchId,
      branchName,
    });
  }

  const rangeStart = toIsoDate(rangeStartDate);
  const rangeEnd = toIsoDate(rangeEndDate);

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Mein Schichtplan</h2>
        <p className="text-sm text-slate-500">Monatsübersicht deiner hinterlegten Schichten und Abwesenheiten.</p>
      </div>
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
