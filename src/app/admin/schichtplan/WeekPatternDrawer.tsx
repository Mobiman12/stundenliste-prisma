'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import type { ChangeEvent } from 'react';

import type { EmployeeListItem } from '@/lib/data/employees';
import type { WeeklyShiftPlan, WeeklyShiftTemplate } from '@/lib/services/shift-plan';

type CreatePatternAction = (formData: FormData) => Promise<{ success: boolean; error?: string }>;

type WeekPatternDrawerProps = {
  open: boolean;
  week: WeeklyShiftPlan;
  employees: EmployeeListItem[];
  templates: WeeklyShiftTemplate[];
  onClose: () => void;
  onSaved: () => void;
  createAction: CreatePatternAction;
};

type DaySegmentState = {
  id: string;
  mode: 'available' | 'unavailable';
  start: string;
  end: string;
  pause: string;
  label: string;
};

type DayPatternState = {
  isoDate: string;
  weekday: string;
  weekdayIndex: number;
  segments: DaySegmentState[];
};

const DEFAULT_START = '';
const DEFAULT_END = '';
const DEFAULT_PAUSE_MINUTES = 30;
const DEFAULT_PAUSE = String(DEFAULT_PAUSE_MINUTES);
const DEFAULT_STATUS = 'Abwesend';

const STATUS_OPTIONS = [
  'Über-/Minusstundenkorrektur',
  'Krank',
  'Kind krank',
  'Kind krank Reststunden',
  'Krank Reststunden',
  'Kurzarbeit',
  'Urlaub',
  'Urlaub 1/2 Tag',
  'Feiertag',
  DEFAULT_STATUS,
];

const NO_WORK_LABEL = 'Kein Arbeitstag';
const NO_WORK_LABEL_LOWER = NO_WORK_LABEL.toLowerCase();
const isNoWorkLabel = (label: string | null | undefined): boolean =>
  (label ?? '').trim().toLowerCase() === NO_WORK_LABEL_LOWER;

const ensureTimeValue = (value: string | null | undefined, fallback: string): string =>
  value && value.trim().length ? value : fallback;

const createSegmentId = () => Math.random().toString(36).slice(2, 9);

const toMinutes = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':');
  if (parts.length !== 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
};

const hasOverlap = (segments: DaySegmentState[]): boolean => {
  const times = segments
    .filter((segment) => segment.mode === 'available')
    .map((segment) => {
      const start = toMinutes(segment.start);
      const end = toMinutes(segment.end);
      if (start == null || end == null || end <= start) return null;
      return { start, end };
    })
    .filter((entry): entry is { start: number; end: number } => Boolean(entry))
    .sort((a, b) => a.start - b.start);

  for (let i = 1; i < times.length; i += 1) {
    if (times[i - 1].end > times[i].start) {
      return true;
    }
  }
  return false;
};

