'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';

import type { MonthlySummaryResult } from '@/lib/services/admin/employee-summary';

import type { ActionState } from './types';

type Props = {
  employeeId: number;
  summary: MonthlySummaryResult;
  preferencesAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  preferencesInitialState: ActionState;
  bonusAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  bonusInitialState: ActionState;
  overtimeAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  overtimeInitialState: ActionState;
  balanceAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  balanceInitialState: ActionState;
};

type SummaryGroupId = 'sales' | 'bonus' | 'worktime' | 'absences';

const GROUP_ORDER: SummaryGroupId[] = ['sales', 'bonus', 'worktime', 'absences'];

const GROUP_LABELS: Record<SummaryGroupId, string> = {
  sales: 'Umsatzkennzahlen',
  bonus: 'Umsatz-Bonus',
  worktime: 'Arbeitszeit & Überstunden',
  absences: 'Abwesenheiten & Zählwerte',
};

function toNumber(value: string): number {
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

export default function MonthlySummaryPanel({
  employeeId,
  summary,
  preferencesAction,
  preferencesInitialState,
  bonusAction,
  bonusInitialState,
  overtimeAction,
  overtimeInitialState,
  balanceAction,
  balanceInitialState,
}: Props) {
  const [visibility, setVisibility] = useState(summary.preferences);
  const [preferencesState, preferencesFormAction] = useActionState(
    preferencesAction,
    preferencesInitialState
  );
  const [bonusState, bonusFormAction] = useActionState(bonusAction, bonusInitialState);
  const [payoutInput, setPayoutInput] = useState(summary.bonus.paid.toFixed(2));
  const [overtimeState, overtimeFormAction] = useActionState(overtimeAction, overtimeInitialState);
  const [overtimeInput, setOvertimeInput] = useState(summary.overtime.paid.toFixed(2));
  const [balanceState, balanceFormAction] = useActionState(balanceAction, balanceInitialState);
  const [balanceInput, setBalanceInput] = useState('0.00');

  useEffect(() => {
    setPayoutInput(summary.bonus.paid.toFixed(2));
    setOvertimeInput(summary.overtime.paid.toFixed(2));
    setBalanceInput('0.00');
  }, [
    employeeId,
    summary.year,
    summary.month,
    summary.bonus.paid,
    summary.overtime.paid,
  ]);

  useEffect(() => {
    if (balanceState?.status === 'success') {
      setBalanceInput('0.00');
    }
  }, [balanceState?.status]);

  const available = summary.bonus.available;
  const overtimeMin = Number.isFinite(summary.overtime.minPayout) ? summary.overtime.minPayout : 0;
  const overtimeAvailable = summary.overtime.maxPayout;

  const previewCarry = useMemo(() => {
    const payout = toNumber(payoutInput);
    const sanitized = Math.min(Math.max(payout, 0), available);
    return roundTwo(Math.max(available - sanitized, 0));
  }, [available, payoutInput]);

  const overtimePreviewRemaining = useMemo(() => {
    const payout = toNumber(overtimeInput);
    const lower = Math.min(overtimeMin, overtimeAvailable);
    const upper = Math.max(overtimeMin, overtimeAvailable);
    const sanitized = Math.min(Math.max(payout, lower), upper);
    const delta = roundTwo(sanitized - summary.overtime.paid);
    return roundTwo(summary.overtime.currentBalance - delta);
  }, [overtimeMin, overtimeAvailable, overtimeInput, summary.overtime.currentBalance, summary.overtime.paid]);

  const balanceDelta = useMemo(() => roundTwo(toNumber(balanceInput)), [balanceInput]);
  const balancePreview = useMemo(
    () => roundTwo(summary.overtime.currentBalance + balanceDelta),
    [summary.overtime.currentBalance, balanceDelta]
  );

  const nudgeBalanceDelta = (step: number) => {
    setBalanceInput((current) => roundTwo(toNumber(current) + step).toFixed(2));
  };

  const handleToggle = (groupId: SummaryGroupId) => {
    setVisibility((current) => {
      const currentValue = current[groupId] ?? true;
      return {
        ...current,
        [groupId]: !currentValue,
      };
    });
  };

  return (
    <section className="space-y-6">
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Monatsübersicht</h2>
            <p className="text-sm text-slate-500">{summary.monthLabel}</p>
          </div>
          {preferencesState?.message ? (
            <span
              className={`text-sm ${
                preferencesState.status === 'success' ? 'text-emerald-700' : 'text-red-600'
              }`}
            >
              {preferencesState.message}
            </span>
          ) : null}
        </header>

        <form action={preferencesFormAction} className="space-y-3">
          <input type="hidden" name="employeeId" value={employeeId} />
          <input type="hidden" name="year" value={summary.year} />
          <input type="hidden" name="month" value={summary.month} />
          <input type="hidden" name="preferences" value={JSON.stringify(visibility)} />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {GROUP_ORDER.map((groupId) => (
              <label
                key={groupId}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              >
                <span>{GROUP_LABELS[groupId]}</span>
                <input
                  type="checkbox"
                  name={`toggle_${groupId}`}
                  checked={visibility[groupId] ?? true}
                  onChange={() => handleToggle(groupId)}
                  className="h-4 w-4"
                />
              </label>
            ))}
          </div>

          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand/90"
          >
            Ansicht speichern
          </button>
        </form>
      </div>

      {GROUP_ORDER.map((groupId) => {
        if (!(visibility[groupId] ?? true)) {
          return null;
        }
        const group = summary.groups.find((item) => item.id === groupId);
        if (!group) {
          return null;
        }

        const isBonusGroup = group.id === 'bonus';
        const isWorktimeGroup = group.id === 'worktime';

        return (
          <div
            key={group.id}
            className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h3 className="text-lg font-semibold text-slate-900">{group.title}</h3>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {group.metrics.map((metric) => (
                <div
                  key={metric.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {metric.label}
                  </dt>
                  <dd className="text-base font-medium text-slate-900">{metric.value}</dd>
                </div>
              ))}
            </dl>

            {isBonusGroup ? (
              <form action={bonusFormAction} className="space-y-3">
                <input type="hidden" name="employeeId" value={employeeId} />
                <input type="hidden" name="year" value={summary.year} />
                <input type="hidden" name="month" value={summary.month} />

                <div className="grid gap-4 md:max-w-md">
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>Ausgezahlter Bonus ({summary.bonus.currentMonthLabel})</span>
                    <input
                      name="payout"
                      type="number"
                      min={0}
                      max={summary.bonus.maxPayout}
                      step={0.5}
                      value={payoutInput}
                      onChange={(event) => setPayoutInput(event.target.value)}
                      className="rounded-md border border-slate-300 px-3 py-2"
                    />
                    <span className="text-xs text-slate-500">
                      Verfügbar: {summary.bonus.available.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                    </span>
                    <span className="text-xs text-slate-500">
                      Neuer Übertrag: {previewCarry.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € → {summary.bonus.nextMonthLabel}
                    </span>
                  </label>
                </div>

                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand/90"
                >
                  Bonus-Auszahlung sichern
                </button>

                {bonusState?.message ? (
                  <p
                    className={`text-sm ${
                      bonusState.status === 'success' ? 'text-emerald-700' : 'text-red-600'
                    }`}
                  >
                    {bonusState.message}
                  </p>
                ) : null}
              </form>
            ) : null}
            {isWorktimeGroup ? (
              <div className="space-y-4">
                <form action={balanceFormAction} className="space-y-3">
                  <input type="hidden" name="employeeId" value={employeeId} />
                  <input type="hidden" name="year" value={summary.year} />
                  <input type="hidden" name="month" value={summary.month} />

                  <div className="grid gap-4 md:max-w-md">
                    <label className="flex flex-col gap-1 text-sm text-slate-700">
                      <span>Aktuelles Stundenkonto korrigieren (Delta)</span>
                      <div className="inline-flex w-full overflow-hidden rounded-md border border-slate-300 bg-white">
                        <button
                          type="button"
                          onClick={() => nudgeBalanceDelta(-0.25)}
                          className="min-w-11 border-r border-slate-300 px-3 py-2 text-lg font-semibold text-slate-700 hover:bg-slate-100"
                          aria-label="Stundenkonto um 0,25 reduzieren"
                        >
                          -
                        </button>
                        <input
                          name="adjustmentDelta"
                          type="number"
                          step={0.25}
                          value={balanceInput}
                          onChange={(event) => setBalanceInput(event.target.value)}
                          className="w-full border-0 px-3 py-2 text-center text-sm text-slate-900 focus:outline-none focus:ring-0"
                        />
                        <button
                          type="button"
                          onClick={() => nudgeBalanceDelta(0.25)}
                          className="min-w-11 border-l border-slate-300 px-3 py-2 text-lg font-semibold text-slate-700 hover:bg-slate-100"
                          aria-label="Stundenkonto um 0,25 erhöhen"
                        >
                          +
                        </button>
                      </div>
                      <span className="text-xs text-slate-500">
                        Aktueller Kontostand: {summary.overtime.currentBalance.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h
                      </span>
                      <span className="text-xs text-slate-500">
                        Vorschau nach Korrektur: {balancePreview.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h
                      </span>
                      <span className="text-xs text-slate-500">
                        Korrektursaldo gesamt: {summary.overtime.manualCorrection.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h
                      </span>
                    </label>
                  </div>

                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand/90"
                  >
                    Stundenkonto speichern
                  </button>

                  {balanceState?.message ? (
                    <p
                      className={`text-sm ${
                        balanceState.status === 'success' ? 'text-emerald-700' : 'text-red-600'
                      }`}
                    >
                      {balanceState.message}
                    </p>
                  ) : null}
                </form>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <h4 className="text-sm font-semibold text-slate-900">Protokoll: Stundenkonto-Korrekturen</h4>
                  {summary.overtime.adjustments.length ? (
                    <div className="mt-3 overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200 text-xs text-slate-700">
                        <thead className="bg-white text-[11px] uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-2 py-1 text-left font-semibold">Zeitpunkt</th>
                            <th className="px-2 py-1 text-right font-semibold">Delta</th>
                            <th className="px-2 py-1 text-right font-semibold">Vorher</th>
                            <th className="px-2 py-1 text-right font-semibold">Nachher</th>
                            <th className="px-2 py-1 text-left font-semibold">Admin</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 bg-white">
                          {summary.overtime.adjustments.map((entry) => (
                            <tr key={entry.id}>
                              <td className="px-2 py-1">
                                {new Date(entry.createdAt).toLocaleString('de-DE', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </td>
                              <td className="px-2 py-1 text-right">
                                {entry.deltaHours.toLocaleString('de-DE', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                h
                              </td>
                              <td className="px-2 py-1 text-right">
                                {entry.balanceBefore.toLocaleString('de-DE', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                h
                              </td>
                              <td className="px-2 py-1 text-right">
                                {entry.balanceAfter.toLocaleString('de-DE', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                h
                              </td>
                              <td className="px-2 py-1">{entry.createdByAdminName || 'Admin'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">
                      Noch keine Stundenkonto-Korrekturen protokolliert.
                    </p>
                  )}
                </div>

                <form action={overtimeFormAction} className="space-y-3">
                  <input type="hidden" name="employeeId" value={employeeId} />
                  <input type="hidden" name="year" value={summary.year} />
                  <input type="hidden" name="month" value={summary.month} />

                  <div className="grid gap-4 md:max-w-md">
                    <label className="flex flex-col gap-1 text-sm text-slate-700">
                      <span>Ausgezahlte Überstunden ({summary.overtime.currentMonthLabel})</span>
                      <input
                        name="payoutHours"
                        type="number"
                        min={Math.min(overtimeMin, overtimeAvailable)}
                        max={overtimeAvailable}
                        step={0.25}
                        value={overtimeInput}
                        onChange={(event) => setOvertimeInput(event.target.value)}
                        className="rounded-md border border-slate-300 px-3 py-2"
                      />
                      <span className="text-xs text-slate-500">
                        Korridor: {Math.min(overtimeMin, overtimeAvailable).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h bis {Math.max(overtimeMin, overtimeAvailable).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h
                      </span>
                      <span className="text-xs text-slate-500">
                        Kontostand nach Auszahlung: {overtimePreviewRemaining.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h
                      </span>
                    </label>
                  </div>

                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand/90"
                  >
                    Überstunden-Auszahlung sichern
                  </button>

                  {overtimeState?.message ? (
                    <p
                      className={`text-sm ${
                        overtimeState.status === 'success' ? 'text-emerald-700' : 'text-red-600'
                      }`}
                    >
                      {overtimeState.message}
                    </p>
                  ) : null}
                </form>
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
