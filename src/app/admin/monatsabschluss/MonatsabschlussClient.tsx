'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { withAppBasePath } from '@/lib/routes';
import type { ActionState } from '../mitarbeitende/[employeeId]/types';
import type {
  MonthlyClosingEmployeeStatusFilter,
  MonthlyClosingOverviewRow,
} from './page';

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
  selectedEmployeeStatus: MonthlyClosingEmployeeStatusFilter;
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

function buildExportHref(
  year: number,
  month: number,
  format: 'csv' | 'xlsx' | 'pdf',
  employeeIds: number[]
): string {
  const query = new URLSearchParams({
    year: String(year),
    month: String(month),
    format,
  });
  if (employeeIds.length > 0) {
    query.set('employeeIds', employeeIds.join(','));
  }
  return withAppBasePath(`/api/admin/monthly-closing/export?${query.toString()}`, 'external');
}

export default function MonatsabschlussClient({
  rows,
  stats,
  selectedYear,
  selectedMonth,
  selectedEmployeeStatus,
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
  const closedEmployeeIds = useMemo(
    () =>
      rows
        .filter((row) => row.status === 'closed')
        .map((row) => row.employeeId)
        .sort((a, b) => a - b),
    [rows]
  );
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>(closedEmployeeIds);

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
  const allClosedSelected =
    closedEmployeeIds.length > 0 &&
    closedEmployeeIds.every((employeeId) => selectedEmployeeIds.includes(employeeId));

  useEffect(() => {
    setSelectedEmployeeIds(closedEmployeeIds);
  }, [closedEmployeeIds, selectedYear, selectedMonth]);

  const toggleEmployeeSelection = (employeeId: number) => {
    setSelectedEmployeeIds((prev) =>
      prev.includes(employeeId)
        ? prev.filter((value) => value !== employeeId)
        : [...prev, employeeId].sort((a, b) => a - b)
    );
  };

  const toggleSelectAllClosed = () => {
    setSelectedEmployeeIds(allClosedSelected ? [] : closedEmployeeIds);
  };

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

  const handleEmployeeStatusChange = (employeeStatus: MonthlyClosingEmployeeStatusFilter) => {
    const params = new URLSearchParams(searchParams?.toString());
    if (employeeStatus === 'all') {
      params.delete('employeeStatus');
    } else {
      params.set('employeeStatus', employeeStatus);
    }
    if (!params.has('year')) {
      params.set('year', String(selectedYear));
    }
    if (!params.has('month')) {
      params.set('month', padMonth(selectedMonth));
    }
    const query = params.toString();
    router.replace(query ? `/admin/monatsabschluss?${query}` : '/admin/monatsabschluss');
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
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand/90 md:w-auto"
          >
            Alle offenen Abschlüsse durchführen
          </button>
        </form>
      </header>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex w-full flex-col gap-3 text-sm text-slate-700 sm:w-auto sm:flex-row sm:items-center">
          <label className="flex items-center justify-between gap-2 sm:justify-start">
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
          <label className="flex items-center justify-between gap-2 sm:justify-start">
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
          <label className="flex items-center justify-between gap-2 sm:justify-start">
            <span>Mitarbeiter</span>
            <select
              value={selectedEmployeeStatus}
              onChange={(event) =>
                handleEmployeeStatusChange(event.target.value as MonthlyClosingEmployeeStatusFilter)
              }
              className="rounded-md border border-slate-300 px-3 py-1"
            >
              <option value="all">Alle</option>
              <option value="active">Aktive</option>
              <option value="inactive">Inaktive</option>
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
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="mr-2 inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
              checked={allClosedSelected}
              onChange={toggleSelectAllClosed}
              disabled={closedEmployeeIds.length === 0}
            />
            Alle auswählen
          </label>
          <a
            href={buildExportHref(selectedYear, selectedMonth, 'xlsx', selectedEmployeeIds)}
            className={`inline-flex items-center rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold ${
              selectedEmployeeIds.length > 0
                ? 'text-slate-700 hover:bg-slate-50'
                : 'pointer-events-none cursor-not-allowed text-slate-400'
            }`}
          >
            Export XLSX
          </a>
          <a
            href={buildExportHref(selectedYear, selectedMonth, 'csv', selectedEmployeeIds)}
            className={`inline-flex items-center rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold ${
              selectedEmployeeIds.length > 0
                ? 'text-slate-700 hover:bg-slate-50'
                : 'pointer-events-none cursor-not-allowed text-slate-400'
            }`}
          >
            Export CSV
          </a>
          <a
            href={buildExportHref(selectedYear, selectedMonth, 'pdf', selectedEmployeeIds)}
            className={`inline-flex items-center rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold ${
              selectedEmployeeIds.length > 0
                ? 'text-slate-700 hover:bg-slate-50'
                : 'pointer-events-none cursor-not-allowed text-slate-400'
            }`}
          >
            Export PDF
          </a>
        </div>
        <p className="w-full text-xs text-slate-500">
          Für den Export markiert: {selectedEmployeeIds.length} Mitarbeitende (nur abgeschlossene auswählbar).
        </p>
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

      <div className="space-y-3 sm:hidden">
        {rows.map((row) => {
          const isClosed = row.status === 'closed';
          return (
            <article key={`mobile-${row.employeeId}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <label className="mb-2 inline-flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                      checked={selectedEmployeeIds.includes(row.employeeId)}
                      onChange={() => toggleEmployeeSelection(row.employeeId)}
                      disabled={!isClosed}
                    />
                    Export
                  </label>
                  <h3 className="text-sm font-semibold text-slate-900">{row.displayName}</h3>
                  {!row.isActive ? <p className="text-xs text-slate-500">Inaktiv</p> : null}
                </div>
                <span
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
                    isClosed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${isClosed ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  {isClosed ? 'Abgeschlossen' : 'Offen'}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-slate-500">Abgeschlossen am</dt>
                <dd className="text-slate-700">{formatTimestamp(row.closedAt)}</dd>
                <dt className="text-slate-500">Bearbeitet durch</dt>
                <dd className="text-slate-700">{row.closedBy ?? '–'}</dd>
              </dl>
              <div className="mt-3 grid">
                {!isClosed ? (
                  <form action={closeEmployeeFormAction} className="grid">
                    <input type="hidden" name="employeeId" value={row.employeeId} />
                    <input type="hidden" name="year" value={selectedYear} />
                    <input type="hidden" name="month" value={selectedMonth} />
                    <button
                      type="submit"
                      className="rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white shadow hover:bg-brand/90"
                    >
                      Abschließen
                    </button>
                  </form>
                ) : (
                  <form action={reopenEmployeeFormAction} className="grid">
                    <input type="hidden" name="employeeId" value={row.employeeId} />
                    <input type="hidden" name="year" value={selectedYear} />
                    <input type="hidden" name="month" value={selectedMonth} />
                    <button
                      type="submit"
                      className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                    >
                      Wieder öffnen
                    </button>
                  </form>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm sm:block">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Export</th>
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
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                      checked={selectedEmployeeIds.includes(row.employeeId)}
                      onChange={() => toggleEmployeeSelection(row.employeeId)}
                      disabled={!isClosed}
                    />
                  </td>
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
