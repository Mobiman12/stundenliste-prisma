'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import type { EmployeeMonthlyOverview } from '@/lib/services/employee/monthly-overview';
import type { EmployeeMonthlySummary } from '@/lib/services/employee/monthly-summary';
import type { EntryActionState } from '../types';

import { MonthlyOverviewTable } from './MonthlyOverviewTable';

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

const countFormatter = new Intl.NumberFormat('de-DE', {
  maximumFractionDigits: 0,
});

const daysFormatter = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type BonusHistoryItem = {
  year: number;
  month: number;
  payout: number;
  carryOver: number;
};

type Props = {
  overview: EmployeeMonthlyOverview;
  summary: EmployeeMonthlySummary;
  bonusHistory: BonusHistoryItem[];
  bonusHistoryYears: number[];
  requestAction: (prevState: EntryActionState, formData: FormData) => Promise<EntryActionState>;
  requestInitialState: EntryActionState;
  overtimeRequestAction: (prevState: EntryActionState, formData: FormData) => Promise<EntryActionState>;
  overtimeRequestInitialState: EntryActionState;
};

function formatHours(value: number): string {
  return `${hoursFormatter.format(value)} h`;
}

function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

function formatCount(value: number): string {
  return countFormatter.format(value);
}

function formatDays(value: number): string {
  return `${daysFormatter.format(value)} Tage`;
}

function formatMonthYear(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}


