'use client';

import { useMemo, useState } from 'react';

const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export type ShiftPlanDayInfo = {
  isoDate: string;
  start: string | null;
  end: string | null;
  pauseMinutes: number;
  label: string | null;
  code: string | null;
  isAvailable: boolean;
};

type Props = {
  days: ShiftPlanDayInfo[];
  initialDate: string;
  rangeStart: string;
  rangeEnd: string;
};

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function toIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfWeek(date: Date): Date {
  const clone = new Date(date);
  const weekday = clone.getDay();
  const diff = (weekday + 6) % 7; // Monday = 0
  clone.setDate(clone.getDate() - diff);
  clone.setHours(0, 0, 0, 0);
  return clone;
}

function addDays(baseIso: string, delta: number): string {
  const date = toDate(baseIso);
  date.setDate(date.getDate() + delta);
  return toIso(date);
}

function compareIso(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function monthOptions(rangeStart: string, rangeEnd: string) {
  const start = toDate(rangeStart);
  const end = toDate(rangeEnd);

  const options: Array<{ value: string; label: string }> = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const endCursor = new Date(end.getFullYear(), end.getMonth(), 1);

  while (cursor <= endCursor) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-01`;
    const label = cursor.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    options.push({ value: iso, label });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return options;
}

export default function EmployeeShiftPlanBoard({ days, initialDate, rangeStart, rangeEnd }: Props) {
  const dayMap = useMemo(() => {
    const map = new Map<string, ShiftPlanDayInfo>();
    for (const day of days) {
      map.set(day.isoDate, day);
    }
    return map;
  }, [days]);

  const todayIso = useMemo(() => toIso(new Date()), []);
  const initialWeekStart = toIso(startOfWeek(toDate(initialDate)));

  const [weekStart, setWeekStart] = useState(initialWeekStart);
  const [selectedMonth, setSelectedMonth] = useState(initialWeekStart.slice(0, 7));

  const options = useMemo(() => monthOptions(rangeStart, rangeEnd), [rangeStart, rangeEnd]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const iso = addDays(weekStart, index);
      return {
        isoDate: iso,
        info: dayMap.get(iso) ?? null,
      };
    });
  }, [weekStart, dayMap]);

  const weekLabel = useMemo(() => {
    const start = toDate(weekStart);
    const end = toDate(addDays(weekStart, 6));
    const formatter = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `${formatter.format(start)} – ${formatter.format(end)}`;
  }, [weekStart]);

  const canGoPrev = compareIso(weekStart, rangeStart) > 0;
  const lastWeekStart = toIso(startOfWeek(toDate(rangeEnd)));
  const canGoNext = compareIso(weekStart, lastWeekStart) < 0;

  const handleMonthChange = (standardIso: string) => {
    const date = toDate(standardIso);
    const weekStartIso = toIso(startOfWeek(date));
    setWeekStart(weekStartIso);
    setSelectedMonth(standardIso.slice(0, 7));
  };

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Kalenderwoche</p>
          <p className="text-lg font-semibold text-slate-900">{weekLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Monat
            <select
              value={selectedMonth}
              onChange={(event) => handleMonthChange(`${event.target.value}-01`)}
              className="ml-2 rounded-full border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            >
              {options.map((option) => (
                <option key={option.value} value={option.value.slice(0, 7)}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded-md border border-slate-200 px-3 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              if (!canGoPrev) return;
              setWeekStart(addDays(weekStart, -7));
            }}
            disabled={!canGoPrev}
          >
            Vorherige Woche
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-200 px-3 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              if (!canGoNext) return;
              setWeekStart(addDays(weekStart, 7));
            }}
            disabled={!canGoNext}
          >
            Nächste Woche
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {weekDays.map(({ isoDate, info }, index) => {
          const date = toDate(isoDate);
          const weekdayLabel = WEEKDAY_LABELS[index];
          const dateLabel = new Intl.DateTimeFormat('de-DE', {
            day: '2-digit',
            month: '2-digit',
          }).format(date);
          const isToday = isoDate === todayIso;

          const hasTime = Boolean(info?.start && info?.end && info.start !== '00:00' && info.end !== '00:00');
          const hasLabel = Boolean(info?.label && info.label.trim().length > 0);
          const isAbsence = Boolean(info) && !info?.isAvailable;

          let content = '';
          if (isAbsence) {
            content = info?.label ?? 'Abwesenheit';
          } else if (hasTime) {
            content = `${info?.start} – ${info?.end}`;
          } else if (hasLabel) {
            content = info?.label ?? '';
          }

          return (
            <div
              key={isoDate}
              className={`flex min-h-[140px] flex-col justify-between rounded-lg border px-4 py-3 transition ${
                isToday ? 'border-brand bg-brand/5 text-brand-900' : 'border-slate-200 bg-slate-50 text-slate-700'
              }`}
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {weekdayLabel} · {dateLabel}
                </p>
                {content ? <p className="mt-2 text-sm font-semibold">{content}</p> : null}
                {isAbsence && hasTime ? (
                  <p className="mt-1 text-xs text-slate-500">Plan: {info?.start} – {info?.end}</p>
                ) : null}
                {info && info.pauseMinutes > 0 && !isAbsence ? (
                  <p className="mt-1 text-xs text-slate-500">Pause: {info.pauseMinutes} Minuten</p>
                ) : null}
                {info?.code ? (
                  <span className="mt-2 inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    {info.code}
                  </span>
                ) : null}
              </div>
              <p className="text-[11px] text-slate-400">{isoDate}</p>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-slate-500">
        Anzeige umfasst den Zeitraum {rangeStart} bis {rangeEnd}. Für weiterführende Anpassungen wende dich bitte an den Admin.
      </p>
    </div>
  );
}
