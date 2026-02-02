import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import {
  getAdminEmployeeList,
  setEmployeeActive,
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