export default function MonthlyOverviewClient({
  overview,
  summary,
  bonusHistory,
  bonusHistoryYears,
  requestAction,
  requestInitialState,
  overtimeRequestAction,
  overtimeRequestInitialState,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [showSales, setShowSales] = useState(true);
  const [showBonus, setShowBonus] = useState(true);
  const [showWorktime, setShowWorktime] = useState(true);
  const [historyYearFilter, setHistoryYearFilter] = useState<'all' | number>('all');

  const [requestAmount, setRequestAmount] = useState(
    summary.bonus.available > 0 ? summary.bonus.available.toFixed(2) : ''
  );
  const [requestNote, setRequestNote] = useState('');

  const [overtimeRequestHours, setOvertimeRequestHours] = useState(
    summary.worktime.availableForPayout > 0 ? summary.worktime.availableForPayout.toFixed(2) : ''
  );
  const [overtimeRequestNote, setOvertimeRequestNote] = useState('');

  const [requestState, requestFormAction] = useActionState(requestAction, requestInitialState);
  const [overtimeRequestState, overtimeRequestFormAction] = useActionState(
    overtimeRequestAction,
    overtimeRequestInitialState
  );

  const totals = overview.totals;
  const breakdown = overview.breakdown;

  const deltaClass = useMemo(() => {
    if (summary.worktime.difference > 0.05) return 'text-emerald-700';
    if (summary.worktime.difference < -0.05) return 'text-red-600';
    return 'text-slate-900';
  }, [summary.worktime.difference]);

  const overtimeClass = useMemo(() => {
    if (summary.worktime.overtimeDelta > 0.05) return 'text-emerald-700';
    if (summary.worktime.overtimeDelta < -0.05) return 'text-red-600';
    return 'text-slate-900';
  }, [summary.worktime.overtimeDelta]);

  useEffect(() => {
    setRequestAmount(summary.bonus.available > 0 ? summary.bonus.available.toFixed(2) : '');
  }, [summary.bonus.available]);

  useEffect(() => {
    setOvertimeRequestHours(
      summary.worktime.availableForPayout > 0
        ? summary.worktime.availableForPayout.toFixed(2)
        : ''
    );
  }, [summary.worktime.availableForPayout]);

  useEffect(() => {
    if (requestState?.status === 'success') {
      setRequestNote('');
    }
  }, [requestState]);

  useEffect(() => {
    if (overtimeRequestState?.status === 'success') {
      setOvertimeRequestNote('');
    }
  }, [overtimeRequestState]);

  const bonusAvailable = summary.bonus.available;
  const requestDisabled = bonusAvailable <= 0;
  const overtimeAvailable = summary.worktime.availableForPayout;
  const overtimeRemaining = summary.worktime.remaining;
  const overtimeRequestDisabled = overtimeAvailable <= 0.01;
  const historySelectValue = historyYearFilter === 'all' ? 'all' : String(historyYearFilter);
  const filteredHistory = useMemo(() => {
    if (historyYearFilter === 'all') {
      return bonusHistory;
    }
    return bonusHistory.filter((entry) => entry.year === historyYearFilter);
  }, [bonusHistory, historyYearFilter]);

  const handleYearChange = (year: string) => {
    const params = new URLSearchParams(searchParams?.toString());
    if (year) {
      params.set('year', year);
    } else {
      params.delete('year');
    }
    params.set('month', String(overview.selectedMonth));
    router.replace(`/mitarbeiter/monatsuebersicht?${params.toString()}`);
  };

  const handleMonthChange = (month: string) => {
    const params = new URLSearchParams(searchParams?.toString());
    if (month) {
      params.set('month', month);
    } else {
      params.delete('month');
    }
    params.set('year', String(overview.selectedYear));
    router.replace(`/mitarbeiter/monatsuebersicht?${params.toString()}`);
  };


  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold text-slate-900">Monatsübersicht</h2>
        <p className="text-sm text-slate-500">
          Zusammenfassung deiner erfassten Arbeitszeiten und Umsätze im ausgewählten Monat.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">Anzeigeoptionen</h3>
          <div className="space-y-2 text-sm text-slate-700">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                checked={showSales}
                onChange={() => setShowSales((prev) => !prev)}
              />
              Umsatzkennzahlen anzeigen?
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                checked={showBonus}
                onChange={() => setShowBonus((prev) => !prev)}
              />
              Umsatz-Bonus anzeigen?
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                checked={showWorktime}
                onChange={() => setShowWorktime((prev) => !prev)}
              />
              Arbeitszeit &amp; Überstunden anzeigen?
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm text-sm text-slate-700">
          <div className="min-w-[160px]">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Ausgewählter Zeitraum
            </p>
            <p className="text-base font-medium text-slate-900">{overview.monthLabel}</p>
          </div>
          <label className="flex items-center gap-2">
            <span>Jahr</span>
            <select
              value={overview.selectedYear}
              onChange={(event) => handleYearChange(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1 text-sm"
            >
              {overview.years.length ? (
                overview.years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))
              ) : (
                <option value={overview.selectedYear}>{overview.selectedYear}</option>
              )}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span>Monat</span>
            <select
              value={overview.selectedMonth}
              onChange={(event) => handleMonthChange(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1 text-sm"
            >
              {overview.months.length ? (
                overview.months.map((month) => (
                  <option key={month} value={month}>
                    {month.toString().padStart(2, '0')}
                  </option>
                ))
              ) : (
                <option value={overview.selectedMonth}>
                  {overview.selectedMonth.toString().padStart(2, '0')}
                </option>
              )}
            </select>
          </label>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Überstundenkonto (inkl. Vormonate)
          </p>
          <p
            className={`mt-2 text-2xl font-semibold ${
              summary.worktime.currentBalance > 0.01
                ? 'text-emerald-600'
                : summary.worktime.currentBalance < -0.01
                  ? 'text-red-600'
                  : 'text-slate-900'
            }`}
          >
            {formatHours(summary.worktime.currentBalance)}
          </p>
          <p className="text-xs text-slate-500">
            Stand bis {summary.sales.monthLabel}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Resturlaub gesamt
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {formatDays(summary.vacation.remainingDays)}
          </p>
          <p className="text-xs text-slate-500">
            Verfügbar im laufenden Jahr (inkl. Vorjahr)
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Erreichter Bonus ({summary.bonus.monthLabel})
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {formatCurrency(Math.max(summary.bonus.available, 0))}
          </p>
          <p className="text-xs text-slate-500">
            Verfügbar für Auszahlung (berechnet + Übertrag − Auszahlungen)
          </p>
        </div>
      </div>

      {showSales ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Umsatzkennzahlen</h3>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Monatlicher Mindestumsatz (Brutto)
              </dt>
              <dd className="text-base font-medium text-slate-900">
                {formatCurrency(summary.sales.monthlyTarget)}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Bisher erzielter Umsatz
              </dt>
              <dd className="text-base font-medium text-slate-900">
                {formatCurrency(summary.sales.monthlyRevenue)}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Plan-Arbeitstage ({summary.sales.monthLabel})
              </dt>
              <dd className="text-base font-medium text-slate-900">
                {formatCount(summary.sales.workdays)}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Bereits erfasste Tage (inkl. Urlaub/Krank)
              </dt>
              <dd className="text-base font-medium text-slate-900">
                {formatCount(summary.sales.recordedDays)}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Noch zu erfassen (Plan – Erfasst)
              </dt>
              <dd className="text-base font-medium text-slate-900">
                {formatCount(summary.sales.missingDays)}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Rest-Umsatz bis Monatsende
              </dt>
              <dd className="text-base font-medium text-slate-900">
                {formatCurrency(summary.sales.restRevenue)}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Urlaubstage gesamt (inkl. Vorjahr)
              </dt>
              <dd className="text-base font-medium text-slate-900">
                {formatDays(summary.vacation.totalDays)}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Urlaubstage genommen (bis {summary.sales.monthLabel})
              </dt>
              <dd className="text-base font-medium text-slate-900">
                {formatDays(summary.vacation.takenDays)}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Resturlaub
              </dt>
              <dd className="text-base font-medium text-slate-900">
                {formatDays(summary.vacation.remainingDays)}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}

      {showBonus ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Umsatz-Bonus</h3>
            <p className="text-sm text-slate-500">
              Übersicht über deinen Bonus für {summary.bonus.monthLabel}. Du kannst unten einen
              Auszahlungswunsch hinterlegen.
            </p>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Berechneter Bonus für {summary.bonus.monthLabel}
              </dt>
              <dd className="text-base font-medium text-slate-900">
                {formatCurrency(summary.bonus.calculated)}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Übertrag aus {summary.bonus.previousMonthLabel}
              </dt>
              <dd className="text-base font-medium text-slate-900">
                {formatCurrency(summary.bonus.previousCarry)}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Ausgezahlter Bonus ({summary.bonus.monthLabel})
              </dt>
              <dd className="text-base font-medium text-slate-900">
                {formatCurrency(summary.bonus.paid)}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Vorläufiger Übertrag in {summary.bonus.nextMonthLabel}
              </dt>
              <dd className="text-base font-medium text-slate-900">
                {formatCurrency(summary.bonus.carry)}
              </dd>
            </div>
          </dl>

          <form action={requestFormAction} className="space-y-3 rounded-lg border border-slate-100 bg-slate-50 p-4">
            <input type="hidden" name="year" value={overview.selectedYear} />
            <input type="hidden" name="month" value={overview.selectedMonth} />
            <div className="flex flex-col gap-1 text-sm">
              <label className="font-medium text-slate-900">
                Wunsch-Auszahlung ({summary.bonus.monthLabel})
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="number"
                  name="amount"
                  min={0}
                  step="0.01"
                  max={Math.max(summary.bonus.available, 0)}
                  value={requestAmount}
                  onChange={(event) => setRequestAmount(event.target.value)}
                  className="w-32 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  placeholder="0,00"
                  disabled={requestDisabled}
                  inputMode="decimal"
                  required
                />
                <span className="text-xs text-slate-500">
                  Verfügbar: {formatCurrency(summary.bonus.available)}
                </span>
              </div>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span>Anmerkung (optional)</span>
              <textarea
                name="note"
                rows={2}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                value={requestNote}
                onChange={(event) => setRequestNote(event.target.value)}
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
              disabled={requestDisabled}
            >
              Auszahlungswunsch speichern
            </button>
            {requestState ? (
              <p
                className={`text-sm ${
                  requestState.status === 'success' ? 'text-emerald-700' : 'text-red-600'
                }`}
              >
                {requestState.message}
              </p>
            ) : null}
            {requestDisabled ? (
              <p className="text-xs text-slate-500">
                Aktuell steht kein Bonus zur Verfügung. Sobald wieder ein positiver Betrag vorhanden ist,
                kannst du hier einen Auszahlungswunsch hinterlegen.
              </p>
            ) : null}
          </form>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-slate-900">
                Historie deines ausgezahlten Bonus
              </h4>
              {bonusHistoryYears.length ? (
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <span>Jahr</span>
                  <select
                    value={historySelectValue}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === 'all') {
                        setHistoryYearFilter('all');
                        return;
                      }
                      const parsed = Number.parseInt(value, 10);
                      setHistoryYearFilter(Number.isFinite(parsed) ? parsed : 'all');
                    }}
                    className="rounded-md border border-slate-300 px-2 py-1"
                  >
                    <option value="all">Alle Jahre</option>
                    {bonusHistoryYears.map((year) => (
                      <option key={year} value={String(year)}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            {filteredHistory.length ? (
              <ul className="space-y-2 text-sm text-slate-700">
                {filteredHistory.map((entry) => (
                  <li
                    key={`${entry.year}-${entry.month}`}
                    className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-slate-900">
                        {formatMonthYear(entry.year, entry.month)}
                      </span>
                      <span className="text-xs text-slate-500">
                        Ausgezahlt: {formatCurrency(entry.payout)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Übertrag in Folgemonat: {formatCurrency(entry.carryOver)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">
                Für die gewählte Auswahl liegen noch keine Bonus-Auszahlungen vor.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {showWorktime ? (
        <>
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">Arbeitszeit &amp; Überstunden</h3>
            <dl className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  SOLL Arbeitszeit ({summary.sales.monthLabel})
                </dt>
                <dd className="text-base font-medium text-slate-900">
                  {formatHours(summary.worktime.soll)}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  IST Arbeitszeit ({summary.sales.monthLabel})
                </dt>
                <dd className="text-base font-medium text-slate-900">
                  {formatHours(summary.worktime.ist)}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Differenz (IST - SOLL)
                </dt>
                <dd className={`text-base font-medium ${deltaClass}`}>
                  {formatHours(summary.worktime.difference)}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Überstunden-Delta im Monat
                </dt>
                <dd className={`text-base font-medium ${overtimeClass}`}>
                  {formatHours(summary.worktime.overtimeDelta)}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Ausgezahlte Überstunden
                </dt>
                <dd className="text-base font-medium text-slate-900">
                  {formatHours(summary.worktime.forcedOverflow)}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Aktuelles Gesamt-Stundenkonto
                </dt>
                <dd className="text-base font-medium text-slate-900">
                  {formatHours(summary.worktime.currentBalance)}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Ø IST-Stunden pro Tag
                </dt>
                <dd className="text-base font-medium text-slate-900">
                  {formatHours(totals.averageIstPerDay)}
                </dd>
              </div>
            </dl>

            <form
              action={overtimeRequestFormAction}
              className="space-y-3 rounded-lg border border-slate-100 bg-slate-50 p-4"
            >
              <input type="hidden" name="year" value={overview.selectedYear} />
              <input type="hidden" name="month" value={overview.selectedMonth} />
              <div className="flex flex-col gap-1 text-sm">
                <label className="font-medium text-slate-900">
                  Wunsch-Auszahlung Überstunden ({summary.sales.monthLabel})
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="number"
                    name="hours"
                    min={0}
                    max={Math.max(overtimeAvailable, 0)}
                    step="0.25"
                    value={overtimeRequestHours}
                    onChange={(event) => setOvertimeRequestHours(event.target.value)}
                    className="w-32 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                    placeholder="0,00"
                    disabled={overtimeRequestDisabled}
                    inputMode="decimal"
                    required
                  />
                  <span className="text-xs text-slate-500">
                    Verfügbar: {formatHours(overtimeAvailable)}
                  </span>
                  <span className="text-xs text-slate-500">
                    Reststunden: {formatHours(overtimeRemaining)}
                  </span>
                </div>
              </div>
              <label className="flex flex-col gap-1 text-sm">
                <span>Anmerkung (optional)</span>
                <textarea
                  name="note"
                  rows={2}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  value={overtimeRequestNote}
                  onChange={(event) => setOvertimeRequestNote(event.target.value)}
                  disabled={overtimeRequestDisabled}
                />
              </label>
              <button
                type="submit"
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
                disabled={overtimeRequestDisabled}
              >
                Auszahlungswunsch speichern
              </button>
              {overtimeRequestState ? (
                <p
                  className={`text-sm ${
                    overtimeRequestState.status === 'success' ? 'text-emerald-700' : 'text-red-600'
                  }`}
                >
                  {overtimeRequestState.message}
                </p>
              ) : null}
              {overtimeRequestDisabled ? (
                <p className="text-xs text-slate-500">
                  Aktuell stehen keine Überstunden zur Auszahlung zur Verfügung. Sobald dein Konto im Plus ist,
                  kannst du hier einen Auszahlungswunsch hinterlegen.
                </p>
              ) : null}
            </form>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">Sonderzeiten &amp; Abwesenheiten</h3>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Krank (KR)</dt>
                <dd className="text-base font-medium text-slate-900">
                  {formatHours(breakdown.sickHours)}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Kind krank (KK)
                </dt>
                <dd className="text-base font-medium text-slate-900">
                  {formatHours(breakdown.childSickHours)}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Kurzarbeit (KU)
                </dt>
                <dd className="text-base font-medium text-slate-900">
                  {formatHours(breakdown.shortWorkHours)}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Urlaub (U)
                </dt>
                <dd className="text-base font-medium text-slate-900">
                  {formatHours(breakdown.vacationHours)}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Feiertag (FT)
                </dt>
                <dd className="text-base font-medium text-slate-900">
                  {formatHours(breakdown.holidayHours)}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Ausgezahlte Überstunden
                </dt>
                <dd className="text-base font-medium text-slate-900">
                  {formatHours(breakdown.forcedOverflow)}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Mittag gezählt
                </dt>
                <dd className="text-base font-medium text-slate-900">
                  {formatCount(breakdown.mealCount)}
                </dd>
              </div>
            </dl>
          </div>

        </>
      ) : null}
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Tagesdetails</h3>
          <p className="text-sm text-slate-500">
            Alle erfassten Schichten im ausgewählten Monat inklusive Überstundendelta und Umsatz.
          </p>
        </div>
        <MonthlyOverviewTable entries={overview.entries} />
      </div>
    </section>
  );
}
