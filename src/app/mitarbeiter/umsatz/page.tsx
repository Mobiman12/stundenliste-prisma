import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import { listDailyDayRecords } from '@/lib/data/daily-days';

type SearchParams = {
  year?: string;
};

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

const DECIMAL_FACTOR = 100;

type MonthSummary = {
  year: number;
  month: number;
  revenue: number;
  days: number;
  daysWithRevenue: number;
};

type YearSummary = {
  year: number;
  revenue: number;
  months: number;
  days: number;
  daysWithRevenue: number;
};

function parseYear(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundTwo(value: number): number {
  return Math.round(value * DECIMAL_FACTOR) / DECIMAL_FACTOR;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('de-DE').format(value);
}

function monthLabel(month: number): string {
  return MONTH_NAMES[Math.max(0, Math.min(11, month - 1))] ?? '';
}

export default async function MitarbeiterUmsatzPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const session = await getServerAuthSession();
  if (!session?.user) {
    redirect(withAppBasePath('/login?mode=employee'));
  }
  if (!session.user.employeeId) {
    redirect(withAppBasePath('/admin'));
  }

  const employeeId = session.user.employeeId;
  const resolvedSearchParams = await searchParams;
  const preferredYear = parseYear(resolvedSearchParams?.year);

  const records = await listDailyDayRecords(employeeId);
  const monthMap = new Map<string, MonthSummary>();

  for (const record of records) {
    const parsed = new Date(`${record.day_date}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) continue;
    const year = parsed.getFullYear();
    const month = parsed.getMonth() + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const brutto = Number(record.brutto ?? 0);
    const entry = monthMap.get(key) ?? {
      year,
      month,
      revenue: 0,
      days: 0,
      daysWithRevenue: 0,
    };
    entry.revenue += Number.isFinite(brutto) ? brutto : 0;
    entry.days += 1;
    if (brutto > 0) {
      entry.daysWithRevenue += 1;
    }
    monthMap.set(key, entry);
  }

  const yearMap = new Map<number, YearSummary>();
  for (const summary of monthMap.values()) {
    const entry = yearMap.get(summary.year) ?? {
      year: summary.year,
      revenue: 0,
      months: 0,
      days: 0,
      daysWithRevenue: 0,
    };
    entry.revenue += summary.revenue;
    entry.months += 1;
    entry.days += summary.days;
    entry.daysWithRevenue += summary.daysWithRevenue;
    yearMap.set(summary.year, entry);
  }

  const yearOptions = Array.from(yearMap.keys()).sort((a, b) => b - a);
  const selectedYear = preferredYear && yearOptions.includes(preferredYear) ? preferredYear : yearOptions[0];

  const monthlyRows = Array.from(monthMap.values())
    .filter((row) => row.year === selectedYear)
    .sort((a, b) => a.month - b.month)
    .map((row) => ({
      ...row,
      revenue: roundTwo(row.revenue),
      averagePerDay: row.daysWithRevenue > 0 ? roundTwo(row.revenue / row.daysWithRevenue) : 0,
    }));

  const yearlyRows = Array.from(yearMap.values())
    .sort((a, b) => b.year - a.year)
    .map((row) => ({
      ...row,
      revenue: roundTwo(row.revenue),
      averagePerMonth: row.months > 0 ? roundTwo(row.revenue / row.months) : 0,
    }));

  const selectedYearSummary = selectedYear ? yearMap.get(selectedYear) ?? null : null;
  const selectedTotals = selectedYearSummary
    ? {
        revenue: roundTwo(selectedYearSummary.revenue),
        averagePerMonth: selectedYearSummary.months > 0 ? roundTwo(selectedYearSummary.revenue / selectedYearSummary.months) : 0,
        averagePerDay:
          selectedYearSummary.daysWithRevenue > 0
            ? roundTwo(selectedYearSummary.revenue / selectedYearSummary.daysWithRevenue)
            : 0,
      }
    : null;

  const bestMonth =
    monthlyRows.length > 0
      ? monthlyRows.reduce((best, current) => (current.revenue > best.revenue ? current : best))
      : null;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold text-slate-900">Umsatzübersicht</h2>
        <p className="text-sm text-slate-500">
          Monats- und Jahresauswertungen werden aus den erfassten Tagesdaten ausgewertet.
        </p>
      </header>

      {yearOptions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Jahr</span>
          {yearOptions.map((year) => {
            const href = `/mitarbeiter/umsatz?year=${year}`;
            const isActive = year === selectedYear;
            return (
              <Link
                key={year}
                href={href}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  isActive ? 'bg-brand text-white' : 'border border-slate-200 bg-white text-slate-600 hover:text-slate-900'
                }`}
              >
                {year}
              </Link>
            );
          })}
        </div>
      ) : null}

      {selectedYear && selectedTotals ? (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Jahresumsatz</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{formatCurrency(selectedTotals.revenue)}</p>
            <p className="text-xs text-slate-500">Summe für {selectedYear}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ø Umsatz pro Monat</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{formatCurrency(selectedTotals.averagePerMonth)}</p>
            <p className="text-xs text-slate-500">Basierend auf {formatCount(selectedYearSummary?.months ?? 0)} Monaten</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ø Umsatz pro Tag</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{formatCurrency(selectedTotals.averagePerDay)}</p>
            <p className="text-xs text-slate-500">
              {formatCount(selectedYearSummary?.daysWithRevenue ?? 0)} Tage mit Umsatz
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h3 className="text-base font-semibold text-slate-900">Monatsübersicht</h3>
            {bestMonth ? (
              <p className="text-xs text-slate-500">
                Bester Monat: {monthLabel(bestMonth.month)} {bestMonth.year} ({formatCurrency(bestMonth.revenue)})
              </p>
            ) : null}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Monat</th>
                  <th className="px-4 py-3 text-right">Umsatz (Brutto)</th>
                  <th className="px-4 py-3 text-right">Tage mit Umsatz</th>
                  <th className="px-4 py-3 text-right">Ø Umsatz / Tag</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {monthlyRows.length > 0 ? (
                  monthlyRows.map((row) => (
                    <tr key={`${row.year}-${row.month}`}>
                      <td className="px-4 py-3 font-medium text-slate-900">{monthLabel(row.month)}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(row.revenue)}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{formatCount(row.daysWithRevenue)}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(row.averagePerDay)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-6 text-center text-slate-500" colSpan={4}>
                      Keine Umsatzdaten für dieses Jahr vorhanden.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h3 className="text-base font-semibold text-slate-900">Jahresübersicht</h3>
            <p className="text-xs text-slate-500">Gesamtumsatz je Jahr</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Jahr</th>
                  <th className="px-4 py-3 text-right">Umsatz</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {yearlyRows.length > 0 ? (
                  yearlyRows.map((row) => (
                    <tr key={row.year}>
                      <td className="px-4 py-3 font-medium text-slate-900">{row.year}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(row.revenue)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-6 text-center text-slate-500" colSpan={2}>
                      Noch keine Umsatzdaten vorhanden.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
