import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import { createBonusPayoutRequest } from '@/lib/data/bonus-payout-requests';
import { createOvertimePayoutRequest } from '@/lib/data/overtime-payout-requests';
import { listEmployeeBonusHistory } from '@/lib/data/employee-bonus';
import { getEmployeeMonthlyOverview } from '@/lib/services/employee/monthly-overview';
import { getEmployeeMonthlySummary } from '@/lib/services/employee/monthly-summary';

import MonthlyOverviewClient from './MonthlyOverviewClient';
import type { EntryActionState } from '../types';

type SearchParams = {
  year?: string;
  month?: string;
};

function parseParam(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default async function MitarbeiterMonatsuebersichtPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const session = await getServerAuthSession();
  if (!session?.user) {
    redirect(withAppBasePath('/login?mode=employee'));
  }

  if (!session.user.employeeId) {
    redirect(withAppBasePath('/admin'));
  }

  const tenantId = session.tenantId;
  if (!tenantId) {
    redirect(withAppBasePath('/login?mode=employee'));
  }

  const employeeId = session.user.employeeId;
  const resolvedSearchParams = await searchParams;
  const preferredYear = parseParam(resolvedSearchParams?.year);
  const preferredMonth = parseParam(resolvedSearchParams?.month);

  const overview = await getEmployeeMonthlyOverview(employeeId, preferredYear, preferredMonth);
  const summary = await getEmployeeMonthlySummary(tenantId, employeeId, overview);

  const bonusHistory = listEmployeeBonusHistory(employeeId, { limit: 240 });
  const bonusHistoryYears = Array.from(
    new Set(
      bonusHistory
        .map((entry) => entry.year)
        .filter((year): year is number => Number.isFinite(year))
    )
  ).sort((a, b) => b - a);

  async function requestBonusPayoutAction(
    _prevState: EntryActionState,
    formData: FormData
  ): Promise<EntryActionState> {
    'use server';

    const sessionForAction = await getServerAuthSession();
    if (!sessionForAction?.user?.employeeId || !sessionForAction.tenantId) {
      return { status: 'error', message: 'Sitzung ungültig. Bitte erneut anmelden.' };
    }

    const employeeIdForAction = sessionForAction.user.employeeId;
    const tenantIdForAction = sessionForAction.tenantId;
    const yearRaw = String(formData.get('year') ?? '').trim();
    const monthRaw = String(formData.get('month') ?? '').trim();
    const amountRaw = String(formData.get('amount') ?? '').replace(',', '.').trim();
    const noteRaw = String(formData.get('note') ?? '').trim();

    const year = Number.parseInt(yearRaw, 10);
    const month = Number.parseInt(monthRaw, 10);
    const amount = Number.parseFloat(amountRaw);

    if (!Number.isFinite(year) || !Number.isFinite(month)) {
      return { status: 'error', message: 'Zeitraum konnte nicht gelesen werden.' };
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return { status: 'error', message: 'Bitte gib einen positiven Betrag ein.' };
    }

    const overviewForAction = await getEmployeeMonthlyOverview(employeeIdForAction, year, month);
    const summaryForAction = await getEmployeeMonthlySummary(tenantIdForAction, employeeIdForAction, overviewForAction);

    if (amount > summaryForAction.bonus.available + 0.01) {
      return {
        status: 'error',
        message: 'Der gewünschte Betrag übersteigt den verfügbaren Bonus.',
      };
    }

    createBonusPayoutRequest({
      employeeId: employeeIdForAction,
      year,
      month,
      amount,
      note: noteRaw.length ? noteRaw : null,
    });

    revalidatePath(withAppBasePath('/mitarbeiter/monatsuebersicht'), 'page');

    return {
      status: 'success',
      message: 'Auszahlungswunsch wurde gespeichert und an die Verwaltung übermittelt.',
    };
  }

  async function requestOvertimePayoutAction(
    _prevState: EntryActionState,
    formData: FormData
  ): Promise<EntryActionState> {
    'use server';

    const sessionForAction = await getServerAuthSession();
    if (!sessionForAction?.user?.employeeId || !sessionForAction.tenantId) {
      return { status: 'error', message: 'Sitzung ungültig. Bitte erneut anmelden.' };
    }

    const employeeIdForAction = sessionForAction.user.employeeId;
    const tenantIdForAction = sessionForAction.tenantId;
    const yearRaw = String(formData.get('year') ?? '').trim();
    const monthRaw = String(formData.get('month') ?? '').trim();
    const hoursRaw = String(formData.get('hours') ?? '').replace(',', '.').trim();
    const noteRaw = String(formData.get('note') ?? '').trim();

    const year = Number.parseInt(yearRaw, 10);
    const month = Number.parseInt(monthRaw, 10);
    const hours = Number.parseFloat(hoursRaw);

    if (!Number.isFinite(year) || !Number.isFinite(month)) {
      return { status: 'error', message: 'Zeitraum konnte nicht gelesen werden.' };
    }

    if (!Number.isFinite(hours) || hours <= 0) {
      return { status: 'error', message: 'Bitte gib eine positive Stundenzahl ein.' };
    }

    const overviewForAction = await getEmployeeMonthlyOverview(employeeIdForAction, year, month);
    const summaryForAction = await getEmployeeMonthlySummary(tenantIdForAction, employeeIdForAction, overviewForAction);

    if (hours > summaryForAction.worktime.availableForPayout + 0.01) {
      return {
        status: 'error',
        message: 'Der gewünschte Wert übersteigt die verfügbaren Überstunden.',
      };
    }

    createOvertimePayoutRequest({
      employeeId: employeeIdForAction,
      year,
      month,
      hours,
      note: noteRaw.length ? noteRaw : null,
    });

    revalidatePath(withAppBasePath('/mitarbeiter/monatsuebersicht'), 'page');

    return {
      status: 'success',
      message: 'Auszahlungswunsch wurde gespeichert und an die Verwaltung übermittelt.',
    };
  }

  return (
    <MonthlyOverviewClient
      overview={overview}
      summary={summary}
      bonusHistory={bonusHistory}
      bonusHistoryYears={bonusHistoryYears}
      requestAction={requestBonusPayoutAction}
      requestInitialState={null}
      overtimeRequestAction={requestOvertimePayoutAction}
      overtimeRequestInitialState={null}
    />
  );
}
