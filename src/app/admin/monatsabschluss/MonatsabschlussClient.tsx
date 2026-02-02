'use client';

import { useActionState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import type { ActionState } from '../mitarbeitende/[employeeId]/types';
import type { MonthlyClosingOverviewRow } from './page';

type OverviewStats = {
  openCount: number;
  closedCount: number;
  totalCount: number;
};

type Props = {
  rows: MonthlyClosingOverviewRow[];
  stats: OverviewStats;
  selectedYear: number;
  selectedMonth: number;
  yearOptions: number[];
  monthOptions: number[];
  closeEmployeeAction: (
    prevState: ActionState,
    formData: FormData
  ) => Promise<ActionState>;
  closeEmployeeInitialState: ActionState;
  reopenEmployeeAction: (
    prevState: ActionState,
    formData: FormData
  ) => Promise<ActionState>;
  reopenEmployeeInitialState: ActionState;
  closeAllAction: (
    prevState: ActionState,
    formData: FormData
  ) => Promise<ActionState>;
  closeAllInitialState: ActionState;
};

function formatTimestamp(value: string | null): string {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.toLocaleDateString('de-DE')} ${date.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  })} Uhr`;
}

function padMonth(value: number): string {
  return String(value).padStart(2, '0');
}

export default function MonatsabschlussClient({
  rows,
  stats,
  selectedYear,
  selectedMonth,
  yearOptions,
  monthOptions,
  closeEmployeeAction,
  closeEmployeeInitialState,
  reopenEmployeeAction,
  reopenEmployeeInitialState,
  closeAllAction,
  closeAllInitialState,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [closeEmployeeState, closeEmployeeFormAction] = useActionState(
    closeEmployeeAction,
    closeEmployeeInitialState
  );
  const [reopenEmployeeState, reopenEmployeeFormAction] = useActionState(
    reopenEmployeeAction,
    reopenEmployeeInitialState
  );
  const [closeAllState, closeAllFormAction] = useActionState(
    closeAllAction,
    closeAllInitialState
  );

  const feedback = closeAllState ?? closeEmployeeState ?? reopenEmployeeState;

  const handleYearChange = (year: string) => {
    const params = new URLSearchParams(searchParams?.toString());
    params.set('year', year);
    if (!params.has('month')) {
      params.set('month', padMonth(selectedMonth));
    }
    router.replace(`/admin/monatsabschluss?${params.toString()}`);
  };

  const handleMonthChange = (month: string) => {
    const params = new URLSearchParams(searchParams?.toString());
    params.set('month', month);
    if (!params.has('year')) {
      params.set('year', String(selectedYear));
    }
    router.replace(`/admin/monatsabschluss?${params.toString()}`);
  };

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Monatsabschluss</h1>
          <p className="text-sm text-slate-500">
            Schließe Monatswerte für alle Mitarbeitenden gesammelt ab oder öffne sie bei Bedarf wieder.
          </p>
        </div>
        <form action={closeAllFormAction} className="flex flex-col gap-2 md:flex-row md:items-center">
          <input type="hidden" name="year" value={selectedYear} />
          <input type="hidden" name="month" value={selectedMonth} />
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand/90"
          >
            Alle offenen Abschlüsse durchführen
          </button>
        </form>
      </header>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3 text-sm text-slate-700">
          <label className="flex items-center gap-2">
            <span>Jahr</span>
            <select
              value={selectedYear}
              onChange={(event) => handleYearChange(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1"
            >
              {[...new Set(yearOptions)].sort((a, b) => b - a).map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span>Monat</span>
            <select
              value={selectedMonth}
              onChange={(event) => handleMonthChange(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1"
            >
              {monthOptions.map((month) => (
                <option key={month} value={month}>
                  {padMonth(month)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-700">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1">
            Gesamt: {stats.totalCount}
          </span>
          <span className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
            Abgeschlossen: {stats.closedCount}
          </span>
          <span className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">
            Offen: {stats.openCount}
          </span>
        </div>
      </div>

      {feedback ? (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            feedback.status === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-red-200 bg-red-50 text-red-600'
          }`}
        >
          {feedback.message}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Mitarbeiter</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Abgeschlossen am</th>
              <th className="px-4 py-2">Bearbeitet durch</th>
              <th className="px-4 py-2 text-right">Aktion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rows.map((row) => {
              const isClosed = row.status === 'closed';
              return (
                <tr key={row.employeeId} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-slate-900">
                    <div className="flex flex-col">
                      <span className="font-medium">{row.displayName}</span>
                      {!row.isActive ? (
                        <span className="text-xs text-slate-500">Inaktiv</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
                        isClosed
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${
                          isClosed ? 'bg-emerald-500' : 'bg-amber-500'
                        }`}
                      />
                      {isClosed ? 'Abgeschlossen' : 'Offen'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-700">{formatTimestamp(row.closedAt)}</td>
                  <td className="px-4 py-2 text-slate-700">{row.closedBy ?? '–'}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-2">
                      {!isClosed ? (
                        <form action={closeEmployeeFormAction} className="inline-flex">
                          <input type="hidden" name="employeeId" value={row.employeeId} />
                          <input type="hidden" name="year" value={selectedYear} />
                          <input type="hidden" name="month" value={selectedMonth} />
                          <button
                            type="submit"
                            className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white shadow hover:bg-brand/90"
                          >
                            Abschließen
                          </button>
                        </form>
                      ) : (
                        <form action={reopenEmployeeFormAction} className="inline-flex">
                          <input type="hidden" name="employeeId" value={row.employeeId} />
                          <input type="hidden" name="year" value={selectedYear} />
                          <input type="hidden" name="month" value={selectedMonth} />
                          <button
                            type="submit"
                            className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                          >
                            Wieder öffnen
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
