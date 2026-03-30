import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import {
  createEmployeeOnboardingInvite,
  deleteEmployeeOnboardingInvite,
  listEmployeeOnboardingInvites,
} from '@/lib/services/employee-onboarding';
import {
  getAdminEmployeeList,
  setEmployeeActive,
} from '@/lib/services/admin/employee';

import AdminEmployeeListClient from './AdminEmployeeListClient';
import type { ActionState } from './[employeeId]/types';

const TOGGLE_INITIAL_STATE: ActionState = null;

type OnboardingInviteListRow = {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  createdAtLabel: string;
  expiresAtLabel: string;
  usedAtLabel: string | null;
  status: 'open' | 'used' | 'expired' | 'revoked' | 'invalid';
  employeeDisplayName: string | null;
};

async function ensureAdminSession() {
  const session = await getServerAuthSession();
  if (!session?.user) {
    redirect(withAppBasePath('/login'));
  }
  if (session.user.roleId !== 2) {
    redirect(withAppBasePath('/mitarbeiter'));
  }
  const tenantId = session.tenantId;
  if (!tenantId) {
    redirect(withAppBasePath('/login'));
  }
  return { session, tenantId };
}

function parseString(value: FormDataEntryValue | null): string | null {
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

async function toggleEmployeeActiveAction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  'use server';
  const { tenantId } = await ensureAdminSession();

  const employeeIdRaw = parseString(formData.get('employeeId'));
  const targetStatus = parseString(formData.get('targetStatus'));

  if (!employeeIdRaw || !targetStatus) {
    return { status: 'error', message: 'Ungültige Anfrage.' };
  }

  const employeeId = Number.parseInt(employeeIdRaw, 10);
  if (!Number.isFinite(employeeId)) {
    return { status: 'error', message: 'Mitarbeiter-ID ungültig.' };
  }

  const activate = targetStatus === 'activate';

  try {
    await setEmployeeActive(tenantId, employeeId, activate);
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Status konnte nicht geändert werden.',
    };
  }

  revalidatePath(withAppBasePath('/admin/mitarbeitende'));
  return {
    status: 'success',
    message: activate ? 'Mitarbeiter reaktiviert.' : 'Mitarbeiter deaktiviert.',
  };
}

function resolveOriginFromHeaders(headersList: Headers): string {
  const proto = headersList.get('x-forwarded-proto') ?? 'https';
  const host = headersList.get('x-forwarded-host') ?? headersList.get('host');
  if (host) {
    return `${proto}://${host}`;
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return appUrl;
  return 'https://timesheet.timevex.com';
}

async function sendOnboardingInviteAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  'use server';

  const { tenantId, session } = await ensureAdminSession();
  const email = parseString(formData.get('invite_email'));
  const firstName = parseString(formData.get('invite_first_name'));
  const lastName = parseString(formData.get('invite_last_name'));
  const message = parseString(formData.get('invite_message'));
  const entryDate = parseString(formData.get('invite_entry_date'));
  const tarifGroup = parseString(formData.get('invite_tarif_group'));
  const employmentType = parseString(formData.get('invite_employment_type'));
  const workTimeModel = parseString(formData.get('invite_work_time_model'));
  const weeklyHoursRaw = parseString(formData.get('invite_weekly_hours'));
  const probationMonthsRaw = parseString(formData.get('invite_probation_months'));
  const compensationTypeRaw = parseString(formData.get('invite_compensation_type'));
  const hourlyWageRaw = parseString(formData.get('invite_hourly_wage'));
  const monthlySalaryRaw = parseString(formData.get('invite_monthly_salary_gross'));
  const vacationDaysRaw = parseString(formData.get('invite_vacation_days_total'));

  if (!email) {
    return { status: 'error', message: 'Bitte E-Mail-Adresse eingeben.' };
  }
  if (!entryDate || !tarifGroup || !employmentType || !workTimeModel) {
    return { status: 'error', message: 'Bitte alle Pflichtfelder für Vertragsdaten ausfüllen.' };
  }
  const probationMonths = probationMonthsRaw ? Number.parseFloat(probationMonthsRaw.replace(',', '.')) : Number.NaN;
  if (!Number.isFinite(probationMonths) || probationMonths < 0) {
    return { status: 'error', message: 'Probezeit (Monate) ist erforderlich.' };
  }
  const weeklyHours = weeklyHoursRaw ? Number.parseFloat(weeklyHoursRaw.replace(',', '.')) : Number.NaN;
  if (!Number.isFinite(weeklyHours) || weeklyHours <= 0 || weeklyHours > 168) {
    return { status: 'error', message: 'Std/Woche ist erforderlich.' };
  }
  const compensationType = compensationTypeRaw === 'fixed' ? 'fixed' : compensationTypeRaw === 'hourly' ? 'hourly' : null;
  if (!compensationType) {
    return { status: 'error', message: 'Bitte Vergütungsart auswählen.' };
  }
  const vacationDaysTotal = vacationDaysRaw ? Number.parseFloat(vacationDaysRaw.replace(',', '.')) : Number.NaN;
  if (!Number.isFinite(vacationDaysTotal) || vacationDaysTotal <= 0) {
    return { status: 'error', message: 'Urlaubstage/Jahr ist erforderlich.' };
  }
  const hourlyWage = hourlyWageRaw ? Number.parseFloat(hourlyWageRaw.replace(',', '.')) : null;
  const monthlySalaryGross = monthlySalaryRaw ? Number.parseFloat(monthlySalaryRaw.replace(',', '.')) : null;
  if (compensationType === 'hourly' && (!Number.isFinite(hourlyWage ?? Number.NaN) || (hourlyWage ?? 0) <= 0)) {
    return { status: 'error', message: 'Bitte Stundenlohn eintragen.' };
  }
  if (compensationType === 'fixed' && (!Number.isFinite(monthlySalaryGross ?? Number.NaN) || (monthlySalaryGross ?? 0) <= 0)) {
    return { status: 'error', message: 'Bitte Monatsgehalt Brutto eintragen.' };
  }

  const requestHeaders = await headers();
  const origin = resolveOriginFromHeaders(requestHeaders);

  try {
    const result = await createEmployeeOnboardingInvite({
      tenantId,
      createdByAdminId: Number.isFinite(session.user.id) ? session.user.id : null,
      email,
      firstName,
      lastName,
      message,
      adminPreset: {
        entryDate,
        tarifGroup,
        employmentType,
        workTimeModel,
        weeklyHours,
        probationMonths,
        compensationType,
        hourlyWage,
        monthlySalaryGross,
        vacationDaysTotal,
      },
      origin,
    });
    revalidatePath(withAppBasePath('/admin/mitarbeitende'));
    return {
      status: 'success',
      message: `Einladung an ${result.email} versendet (gültig bis ${result.expiresAt.toLocaleDateString('de-DE')}).`,
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Einladung konnte nicht versendet werden.',
    };
  }
}

