'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type { WeeklyShiftTemplate } from '@/lib/services/shift-plan';

type ActionResult = {
  success: boolean;
  error?: string;
};

type TemplateManagerProps = {
  templates: WeeklyShiftTemplate[];
  createAction: (formData: FormData) => Promise<ActionResult>;
  deleteAction: (formData: FormData) => Promise<ActionResult>;
};

type DayTemplateState = {
  weekdayIndex: number;
  weekdayLabel: string;
  mode: 'available' | 'unavailable';
  start: string;
  end: string;
  pause: string;
  label: string;
};

const WEEKDAY_LABELS: { label: string; index: number }[] = [
  { label: 'Montag', index: 0 },
  { label: 'Dienstag', index: 1 },
  { label: 'Mittwoch', index: 2 },
  { label: 'Donnerstag', index: 3 },
  { label: 'Freitag', index: 4 },
  { label: 'Samstag', index: 5 },
  { label: 'Sonntag', index: 6 },
];

const DEFAULT_START = '';
const DEFAULT_END = '';
const DEFAULT_PAUSE = '0';
const ABSENCE_OPTIONS = [
  'Abwesend',
  'Urlaub',
  'Krankheit',
  'Schule/Fortbildung',
  'Überstundenabbau',
  'Kein Arbeitstag',
  'Kurzarbeit',
  'Feiertag',
  'Beschäftigungsverbote',
  'Betriebsratstätigkeit',
];

const NO_WORK_LABEL = 'Kein Arbeitstag';
const NO_WORK_LABEL_LOWER = NO_WORK_LABEL.toLowerCase();
const isNoWorkLabel = (label: string | null | undefined): boolean =>
  (label ?? '').trim().toLowerCase() === NO_WORK_LABEL_LOWER;
const ensureTimeValue = (value: string | null | undefined, fallback: string): string =>
  value && value.trim().length ? value : fallback;

function createInitialDays(): DayTemplateState[] {
  return WEEKDAY_LABELS.map(({ index, label }) => ({
    weekdayIndex: index,
    weekdayLabel: label,
    mode: 'available',
    start: DEFAULT_START,
    end: DEFAULT_END,
    pause: DEFAULT_PAUSE,
    label: '',
  }));
}