export default function WeekPatternDrawer({
  open,
  week,
  employees,
  templates,
  onClose,
  onSaved,
  createAction,
}: WeekPatternDrawerProps) {
  const [selectedEmployees, setSelectedEmployees] = useState<number[]>([]);
  const [days, setDays] = useState<DayPatternState[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const resolveDefaultTimes = useCallback(() => ({ start: DEFAULT_START, end: DEFAULT_END }), []);

  const buildDayStates = useCallback(
    (template?: WeeklyShiftTemplate | null): DayPatternState[] => {
      const fallbackTemplate = template ?? null;
      return week.days.map((day) => {
        const weekdayIndex = (() => {
          const parsed = new Date(`${day.isoDate}T00:00:00`);
          if (Number.isNaN(parsed.getTime())) {
            return 0;
          }
          return (parsed.getDay() + 6) % 7;
        })();
        const templateDay = fallbackTemplate?.days.find((entry) => entry.weekday === weekdayIndex);
        const segments: DaySegmentState[] =
          templateDay?.segments.map((segment) => {
            const mode = segment.mode === 'unavailable' ? 'unavailable' : 'available';
            const labelRaw = segment.label?.trim() ?? '';
            const fallbackLabel = mode === 'unavailable' ? labelRaw || DEFAULT_STATUS : labelRaw;
            const start = ensureTimeValue(segment.start, DEFAULT_START);
            const end = ensureTimeValue(segment.end, DEFAULT_END);
            return {
              id: createSegmentId(),
              mode,
              start,
              end,
              pause: String(segment.requiredPauseMinutes ?? (mode === 'available' ? DEFAULT_PAUSE_MINUTES : 0)),
              label: fallbackLabel,
            };
          }) ?? [];

        return {
          isoDate: day.isoDate,
          weekday: `${day.weekdayShort}, ${day.dayLabel}`,
          weekdayIndex,
          segments,
        };
      });
    },
    [week.days]
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedEmployees(employees.length === 1 ? [employees[0].id] : []);
    setSelectedTemplateId('');
    setError(null);
    setDays(buildDayStates());
  }, [open, week, buildDayStates, employees]);


  const allSelected = useMemo(() => {
    if (!employees.length) return false;
    return selectedEmployees.length === employees.length;
  }, [employees.length, selectedEmployees]);

  const toggleEmployee = (id: number) => {
    setSelectedEmployees((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      }
      return [...prev, id];
    });
  };

  const toggleAllEmployees = () => {
    if (allSelected) {
      setSelectedEmployees([]);
    } else {
      setSelectedEmployees(employees.map((employee) => employee.id));
    }
  };

  const updateSegment = (isoDate: string, segmentId: string, patch: Partial<DaySegmentState>) => {
    setDays((prev) =>
      prev.map((day) => {
        if (day.isoDate !== isoDate) {
          return day;
        }

        const nextSegments = day.segments.map((segment) => {
          if (segment.id !== segmentId) return segment;
          const nextMode = patch.mode ?? segment.mode;
          let nextLabel = patch.label !== undefined ? patch.label : segment.label;

          if (nextMode === 'available') {
            nextLabel = '';
          } else if (nextMode === 'unavailable') {
            nextLabel = nextLabel?.trim() || DEFAULT_STATUS;
          }

          let nextStart = patch.start ?? segment.start;
          let nextEnd = patch.end ?? segment.end;

          if (nextMode === 'unavailable' && isNoWorkLabel(nextLabel)) {
            nextStart = '';
            nextEnd = '';
          } else {
            nextStart = ensureTimeValue(nextStart, DEFAULT_START);
            nextEnd = ensureTimeValue(nextEnd, DEFAULT_END);
          }

          return {
            ...segment,
            ...patch,
            mode: nextMode,
            label: nextLabel ?? '',
            start: nextStart ?? '',
            end: nextEnd ?? '',
          };
        });

        return { ...day, segments: nextSegments };
      })
    );
  };

  const removeSegment = (isoDate: string, segmentId: string) => {
    setDays((prev) =>
      prev.map((day) => {
        if (day.isoDate !== isoDate) return day;
        return {
          ...day,
          segments: day.segments.filter((segment) => segment.id !== segmentId),
        };
      })
    );
  };

  const addSegment = (isoDate: string) => {
    setDays((prev) =>
      prev.map((day) => {
        if (day.isoDate !== isoDate) return day;
        const defaults = resolveDefaultTimes();
        return {
          ...day,
          segments: [
            ...day.segments,
            {
              id: createSegmentId(),
              mode: 'available',
              start: defaults.start,
              end: defaults.end,
              pause: DEFAULT_PAUSE,
              label: '',
            },
          ],
        };
      })
    );
  };

  const applyTemplate = (templateId: number) => {
    const template = templates.find((entry) => entry.id === templateId);
    if (!template) {
      setSelectedTemplateId('');
      setDays(buildDayStates());
      return;
    }
    setSelectedTemplateId(templateId);
    setDays(buildDayStates(template));
  };

  const handleTemplateChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value.trim();
    if (value) {
      applyTemplate(Number(value));
    } else {
      setSelectedTemplateId('');
      setDays(buildDayStates());
    }
  };

  const handleSubmit = () => {
    if (!selectedEmployees.length) {
      setError('Bitte mindestens eine Ressource auswählen.');
      return;
    }

    const payload = {
      weekStart: week.weekStart,
      employees: selectedEmployees,
      days: days.map((day) => ({
        isoDate: day.isoDate,
        segments: day.segments.map((segment) => ({
          mode: segment.mode,
          start: segment.start,
          end: segment.end,
          pause: Number(segment.pause ?? '0') || 0,
          label: segment.label,
        })),
      })),
    };

    const formData = new FormData();
    formData.set('payload', JSON.stringify(payload));

    startTransition(() => {
      createAction(formData).then((result) => {
        if (result.success) {
          setError(null);
          onSaved();
        } else {
          setError(result.error ?? 'Speichern fehlgeschlagen.');
        }
      });
    });
  };

  const handleCancel = () => {
    if (isPending) return;
    onClose();
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-end bg-slate-900/40">
      <div className="flex h-full w-full max-w-xl flex-col overflow-hidden bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Wochenplan - Woche {week.weekNumber}
            </p>
            <h2 className="text-xl font-semibold text-slate-900">
              {week.days.length ? `${week.days[0].dayLabel} - ${week.days[week.days.length - 1].dayLabel}` : week.weekStart}
            </h2>
            <p className="mt-1 text-sm text-slate-500">Plane Verfügbarkeiten und Abwesenheiten für diese Woche.</p>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-500 hover:bg-slate-100"
            disabled={isPending}
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <section className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Ressourcen auswählen</h3>
              <p className="text-xs text-slate-500">Mehrere Mitarbeitende können gleichzeitig geplant werden.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAllEmployees}
                  className="h-4 w-4 rounded border-slate-300 text-sky-500"
                />
                Alle auswählen
              </label>
              <div className="mt-3 grid gap-2">
                {employees.map((employee) => (
                  <label key={employee.id} className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={selectedEmployees.includes(employee.id)}
                      onChange={() => toggleEmployee(employee.id)}
                      className="h-4 w-4 rounded border-slate-300 text-sky-500"
                    />
                    <span className="font-medium text-slate-700">{employee.displayName}</span>
                    <span className="text-xs text-slate-400">{employee.username}</span>
                  </label>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-6">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-slate-700">Vorlage anwenden</p>
              <select
                value={selectedTemplateId}
                onChange={handleTemplateChange}
                className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                disabled={isPending}
              >
                <option value="">Keine Vorlage</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
              {templates.length === 0 ? (
                <p className="mt-2 text-xs text-slate-400">
                  Noch keine Vorlagen vorhanden. Du kannst im Bereich &quot;Vorlagen verwalten&quot; neue Muster anlegen.
                </p>
              ) : null}
            </div>
          </section>

          <section className="mt-6 space-y-4">
            {days.map((day) => (
              <div key={day.isoDate} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-700">{day.weekday}</p>
                    <p className="text-xs text-slate-400">{day.isoDate}</p>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {day.segments.map((segment) => (
                    <div key={segment.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
                          <span className="text-xs text-slate-500">Verfügbar</span>
                          <button
                            type="button"
                            onClick={() =>
                              updateSegment(day.isoDate, segment.id, {
                                mode: segment.mode === 'available' ? 'unavailable' : 'available',
                              })
                            }
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                              segment.mode === 'available' ? 'bg-emerald-400' : 'bg-slate-300'
                            }`}
                            disabled={isPending}
                            aria-pressed={segment.mode === 'available'}
                          >
                            <span
                              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                                segment.mode === 'available' ? 'translate-x-5' : 'translate-x-1'
                              }`}
                            />
                          </button>
                          <span className="text-xs text-slate-500">Deaktiviert</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => removeSegment(day.isoDate, segment.id)}
                          className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500 hover:border-slate-300"
                          disabled={isPending}
                        >
                          Entfernen
                        </button>
                      </div>

                      {segment.mode === 'unavailable' ? (
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                          <label className="sm:col-span-2 flex flex-col gap-1 text-sm">
                            <span className="font-medium text-slate-600">Arbeitsstatus</span>
                            <select
                              value={segment.label || DEFAULT_STATUS}
                              onChange={(event) =>
                                updateSegment(day.isoDate, segment.id, { label: event.target.value })
                              }
                              className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
                              disabled={isPending}
                            >
                              {STATUS_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex flex-col gap-1 text-sm">
                            <span className="font-medium text-slate-600">Start</span>
                            <input
                              type="time"
                              value={segment.start}
                              onChange={(event) => updateSegment(day.isoDate, segment.id, { start: event.target.value })}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
                              disabled={isPending || isNoWorkLabel(segment.label)}
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-sm">
                            <span className="font-medium text-slate-600">Ende</span>
                            <input
                              type="time"
                              value={segment.end}
                              onChange={(event) => updateSegment(day.isoDate, segment.id, { end: event.target.value })}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
                              disabled={isPending || isNoWorkLabel(segment.label)}
                            />
                          </label>
                        </div>
                      ) : (
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                          <label className="flex flex-col gap-1 text-sm">
                            <span className="font-medium text-slate-600">Start</span>
                            <input
                              type="time"
                              value={segment.start}
                              onChange={(event) => updateSegment(day.isoDate, segment.id, { start: event.target.value })}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
                              disabled={isPending}
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-sm">
                            <span className="font-medium text-slate-600">Ende</span>
                            <input
                              type="time"
                              value={segment.end}
                              onChange={(event) => updateSegment(day.isoDate, segment.id, { end: event.target.value })}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
                              disabled={isPending}
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-sm">
                            <span className="font-medium text-slate-600">Pause (Minuten)</span>
                            <input
                              type="number"
                              min={0}
                              value={segment.pause}
                              onChange={(event) => updateSegment(day.isoDate, segment.id, { pause: event.target.value })}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
                              disabled={isPending}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  ))}

                  {hasOverlap(day.segments) ? (
                    <p className="text-xs text-rose-600">Achtung: Die Zeiten überschneiden sich.</p>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => addSegment(day.isoDate)}
                    className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 hover:border-slate-400 hover:text-slate-600"
                    disabled={isPending}
                  >
                    <span className="text-lg leading-none">+</span>
                    Verfügbarkeit eintragen
                  </button>
                </div>
              </div>
            ))}
          </section>
        </div>

        {error ? (
          <div className="border-t border-rose-200 bg-rose-50 px-6 py-3 text-sm text-rose-700">{error}</div>
        ) : null}

        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isPending}
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-sky-300"
            disabled={isPending}
          >
            Speichern
          </button>
        </footer>
      </div>
    </div>
  );
}
