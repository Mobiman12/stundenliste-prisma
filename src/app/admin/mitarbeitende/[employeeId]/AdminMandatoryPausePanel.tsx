'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormStatus } from 'react-dom';

import type { ActionState } from './types';
import { useActionRefresh } from './useRefreshEffect';

type PauseEntry = {
  weekday: number;
  minutes: number;
};

const WEEKDAY_LABELS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

type Props = {
  employeeId: number;
  schedule: PauseEntry[];
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  initialState: ActionState;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
    >
      {pending ? `${label}…` : label}
    </button>
  );
}

export default function AdminMandatoryPausePanel({ employeeId, schedule, action, initialState }: Props) {
  const router = useRouter();
  const [state, formAction] = useActionState(action, initialState);
  const [values, setValues] = useState<Record<number, string>>(() => {
    const map: Record<number, string> = {};
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const entry = schedule.find((item) => item.weekday === weekday);
      map[weekday] = String(entry?.minutes ?? 0);
    }
    return map;
  });

  useActionRefresh(state, () => router.refresh());

  useEffect(() => {
    const map: Record<number, string> = {};
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const entry = schedule.find((item) => item.weekday === weekday);
      map[weekday] = String(entry?.minutes ?? 0);
    }
    setValues(map);
  }, [schedule]);

  const payload = useMemo(() => {
    const entries = WEEKDAY_LABELS.map((_, weekday) => ({
      weekday,
      minutes: Math.max(0, Math.round(Number(values[weekday] ?? '0') || 0)),
    }));
    return JSON.stringify({ entries });
  }, [values]);

  const copyFromMonday = () => {
    const mondayValue = values[0] ?? '0';
    const next: Record<number, string> = {};
    for (let weekday = 0; weekday < 7; weekday += 1) {
      next[weekday] = weekday === 0 ? mondayValue : mondayValue;
    }
    setValues(next);
  };

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Pflichtpausen je Wochentag</h2>
          <p className="text-sm text-slate-500">
            Hinterlege hier die verpflichtende Pause pro Wochentag. Diese Werte gelten unabhängig vom Schichtplan als
            Richtlinie für die Tageserfassung.
          </p>
        </div>
        <button
          type="button"
          onClick={copyFromMonday}
          className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
        >
          Montag auf alle Tage übernehmen
        </button>
      </header>

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="employeeId" value={employeeId} />
        <input type="hidden" name="payload" value={payload} readOnly />
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {WEEKDAY_LABELS.map((label, weekday) => (
            <label key={weekday} className="flex flex-col gap-1 text-sm text-slate-700">
              <span>{label}</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={values[weekday] ?? '0'}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [weekday]: event.target.value }))
                  }
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
                />
                <span className="text-xs text-slate-500">Min</span>
              </div>
            </label>
          ))}
        </div>

        {state?.message ? (
          <div
            className={`rounded-md border px-3 py-2 text-sm ${
              state.status === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {state.message}
          </div>
        ) : null}

        <SubmitButton label="Pflichtpausen speichern" />
      </form>
    </section>
  );
}
