'use client';

import { useMemo } from 'react';

import type {
  MonthlyClosingHistoryItem,
  MonthlyClosingState,
} from '@/lib/services/admin/monthly-closing';

import type { ActionState } from './types';

const MONTH_NAMES = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

type Props = {
  employeeId: number;
  selectedYear: number;
  selectedMonth: number;
  closing: MonthlyClosingState;
  history: MonthlyClosingHistoryItem[];
  closeAction: (formData: FormData) => void;
  closeState: ActionState;
  reopenAction: (formData: FormData) => void;
  reopenState: ActionState;
};

function formatMonthLabel(year: number, month: number): string {
  const index = month - 1;
  const name = MONTH_NAMES[index] ?? '';
  return name ? `${name} ${year}` : `${String(month).padStart(2, '0')}.${year}`;
}

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

export default function MonthlyClosingPanel({
  employeeId,
  selectedYear,
  selectedMonth,
  closing,
  history,
  closeAction,
  closeState,
  reopenAction,
  reopenState,
}: Props) {
  const monthLabel = useMemo(
    () => formatMonthLabel(selectedYear, selectedMonth),
    [selectedYear, selectedMonth]
  );

  const feedback = closeState ?? reopenState;
  const isClosed = closing.status === 'closed';

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Monatsabschluss</h2>
          <p className="text-sm text-slate-500">
            Status für {monthLabel}. Schließe den Monat ab, sobald alle Tagesdaten geprüft sind.
          </p>
        </div>
        <div
          className={`inline-flex items-center gap-2 rounded-md border px-3 py-1 text-sm font-medium ${
            isClosed
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-slate-200 bg-slate-50 text-slate-700'
          }`}
        >
          <span>Status:</span>
          <span>{isClosed ? 'Abgeschlossen' : 'Offen'}</span>
        </div>
      </header>

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

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <p>
            <span className="font-semibold text-slate-900">Letzte Aktion:</span>{' '}
            {isClosed ? 'Monat abgeschlossen' : 'Monat offen'}
          </p>
          <p>
            <span className="font-semibold text-slate-900">Zeitpunkt:</span> {formatTimestamp(closing.closedAt)}
          </p>
          <p>
            <span className="font-semibold text-slate-900">Bearbeitet durch:</span>{' '}
            {closing.closedBy ?? '–'}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {!isClosed ? (
            <form action={closeAction} className="space-y-2">
              <input type="hidden" name="employeeId" value={employeeId} />
              <input type="hidden" name="year" value={selectedYear} />
              <input type="hidden" name="month" value={selectedMonth} />
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand/90"
              >
                Monat {monthLabel} abschließen
              </button>
              <p className="text-xs text-slate-500">
                Schließt den Monat und vermerkt den Namen sowie Zeitstempel. Tagesänderungen sollten anschließend
                nur in Ausnahmefällen erfolgen.
              </p>
            </form>
          ) : (
            <form action={reopenAction} className="space-y-2">
              <input type="hidden" name="employeeId" value={employeeId} />
              <input type="hidden" name="year" value={selectedYear} />
              <input type="hidden" name="month" value={selectedMonth} />
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                Monat wieder öffnen
              </button>
              <p className="text-xs text-slate-500">
                Hebt den Abschluss auf, damit Korrekturen möglich sind. Anschließend bitte erneut abschließen.
              </p>
            </form>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Verlauf der letzten Monate
        </h3>
        {history.length ? (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Monat</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Abgeschlossen am</th>
                  <th className="px-3 py-2">Durch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {history.map((item) => (
                  <tr key={`${item.year}-${item.month}`} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {formatMonthLabel(item.year, item.month)}
                    </td>
                    <td className="px-3 py-2 text-slate-800">
                      {item.status === 'closed' ? 'Abgeschlossen' : 'Offen'}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{formatTimestamp(item.closedAt)}</td>
                    <td className="px-3 py-2 text-slate-700">{item.closedBy ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
            Es liegen noch keine Monatsabschlüsse vor.
          </p>
        )}
      </div>
    </section>
  );
}
