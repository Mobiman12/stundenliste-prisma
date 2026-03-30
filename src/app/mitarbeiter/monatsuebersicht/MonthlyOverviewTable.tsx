import type { EmployeeMonthlyOverviewEntry } from '@/lib/services/employee/monthly-overview';

const hoursFormatter = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const currencyFormatter = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type Props = {
  entries: EmployeeMonthlyOverviewEntry[];
};

export function MonthlyOverviewTable({ entries }: Props) {
  if (!entries.length) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 bg-white/70 px-4 py-6 text-sm text-slate-500">
        Für den ausgewählten Monat sind noch keine Einträge vorhanden.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">Datum</th>
            <th className="px-4 py-2">Kommt 1</th>
            <th className="px-4 py-2">Geht 1</th>
            <th className="px-4 py-2">Kommt 2</th>
            <th className="px-4 py-2">Geht 2</th>
            <th className="px-4 py-2">Pause</th>
            <th className="px-4 py-2">IST (h)</th>
            <th className="px-4 py-2">SOLL (h)</th>
            <th className="px-4 py-2">Δ Überstunden</th>
            <th className="px-4 py-2">Umsatz (Brutto)</th>
            <th className="px-4 py-2">Code</th>
            <th className="px-4 py-2">Bemerkung</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {entries.map((entry) => {
            const deltaClass =
              entry.overtimeDelta > 0.01
                ? 'text-emerald-700'
                : entry.overtimeDelta < -0.01
                  ? 'text-red-600'
                  : 'text-slate-900';

            return (
              <tr key={entry.isoDate} className="hover:bg-slate-50">
                <td className="px-4 py-2 font-medium text-slate-900">{entry.displayDate}</td>
                <td className="px-4 py-2 text-slate-800">{entry.kommt1 ?? '—'}</td>
                <td className="px-4 py-2 text-slate-800">{entry.geht1 ?? '—'}</td>
                <td className="px-4 py-2 text-slate-800">{entry.kommt2 ?? '—'}</td>
                <td className="px-4 py-2 text-slate-800">{entry.geht2 ?? '—'}</td>
                <td className="px-4 py-2 text-slate-800">{entry.pause ?? 'Keine'}</td>
                <td className="px-4 py-2 text-slate-900">{hoursFormatter.format(entry.istHours)}</td>
                <td className="px-4 py-2 text-slate-900">{hoursFormatter.format(entry.sollHours)}</td>
                <td className={`px-4 py-2 font-medium ${deltaClass}`}>
                  {hoursFormatter.format(entry.overtimeDelta)} h
                </td>
                <td className="px-4 py-2 text-slate-900">
                  {currencyFormatter.format(entry.brutto)}
                </td>
                <td className="px-4 py-2 text-slate-900">{entry.code || '—'}</td>
                <td className="px-4 py-2 text-slate-800">{entry.remark ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
