import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import { getAdminEmployeeList } from '@/lib/services/admin/employee';
import {
  closeMonthlyClosing,
  getMonthlyClosingStates,
  reopenMonthlyClosing,
  assertMonthlyClosingAllowed,
} from '@/lib/services/admin/monthly-closing';
import { listClosingYears } from '@/lib/data/monthly-closings';

import MonatsabschlussClient from './MonatsabschlussClient';
import type { ActionState } from '../mitarbeitende/[employeeId]/types';

type SearchParams = {
  year?: string;
  month?: string;
  employeeStatus?: string;
};

export type MonthlyClosingEmployeeStatusFilter = 'all' | 'active' | 'inactive';

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

function getSelectedEmployeeStatus(searchParams?: SearchParams): MonthlyClosingEmployeeStatusFilter {
  const value = searchParams?.employeeStatus?.trim().toLowerCase();
  if (value === 'active' || value === 'inactive') {
    return value;
  }
  return 'all';
}

function formatAdminName(session: Awaited<ReturnType<typeof getServerAuthSession>>): string {
  const first = session?.user?.firstName?.trim();
  const last = session?.user?.lastName?.trim();
  if (first || last) {
    return [first, last].filter(Boolean).join(' ');
  }
  return session?.user?.username ?? 'Admin';
}

async function closeEmployeeMonthAction(
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
    await closeMonthlyClosing(employeeId, year, month, formatAdminName(session));
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

async function reopenEmployeeMonthAction(
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
    await reopenMonthlyClosing(employeeId, year, month);
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

async function closeAllMonthAction(
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

  // Guard early so the action can't crash the page render if a month is not closable yet.
  try {
    assertMonthlyClosingAllowed(year, month);
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error ? error.message : 'Monatsabschlüsse konnten nicht durchgeführt werden.',
    };
  }

  const employees = await getAdminEmployeeList(tenantId);
  const adminName = formatAdminName(session);
  const states = await getMonthlyClosingStates(
    employees.map((employee) => employee.id),
    year,
    month
  );
  let processed = 0;

  for (const employee of employees) {
    const state = states.get(employee.id);
    if (state?.status !== 'closed') {
      try {
        await closeMonthlyClosing(employee.id, year, month, adminName);
      } catch (error) {
        return {
          status: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Monatsabschlüsse konnten nicht vollständig durchgeführt werden.',
        };
      }
      processed += 1;
    }
  }

  revalidatePath(withAppBasePath(`/admin/monatsabschluss?year=${year}&month=${String(month).padStart(2, '0')}`));
  if (processed === 0) {
    return { status: 'success', message: 'Alle ausgewählten Monate waren bereits abgeschlossen.' };
  }
  return { status: 'success', message: `${processed} Abschluss${processed === 1 ? '' : 'e'} durchgeführt.` };
}

async function buildOverviewRows(
  employees: Awaited<ReturnType<typeof getAdminEmployeeList>>,
  year: number,
  month: number
) {
  const rows: MonthlyClosingOverviewRow[] = [];
  const closingStates = await getMonthlyClosingStates(
    employees.map((employee) => employee.id),
    year,
    month
  );

  for (const employee of employees) {
    const closing = closingStates.get(employee.id) ?? {
      status: 'open' as const,
      closedAt: null,
      closedBy: null,
    };
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

function filterOverviewRows(
  rows: MonthlyClosingOverviewRow[],
  employeeStatus: MonthlyClosingEmployeeStatusFilter
): MonthlyClosingOverviewRow[] {
  if (employeeStatus === 'active') {
    return rows.filter((row) => row.isActive);
  }
  if (employeeStatus === 'inactive') {
    return rows.filter((row) => !row.isActive);
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
  const employeeStatus = getSelectedEmployeeStatus(resolved);
  const employees = await getAdminEmployeeList(tenantId);
  const rows = filterOverviewRows(await buildOverviewRows(employees, year, month), employeeStatus);
  const stats = computeStats(rows);

  const yearOptions = await listClosingYears();
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
      selectedEmployeeStatus={employeeStatus}
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
