'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type { WeeklyShiftTemplate } from '@/lib/services/shift-plan';
import type { BranchSummary } from '@/lib/data/branches';

export const SHIFT_PLAN_OPEN_TEMPLATE_MODAL_EVENT = 'timevex.shiftPlan.openTemplateModal';

type ActionResult = {
  success: boolean;
  error?: string;
};

type TemplateManagerProps = {
  templates: WeeklyShiftTemplate[];
  branches: BranchSummary[];
  createAction: (formData: FormData) => Promise<ActionResult>;
  deleteAction: (formData: FormData) => Promise<ActionResult>;
};

type DayTemplateState = {
  weekdayIndex: number;
  weekdayLabel: string;
  mode: 'available' | 'unavailable';
  start: string;
  end: string;
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
const isEmptyLabel = (label: string | null | undefined): boolean => !(label ?? '').trim().length;
const ensureTimeValue = (value: string | null | undefined, fallback: string): string =>
  value && value.trim().length ? value : fallback;

function createInitialDays(): DayTemplateState[] {
  return WEEKDAY_LABELS.map(({ index, label }) => ({
    weekdayIndex: index,
    weekdayLabel: label,
    mode: 'available',
    start: DEFAULT_START,
    end: DEFAULT_END,
    label: '',
  }));
}

export default function EmployeeTemplateManager({ templates, branches, createAction, deleteAction }: TemplateManagerProps) {
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

  const branchHint = useMemo(() => {
    if (!branches?.length) return null;
    if (branches.length === 1) return branches[0]?.name ?? null;
    return 'Standort wird im Schichtplan pro Arbeitszeit gewählt.';
  }, [branches]);

  const openModal = useCallback(() => {
    setName('');
    setDays(createInitialDays());
    setError(null);
    setModalOpen(true);
  }, []);

  const closeModal = () => {
    if (isPending) return;
    setModalOpen(false);
  };

  useEffect(() => {
    const handler = () => openModal();
    window.addEventListener(SHIFT_PLAN_OPEN_TEMPLATE_MODAL_EVENT, handler);
    return () => window.removeEventListener(SHIFT_PLAN_OPEN_TEMPLATE_MODAL_EVENT, handler);
  }, [openModal]);

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
          nextLabel = patch.label ?? day.label ?? '';
        }

        const baseStart = ensureTimeValue(day.start, DEFAULT_START);
        const baseEnd = ensureTimeValue(day.end, DEFAULT_END);

        let nextStart = patch.start ?? day.start ?? '';
        let nextEnd = patch.end ?? day.end ?? '';

        if (nextMode === 'unavailable') {
          if (isEmptyLabel(nextLabel)) {
            nextStart = '';
            nextEnd = '';
          } else if (isNoWorkLabel(nextLabel)) {
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
            label: source.label,
          };
        }
        const label = source.label || '';
        const isNoWork = isNoWorkLabel(label);
        return {
          ...day,
          mode: 'unavailable',
          label,
          start: isNoWork ? '' : source.start,
          end: isNoWork ? '' : source.end,
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
      days: days
        .map((day) => ({
          weekday: day.weekdayIndex,
          mode: day.mode,
          start: day.start,
          end: day.end,
          label: day.label,
        }))
        .filter((day) => {
          const hasTime = Boolean(day.start?.trim() || day.end?.trim());
          const hasLabel = Boolean(day.label?.trim());
          return hasTime || hasLabel;
        }),
    };

    const formData = new FormData();
    formData.set('payload', JSON.stringify(payload));

    startTransition(() => {
      createAction(formData).then((result) => {
        if (result.success) {
          setModalOpen(false);
          setError(null);
          router.refresh();
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
          router.refresh();
        }
      });
    });
  };

  return (
    <section className="space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <header>
        <h2 className="text-xl font-semibold text-slate-900">Meine Vorlagen</h2>
        <p className="text-sm text-slate-500">Lege wiederkehrende Schichtmuster für deinen Plan an.</p>
        {branchHint ? <p className="mt-1 text-xs text-slate-500">{branchHint}</p> : null}
      </header>

      {listError ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{listError}</div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-[520px] divide-y divide-slate-200 text-sm">
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
                <h3 className="text-xl font-semibold text-slate-900">Vorlage erstellen</h3>
                <p className="text-sm text-slate-500">
                  Definiere Standardzeiten oder Abwesenheiten für eine ganze Woche.
                </p>
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
                                label: nextMode === 'unavailable' ? day.label || '' : '',
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
                      </div>
                    ) : (
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <div className="sm:col-span-2 flex flex-wrap items-end justify-between gap-3">
                          <label className="flex flex-1 flex-col gap-1 text-sm">
                            <span className="font-medium text-slate-600">Status</span>
                            <select
                              value={day.label ?? ''}
                              onChange={(event) => updateDay(day.weekdayIndex, { label: event.target.value })}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
                              disabled={isPending}
                            >
                              <option value="">Kein Status (Tag nicht geplant)</option>
                              {ABSENCE_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            onClick={() => updateDay(day.weekdayIndex, { label: '' })}
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
                            disabled={isPending || isNoWorkLabel(day.label) || isEmptyLabel(day.label)}
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-sm">
                          <span className="font-medium text-slate-600">Ende</span>
                          <input
                            type="time"
                            value={day.end}
                            onChange={(event) => updateDay(day.weekdayIndex, { end: event.target.value })}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
                            disabled={isPending || isNoWorkLabel(day.label) || isEmptyLabel(day.label)}
                          />
                        </label>
                        {isEmptyLabel(day.label) ? (
                          <p className="sm:col-span-2 text-xs text-slate-500">
                            Ohne Status wird dieser Tag nicht in der Vorlage gespeichert.
                          </p>
                        ) : isNoWorkLabel(day.label) ? (
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
                <h3 className="text-xl font-semibold text-slate-900">Vorlage – {viewTemplate.name}</h3>
                <p className="text-sm text-slate-500">
                  Du kannst diese Vorlage nutzen oder löschen. Änderungen wirken sich nur auf deine eigenen Einträge aus.
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
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="grid gap-3">
                {viewTemplate.days.map((day) => {
                  const label = WEEKDAY_LABELS.find((entry) => entry.index === day.weekday)?.label ?? 'Tag';
                  return (
                    <div key={day.weekday} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-sm font-semibold text-slate-700">{label}</p>
                      {day.segments.length ? (
                        <ul className="mt-2 space-y-1 text-sm text-slate-600">
                          {day.segments.map((segment, index) => (
                            <li key={`${day.weekday}-${index}`}>
                              {segment.mode === 'available'
                                ? `${segment.start ?? '--:--'} – ${segment.end ?? '--:--'}`
                                : segment.label ?? 'Nicht verfügbar'}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs text-slate-400">Keine Einträge</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
