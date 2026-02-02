'use client';

import type { DailyOverviewEntry } from '@/lib/services/admin/employee';

export function DailyOverviewTable({
  entries,
  showMealColumn = false,
}: {
  entries: DailyOverviewEntry[];
  showMealColumn?: boolean;
}) {
  if (!entries.length) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
        Für den ausgewählten Zeitraum liegen keine Tagesdaten vor.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">Datum</th>
            <th className="px-4 py-2">Brutto (€)</th>
            <th className="px-4 py-2">Kommt 1</th>
            <th className="px-4 py-2">Geht 1</th>
            <th className="px-4 py-2">Kommt 2</th>
            <th className="px-4 py-2">Geht 2</th>
            <th className="px-4 py-2">Pause</th>
            {showMealColumn ? <th className="px-4 py-2">Verpflegung</th> : null}
            <th className="px-4 py-2">IST (h)</th>
            <th className="px-4 py-2">SOLL (h)</th>
            <th className="px-4 py-2">Code</th>
            <th className="px-4 py-2">Bemerkung</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {entries.map((entry) => {
            const codeDisplay = entry.codeDisplay || '—';
            const codeColorClass = entry.codeDisplay.startsWith('+Ü=')
              ? 'text-emerald-700'
              : entry.codeDisplay.startsWith('-Ü=')
                ? 'text-red-600'
                : 'text-slate-900';
            return (
              <tr key={entry.isoDate} className="hover:bg-slate-50">
                <td className="px-4 py-2 font-medium text-slate-900">{entry.displayDate}</td>
                <td className="px-4 py-2 text-slate-800">{entry.bruttoFormatted}</td>
                <td className="px-4 py-2 text-slate-900">{entry.kommt1 ?? '—'}</td>
                <td className="px-4 py-2 text-slate-900">{entry.geht1 ?? '—'}</td>
                <td className="px-4 py-2 text-slate-900">{entry.kommt2 ?? '—'}</td>
                <td className="px-4 py-2 text-slate-900">{entry.geht2 ?? '—'}</td>
                <td className="px-4 py-2 text-slate-900">{entry.pause ?? 'Keine'}</td>
                {showMealColumn ? (
                  <td className="px-4 py-2 text-slate-900">{entry.mittag ?? '—'}</td>
                ) : null}
                <td className="px-4 py-2 text-slate-900">{entry.istHours.toFixed(2).replace('.', ',')}</td>
                <td className="px-4 py-2 text-slate-900">{entry.sollHours.toFixed(2).replace('.', ',')}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-col">
                    <span className={codeColorClass}>
                      {codeDisplay}
                      {!entry.codeDisplay && entry.planStatus ? ' (Plan)' : ''}
                    </span>
                    {entry.planStatus ? (
                      <span className="text-xs text-slate-500">{entry.planStatus}</span>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-2 text-slate-800">{entry.remark ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
