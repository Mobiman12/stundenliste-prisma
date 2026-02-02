'use client';

import { useActionState, useMemo, useState } from 'react';

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

  const available = summary.bonus.available;
  const overtimeAvailable = summary.overtime.maxPayout;

  const previewCarry = useMemo(() => {
    const payout = toNumber(payoutInput);
    const sanitized = Math.min(Math.max(payout, 0), available);
    return roundTwo(Math.max(available - sanitized, 0));
  }, [available, payoutInput]);

  const overtimePreviewRemaining = useMemo(() => {
    const payout = toNumber(overtimeInput);
    const sanitized = Math.min(Math.max(payout, 0), overtimeAvailable);
    return roundTwo(Math.max(summary.overtime.available - sanitized, 0));
  }, [overtimeAvailable, overtimeInput, summary.overtime.available]);

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
                      min={0}
                      max={overtimeAvailable}
                      step={0.25}
                      value={overtimeInput}
                      onChange={(event) => setOvertimeInput(event.target.value)}
                      className="rounded-md border border-slate-300 px-3 py-2"
                    />
                    <span className="text-xs text-slate-500">
                      Verfügbar: {summary.overtime.available.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h
                    </span>
                    <span className="text-xs text-slate-500">
                      Rest nach Auszahlung: {overtimePreviewRemaining.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h
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
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
