import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import { getAdminEmployeeList } from '@/lib/services/admin/employee';
import {
  closeMonthlyClosing,
  getMonthlyClosingState,
  reopenMonthlyClosing,
} from '@/lib/services/admin/monthly-closing';
import { listClosingYears } from '@/lib/data/monthly-closings';

import MonatsabschlussClient from './MonatsabschlussClient';
import type { ActionState } from '../mitarbeitende/[employeeId]/types';

type SearchParams = {
  year?: string;
  month?: string;
};

export type MonthlyClosingOverviewRow = {
  employeeId: number;
  displayName: string;
  isActive: boolean;
  status: 'open' | 'closed';
  closedAt: string | null;
  closedBy: string | null;
};

type OverviewStats = {
  openCount: number;
  closedCount: number;
  totalCount: number;
};

async function ensureAdminSession() {
  const session = await getServerAuthSession();
  if (!session) {
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

function parseParam(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getSelectedYearMonth(searchParams?: SearchParams): { year: number; month: number } {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const preferredYear = parseParam(searchParams?.year);
  const preferredMonth = parseParam(searchParams?.month);

  const year = preferredYear ?? currentYear;
  const month = preferredMonth && preferredMonth >= 1 && preferredMonth <= 12 ? preferredMonth : currentMonth;

  return { year, month };
}

function formatAdminName(session: Awaited<ReturnType<typeof getServerAuthSession>>): string {
  const first = session?.user?.firstName?.trim();
  const last = session?.user?.lastName?.trim();
  if (first || last) {
    return [first, last].filter(Boolean).join(' ');
  }
  return session?.user?.username ?? 'Admin';
}

export async function closeEmployeeMonthAction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  'use server';
  const { session, tenantId } = await ensureAdminSession();

  const employeeId = Number.parseInt(String(formData.get('employeeId') ?? ''), 10);
  const year = Number.parseInt(String(formData.get('year') ?? ''), 10);
  const month = Number.parseInt(String(formData.get('month') ?? ''), 10);

  if (!Number.isFinite(employeeId) || !Number.isFinite(year) || !Number.isFinite(month)) {
    return { status: 'error', message: 'Parameter fehlen für den Monatsabschluss.' };
  }

  const employees = await getAdminEmployeeList(tenantId);
  if (!employees.some((employee) => employee.id === employeeId)) {
    return { status: 'error', message: 'Mitarbeiter nicht gefunden.' };
  }

  try {
    closeMonthlyClosing(employeeId, year, month, formatAdminName(session));
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error ? error.message : 'Monatsabschluss konnte nicht durchgeführt werden.',
    };
  }

  revalidatePath(withAppBasePath(`/admin/monatsabschluss?year=${year}&month=${String(month).padStart(2, '0')}`));
  return { status: 'success', message: 'Monat erfolgreich abgeschlossen.' };
}

export async function reopenEmployeeMonthAction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  'use server';
  const { tenantId } = await ensureAdminSession();

  const employeeId = Number.parseInt(String(formData.get('employeeId') ?? ''), 10);
  const year = Number.parseInt(String(formData.get('year') ?? ''), 10);
  const month = Number.parseInt(String(formData.get('month') ?? ''), 10);

  if (!Number.isFinite(employeeId) || !Number.isFinite(year) || !Number.isFinite(month)) {
    return { status: 'error', message: 'Parameter fehlen für die Wiedereröffnung.' };
  }

  const employees = await getAdminEmployeeList(tenantId);
  if (!employees.some((employee) => employee.id === employeeId)) {
    return { status: 'error', message: 'Mitarbeiter nicht gefunden.' };
  }

  try {
    reopenMonthlyClosing(employeeId, year, month);
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error ? error.message : 'Monatsabschluss konnte nicht wieder geöffnet werden.',
    };
  }

  revalidatePath(withAppBasePath(`/admin/monatsabschluss?year=${year}&month=${String(month).padStart(2, '0')}`));
  return { status: 'success', message: 'Monat wieder geöffnet.' };
}

export async function closeAllMonthAction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  'use server';
  const { session, tenantId } = await ensureAdminSession();

  const year = Number.parseInt(String(formData.get('year') ?? ''), 10);
  const month = Number.parseInt(String(formData.get('month') ?? ''), 10);

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return { status: 'error', message: 'Auswahl des Monats fehlt.' };
  }

  const employees = await getAdminEmployeeList(tenantId);
  const adminName = formatAdminName(session);
  let processed = 0;

  for (const employee of employees) {
    const state = getMonthlyClosingState(employee.id, year, month);
    if (state.status !== 'closed') {
      closeMonthlyClosing(employee.id, year, month, adminName);
      processed += 1;
    }
  }

  revalidatePath(withAppBasePath(`/admin/monatsabschluss?year=${year}&month=${String(month).padStart(2, '0')}`));
  if (processed === 0) {
    return { status: 'success', message: 'Alle ausgewählten Monate waren bereits abgeschlossen.' };
  }
  return { status: 'success', message: `${processed} Abschluss${processed === 1 ? '' : 'e'} durchgeführt.` };
}

function buildOverviewRows(employees: Awaited<ReturnType<typeof getAdminEmployeeList>>, year: number, month: number) {
  const rows: MonthlyClosingOverviewRow[] = [];

  for (const employee of employees) {
    const closing = getMonthlyClosingState(employee.id, year, month);
    rows.push({
      employeeId: employee.id,
      displayName: employee.displayName,
      isActive: employee.isActive,
      status: closing.status,
      closedAt: closing.closedAt,
      closedBy: closing.closedBy,
    });
  }

  return rows;
}

function computeStats(rows: MonthlyClosingOverviewRow[]): OverviewStats {
  const closedCount = rows.filter((row) => row.status === 'closed').length;
  const totalCount = rows.length;
  const openCount = totalCount - closedCount;

  return { openCount, closedCount, totalCount };
}

export default async function MonatsabschlussPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const { tenantId } = await ensureAdminSession();

  const resolved = searchParams ? await searchParams : undefined;
  const { year, month } = getSelectedYearMonth(resolved);
  const employees = await getAdminEmployeeList(tenantId);
  const rows = buildOverviewRows(employees, year, month);
  const stats = computeStats(rows);

  const yearOptions = listClosingYears();
  if (!yearOptions.includes(year)) {
    yearOptions.push(year);
  }
  yearOptions.sort((a, b) => b - a);

  const monthOptions = Array.from({ length: 12 }, (_, index) => index + 1);

  return (
    <MonatsabschlussClient
      rows={rows}
      stats={stats}
      selectedYear={year}
      selectedMonth={month}
      yearOptions={yearOptions}
      monthOptions={monthOptions}
      closeEmployeeAction={closeEmployeeMonthAction}
      closeEmployeeInitialState={null}
      reopenEmployeeAction={reopenEmployeeMonthAction}
      reopenEmployeeInitialState={null}
      closeAllAction={closeAllMonthAction}
      closeAllInitialState={null}
    />
  );
}