export default function TemplateManager({ templates, createAction, deleteAction }: TemplateManagerProps) {
  const router = useRouter();
  const [isModalOpen, setModalOpen] = useState(false);
  const [viewTemplate, setViewTemplate] = useState<WeeklyShiftTemplate | null>(null);
  const [name, setName] = useState('');
  const [days, setDays] = useState<DayTemplateState[]>(createInitialDays);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isListPending, startListTransition] = useTransition();

  const sortedTemplates = useMemo(
    () => [...templates].sort((a, b) => a.name.localeCompare(b.name, 'de-DE')),
    [templates]
  );

  const openModal = () => {
    setName('');
    setDays(createInitialDays());
    setError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (isPending) return;
    setModalOpen(false);
  };

  const openViewModal = (template: WeeklyShiftTemplate) => {
    setViewTemplate(template);
  };

  const closeViewModal = () => {
    setViewTemplate(null);
  };

  const updateDay = (weekdayIndex: number, patch: Partial<DayTemplateState>) => {
    setDays((prev) =>
      prev.map((day) => {
        if (day.weekdayIndex !== weekdayIndex) {
          return day;
        }

        const nextMode = patch.mode ?? day.mode;
        let nextLabel: string | null = patch.label !== undefined ? patch.label ?? null : day.label ?? null;

        if (patch.mode === 'available') {
          nextLabel = patch.label ?? '';
        } else if (patch.mode === 'unavailable') {
          nextLabel = patch.label ?? day.label ?? ABSENCE_OPTIONS[0];
        } else if (nextMode === 'unavailable' && !nextLabel) {
          nextLabel = ABSENCE_OPTIONS[0];
        }

        const baseStart = ensureTimeValue(day.start, DEFAULT_START);
        const baseEnd = ensureTimeValue(day.end, DEFAULT_END);

        let nextStart = patch.start ?? day.start ?? '';
        let nextEnd = patch.end ?? day.end ?? '';

        if (nextMode === 'unavailable') {
          if (isNoWorkLabel(nextLabel)) {
            nextStart = '';
            nextEnd = '';
          } else {
            nextStart = ensureTimeValue(nextStart, baseStart);
            nextEnd = ensureTimeValue(nextEnd, baseEnd);
          }
        } else if (nextMode === 'available') {
          nextStart = ensureTimeValue(nextStart, baseStart);
          nextEnd = ensureTimeValue(nextEnd, baseEnd);
        }

        return {
          ...day,
          ...patch,
          mode: nextMode,
          label: nextLabel ?? '',
          start: nextStart,
          end: nextEnd,
        };
      })
    );
  };

  const applyDayToWeek = (source: DayTemplateState) => {
    setDays((prev) =>
      prev.map((day) => {
        if (day.weekdayIndex === source.weekdayIndex) {
          return day;
        }
        if (source.mode === 'available') {
          return {
            ...day,
            mode: 'available',
            start: source.start,
            end: source.end,
            pause: source.pause,
            label: source.label,
          };
        }
        const label = source.label || ABSENCE_OPTIONS[0];
        const isNoWork = isNoWorkLabel(label);
        return {
          ...day,
          mode: 'unavailable',
          label,
          start: isNoWork ? '' : source.start,
          end: isNoWork ? '' : source.end,
          pause: source.pause,
        };
      })
    );
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      setError('Bitte einen Namen für die Vorlage vergeben.');
      return;
    }

    const payload = {
      name: name.trim(),
      days: days.map((day) => ({
        weekday: day.weekdayIndex,
        mode: day.mode,
        start: day.start,
        end: day.end,
        pause: Number(day.pause ?? '0') || 0,
        label: day.label,
      })),
    };

    const formData = new FormData();
    formData.set('payload', JSON.stringify(payload));

    startTransition(() => {
      createAction(formData).then((result) => {
        if (result.success) {
          setModalOpen(false);
          setError(null);
        } else {
          setError(result.error ?? 'Vorlage konnte nicht gespeichert werden.');
        }
      });
    });
  };

  const handleDelete = (id: number, name: string) => {
    const confirmed =
      typeof window !== 'undefined'
        ? window.confirm(`Vorlage "${name}" wirklich löschen? Dieser Vorgang kann nicht rückgängig gemacht werden.`)
        : true;
    if (!confirmed) return;

    const formData = new FormData();
    formData.set('templateId', String(id));
    startListTransition(() => {
      deleteAction(formData).then((result) => {
        if (!result.success) {
          setListError(result.error ?? 'Vorlage konnte nicht gelöscht werden.');
        } else {
          setListError(null);
        }
      });
    });
  };

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <button
            type="button"
            onClick={() => router.back()}
            className="text-sky-600 hover:underline"
          >
            ← Zurück
          </button>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Vorlagen verwalten</h1>
          <p className="text-sm text-slate-500">Lege wiederkehrende Schichtmuster an und verwalte bestehende Vorlagen.</p>
        </div>
        <button
          type="button"
          onClick={openModal}
          className="rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-300"
        >
          Neue Vorlage
        </button>
      </header>

      {listError ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{listError}</div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3 text-right">Aktion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {sortedTemplates.length ? (
              sortedTemplates.map((template) => (
                <tr key={template.id} className="text-slate-700">
                  <td className="px-4 py-3 font-medium">
                    <button
                      type="button"
                      onClick={() => openViewModal(template)}
                      className="text-left text-slate-800 underline-offset-2 hover:underline focus:outline-none"
                      disabled={isListPending}
                    >
                      {template.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-rose-200 text-xs font-semibold text-rose-600 hover:border-rose-300 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => handleDelete(template.id, template.name)}
                        disabled={isListPending}
                        aria-label={`Vorlage ${template.name} löschen`}
                        title="Vorlage löschen"
                      >
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-6 text-center text-sm text-slate-400" colSpan={2}>
                  Noch keine Vorlagen vorhanden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <header className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Vorlage erstellen</h2>
                <p className="text-sm text-slate-500">Definiere Standardzeiten oder Abwesenheiten für eine ganze Woche.</p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-500 hover:bg-slate-100"
                disabled={isPending}
              >
                ✕
              </button>
            </header>

            <div className="space-y-4">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="z. B. Frühschicht Vollzeit"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
                  disabled={isPending}
                />
              </label>

              <div className="grid gap-3">
                {days.map((day) => (
                  <div key={day.weekdayIndex} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-700">{day.weekdayLabel}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-sky-500 focus:ring-sky-400"
                        checked={day.mode === 'available'}
                        onChange={(event) => {
                          const nextMode = event.target.checked ? 'available' : 'unavailable';
                          updateDay(day.weekdayIndex, {
                            mode: nextMode,
                            label: nextMode === 'unavailable' ? day.label || ABSENCE_OPTIONS[0] : '',
                          });
                        }}
                      />
                      {day.mode === 'available' ? 'Verfügbar' : 'Nicht verfügbar'}
                    </label>
                    <button
                      type="button"
                      onClick={() => applyDayToWeek(day)}
                      className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isPending}
                    >
                      Auf Woche anwenden
                    </button>
                  </div>
                </div>

                    {day.mode === 'available' ? (
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <label className="flex flex-col gap-1 text-sm">
                          <span className="font-medium text-slate-600">Start</span>
                          <input
                            type="time"
                            value={day.start}
                            onChange={(event) => updateDay(day.weekdayIndex, { start: event.target.value })}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
                            disabled={isPending}
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-sm">
                          <span className="font-medium text-slate-600">Ende</span>
                          <input
                            type="time"
                            value={day.end}
                            onChange={(event) => updateDay(day.weekdayIndex, { end: event.target.value })}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
                            disabled={isPending}
                          />
                        </label>
                        <label className="sm:col-span-2 flex flex-col gap-1 text-sm">
                          <span className="font-medium text-slate-600">Hinweis (optional)</span>
                          <input
                            type="text"
                            value={day.label}
                            onChange={(event) => updateDay(day.weekdayIndex, { label: event.target.value })}
                            placeholder="z. B. Spätschicht"
                            className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
                            disabled={isPending}
                          />
                        </label>
                      </div>
                    ) : (
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <div className="sm:col-span-2 flex flex-wrap items-end justify-between gap-3">
                          <label className="flex flex-1 flex-col gap-1 text-sm">
                            <span className="font-medium text-slate-600">Status</span>
                            <select
                              value={day.label || ABSENCE_OPTIONS[0]}
                              onChange={(event) => updateDay(day.weekdayIndex, { label: event.target.value })}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
                              disabled={isPending}
                            >
                              {ABSENCE_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            onClick={() => updateDay(day.weekdayIndex, { label: ABSENCE_OPTIONS[0] })}
                            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500 hover:border-slate-300"
                          >
                            Zurücksetzen
                          </button>
                        </div>
                        <label className="flex flex-col gap-1 text-sm">
                          <span className="font-medium text-slate-600">Start</span>
                          <input
                            type="time"
                            value={day.start}
                            onChange={(event) => updateDay(day.weekdayIndex, { start: event.target.value })}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
                            disabled={isPending || isNoWorkLabel(day.label)}
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-sm">
                          <span className="font-medium text-slate-600">Ende</span>
                          <input
                            type="time"
                            value={day.end}
                            onChange={(event) => updateDay(day.weekdayIndex, { end: event.target.value })}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
                            disabled={isPending || isNoWorkLabel(day.label)}
                          />
                        </label>
                        {isNoWorkLabel(day.label) ? (
                          <p className="sm:col-span-2 text-xs text-slate-500">
                            Für „{NO_WORK_LABEL}“ werden keine Zeiten gespeichert.
                          </p>
                        ) : (
                          <p className="sm:col-span-2 text-xs text-slate-500">
                            Hinterlegte Zeiten werden trotz Abwesenheit gespeichert.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {error ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
              ) : null}
            </div>

            <footer className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeModal}
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
      ) : null}

      {viewTemplate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="relative flex w-full max-w-2xl max-h-[90vh] flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4 bg-white/95">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Vorlage – {viewTemplate.name}</h2>
                <p className="text-sm text-slate-500">
                  Diese Vorlage ist schreibgeschützt und kann hier nur eingesehen oder gelöscht werden. Wenn die Vorlage gelöscht wird, ist der Nutzer der Vorlage im Schichtplan nicht mehr verfügbar und online nicht mehr buchbar.
                </p>
              </div>
              <button
                type="button"
                onClick={closeViewModal}
                className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-500 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {WEEKDAY_LABELS.map(({ index, label }) => {
                const templateDay = viewTemplate.days.find((day) => day.weekday === index);
                const segments = templateDay?.segments ?? [];
                return (
                  <div key={index} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-800">{label}</p>
                      <span className="text-xs text-slate-500">
                        {segments.length ? `${segments.length} ${segments.length === 1 ? 'Eintrag' : 'Einträge'}` : 'Keine Vorgaben'}
                      </span>
                    </div>
                    {segments.length ? (
                      <div className="mt-3 space-y-3">
                        {segments.map((segment, idx) => (
                          <div key={`${index}-${idx}`} className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
                            <p className="font-semibold">
                              {segment.mode === 'available' ? 'Verfügbar' : 'Nicht verfügbar'}
                              {segment.label ? ` – ${segment.label}` : ''}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              Zeit: {segment.start ? `${segment.start}` : '—'} bis {segment.end ? `${segment.end}` : '—'}
                              {segment.requiredPauseMinutes ? ` · Pause: ${segment.requiredPauseMinutes} min` : ''}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-slate-500">Für diesen Tag sind keine Vorgaben gespeichert.</p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 bg-white/95 px-6 py-4">
              <button
                type="button"
                onClick={() => {
                  const confirmed =
                    typeof window !== 'undefined'
                      ? window.confirm(
                          `Vorlage "${viewTemplate.name}" wirklich löschen? Dieser Vorgang kann nicht rückgängig gemacht werden.`
                        )
                      : true;
                  if (!confirmed) return;
                  const formData = new FormData();
                  formData.set('templateId', String(viewTemplate.id));
                  startListTransition(() => {
                    deleteAction(formData).then((result) => {
                      if (!result.success) {
                        setListError(result.error ?? 'Vorlage konnte nicht gelöscht werden.');
                      } else {
                        setListError(null);
                        setViewTemplate(null);
                      }
                    });
                  });
                }}
                className="inline-flex items-center gap-2 rounded-md border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-600 hover:border-rose-300 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isListPending}
              >
                🗑 Löschen
              </button>
              <button
                type="button"
                onClick={closeViewModal}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