async function deleteOnboardingInviteAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  'use server';

  const { tenantId } = await ensureAdminSession();
  const inviteIdRaw = parseString(formData.get('invite_id'));
  const inviteId = inviteIdRaw ? Number.parseInt(inviteIdRaw, 10) : Number.NaN;
  if (!Number.isFinite(inviteId) || inviteId <= 0) {
    return { status: 'error', message: 'Ungültige Personalbogen-ID.' };
  }

  try {
    await deleteEmployeeOnboardingInvite(tenantId, inviteId);
    revalidatePath(withAppBasePath('/admin/mitarbeitende'));
    return { status: 'success', message: 'Personalbogen-Einladung gelöscht.' };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Personalbogen konnte nicht gelöscht werden.',
    };
  }
}

export default async function AdminMitarbeitendePage() {
  const { tenantId } = await ensureAdminSession();
  const [employees, invites] = await Promise.all([
    getAdminEmployeeList(tenantId),
    listEmployeeOnboardingInvites(tenantId, 40),
  ]);
  const activeEmployees = employees.filter((employee) => employee.isActive);
  const inactiveEmployees = employees.filter((employee) => !employee.isActive);
  const onboardingInvites: OnboardingInviteListRow[] = invites.map((invite) => {
    const employeeDisplayName =
      invite.employeeFirstName || invite.employeeLastName
        ? [invite.employeeFirstName, invite.employeeLastName].filter(Boolean).join(' ')
        : null;
    return {
      id: invite.id,
      email: invite.email,
      firstName: invite.firstName,
      lastName: invite.lastName,
      createdAtLabel: invite.createdAt.toLocaleString('de-DE'),
      expiresAtLabel: invite.expiresAt.toLocaleString('de-DE'),
      usedAtLabel: invite.usedAt ? invite.usedAt.toLocaleString('de-DE') : null,
      status: invite.status,
      employeeDisplayName,
    };
  });

  return (
    <AdminEmployeeListClient
      activeEmployees={activeEmployees}
      inactiveEmployees={inactiveEmployees}
      onboardingInvites={onboardingInvites}
      toggleAction={toggleEmployeeActiveAction}
      toggleInitialState={TOGGLE_INITIAL_STATE}
      inviteAction={sendOnboardingInviteAction}
      inviteInitialState={TOGGLE_INITIAL_STATE}
      deleteInviteAction={deleteOnboardingInviteAction}
      deleteInviteInitialState={TOGGLE_INITIAL_STATE}
    />
  );
}
