import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { hashPassword } from '@/lib/auth';
import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import {
  createAdminEmployee,
  getAdminEmployeeList,
  setEmployeeActive,
  removeEmployee,
} from '@/lib/services/admin/employee';

import AdminEmployeeListClient from './AdminEmployeeListClient';
import type { ActionState } from './[employeeId]/types';

const TOGGLE_INITIAL_STATE: ActionState = null;

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

function parseNumber(value: FormDataEntryValue | null): number | null {
  if (value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

async function createEmployeeAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  'use server';
  const { tenantId } = await ensureAdminSession();

  const firstName = parseString(formData.get('first_name'));
  const lastName = parseString(formData.get('last_name'));
  const personnelNumber = parseString(formData.get('personnel_number'));
  const entryDate = parseString(formData.get('entry_date'));
  const username = parseString(formData.get('username'));
  const password = parseString(formData.get('password'));
  const bookingPin = parseString(formData.get('booking_pin'));
  const roleRaw = parseString(formData.get('role_id'));
  const mandatoryPauseRaw = parseString(formData.get('mandatory_pause_enabled'));
  const showInCalendarValues = formData.getAll('show_in_calendar').map((value) => String(value).toLowerCase());
  if (!firstName || !lastName || !personnelNumber || !entryDate || !username || !password || !bookingPin || !roleRaw) {
    return { status: 'error', message: 'Bitte alle Pflichtfelder ausfüllen.' };
  }

  if (!/^\d{4}$/.test(bookingPin)) {
    return { status: 'error', message: 'Die Buchungs-PIN muss aus genau 4 Ziffern bestehen.' };
  }

  const roleId = Number.parseInt(roleRaw, 10);
  if (!Number.isFinite(roleId) || roleId <= 0) {
    return { status: 'error', message: 'Ungültige Rolle gewählt.' };
  }

  const email = parseString(formData.get('email'));
  const phone = parseString(formData.get('phone'));
  const weeklyHours = parseNumber(formData.get('weekly_hours')) ?? undefined;
  const vacationDays = parseNumber(formData.get('vacation_days')) ?? undefined;
  const vacationDaysLastYear = parseNumber(formData.get('vacation_days_last_year')) ?? undefined;
  const vacationDaysTotal = parseNumber(formData.get('vacation_days_total')) ?? undefined;
  const mandatoryPauseEnabled = (mandatoryPauseRaw ?? 'Nein').toLowerCase() === 'ja';
  const showInCalendar = showInCalendarValues.some((value) => value === '1' || value === 'true' || value === 'on');

  let newEmployeeId: number | null = null;
  try {
    newEmployeeId = await createAdminEmployee(tenantId, {
      first_name: firstName,
      last_name: lastName,
      entry_date: entryDate,
      personnel_number: personnelNumber,
      booking_pin: bookingPin,
      username,
      passwordHash: hashPassword(password),
      role_id: roleId,
      email,
      phone,
      weekly_hours: weeklyHours,
      vacation_days: vacationDays,
      vacation_days_last_year: vacationDaysLastYear,
      vacation_days_total: vacationDaysTotal,
      mandatory_pause_enabled: mandatoryPauseEnabled,
      show_in_calendar: showInCalendar,
    });
  } catch (error) {
    if (newEmployeeId) {
      await removeEmployee(tenantId, newEmployeeId);
    }
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Mitarbeiter konnte nicht angelegt werden.',
    };
  }

  revalidatePath(withAppBasePath('/admin/mitarbeitende'));
  return { status: 'success', message: 'Mitarbeiter wurde angelegt.' };
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

export default async function AdminMitarbeitendePage() {
  const { tenantId } = await ensureAdminSession();
  const employees = await getAdminEmployeeList(tenantId);
  const activeEmployees = employees.filter((employee) => employee.isActive);
  const inactiveEmployees = employees.filter((employee) => !employee.isActive);

  return (
    <AdminEmployeeListClient
      activeEmployees={activeEmployees}
      inactiveEmployees={inactiveEmployees}
      toggleAction={toggleEmployeeActiveAction}
      toggleInitialState={TOGGLE_INITIAL_STATE}
    />
  );
}
