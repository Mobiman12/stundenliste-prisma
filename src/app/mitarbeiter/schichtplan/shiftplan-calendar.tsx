'use client';

import { jsPDF } from 'jspdf';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { BranchSummary } from '@/lib/data/branches';

const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export type ShiftPlanDayInfo = {
  isoDate: string;
  start: string | null;
  end: string | null;
  pauseMinutes: number;
  label: string | null;
  code: string | null;
  isAvailable: boolean;
  branchId?: number | null;
  branchName?: string | null;
};

export type ShiftPlanTemplateSegment = {
  mode: 'available' | 'unavailable';
  start: string | null;
  end: string | null;
  requiredPauseMinutes: number;
  label: string | null;
};

export type ShiftPlanTemplate = {
  id: string | number;
  name: string;
  days: Array<{
    weekday: number;
    segments: ShiftPlanTemplateSegment[];
  }>;
};

type Props = {
  days: ShiftPlanDayInfo[];
  initialDate: string;
  rangeStart: string;
  rangeEnd: string;
  editable?: boolean;
  templates?: ShiftPlanTemplate[];
  updateAction?: (formData: FormData) => Promise<{ success: boolean; error?: string }>;
  fillWeekAction?: (formData: FormData) => Promise<{ success: boolean; error?: string }>;
  clearWeekAction?: (formData: FormData) => Promise<{ success: boolean; error?: string }>;
  syncRangeAction?: (formData: FormData) => Promise<{ success: boolean; error?: string }>;
  branches?: BranchSummary[];
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

function toWeekdayIndex(iso: string): number {
  const date = new Date(`${iso}T00:00:00`);
  return (date.getDay() + 6) % 7;
}

const NO_WORK_LABEL = 'Kein Arbeitstag';
const NO_WORK_LABEL_LOWER = NO_WORK_LABEL.toLowerCase();
const isNoWorkLabel = (label: string | null | undefined): boolean =>
  (label ?? '').trim().toLowerCase() === NO_WORK_LABEL_LOWER;

const sanitizeTimeInput = (value: string | null | undefined): string => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    return trimmed.padStart(5, '0');
  }
  return trimmed;
};

function startOfMonth(date: Date): Date {
  const clone = new Date(date);
  clone.setDate(1);
  clone.setHours(0, 0, 0, 0);
  return clone;
}

function endOfMonth(date: Date): Date {
  const clone = new Date(date);
  clone.setMonth(clone.getMonth() + 1);
  clone.setDate(0);
  clone.setHours(0, 0, 0, 0);
  return clone;
}

function monthOptions(rangeStart: string, rangeEnd: string) {
  const start = startOfMonth(toDate(rangeStart));
  const end = startOfMonth(toDate(rangeEnd));

  const options: Array<{ value: string; label: string }> = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    const iso = toIso(cursor);
    const label = cursor.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    options.push({ value: iso, label });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return options;
}

function buildCalendarGrid(monthStart: Date): Array<Array<{ isoDate: string; inMonth: boolean }>> {
  const startWeekday = (monthStart.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = endOfMonth(monthStart).getDate();

  const cells: Array<{ isoDate: string; inMonth: boolean }> = [];
  for (let i = 0; i < startWeekday; i += 1) {
    const date = new Date(monthStart);
    date.setDate(date.getDate() - (startWeekday - i));
    cells.push({ isoDate: toIso(date), inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(monthStart);
    date.setDate(day);
    cells.push({ isoDate: toIso(date), inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const date = new Date(monthStart);
    date.setDate(daysInMonth + (cells.length - startWeekday - daysInMonth) + 1);
    cells.push({ isoDate: toIso(date), inMonth: false });
  }

  const rows: Array<Array<{ isoDate: string; inMonth: boolean }>> = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }
  return rows;
}

export default function EmployeeShiftPlanCalendar({
  days,
  initialDate,
  rangeStart,
  rangeEnd,
  editable = false,
  templates = [],
  updateAction,
  fillWeekAction,
  clearWeekAction,
  syncRangeAction,
  branches = [],
}: Props) {
  const router = useRouter();
  const syncedRangesRef = useRef<Set<string>>(new Set());
  const dayMap = useMemo(() => {
    const map = new Map<string, ShiftPlanDayInfo>();
    for (const day of days) {
      map.set(day.isoDate, day);
    }
    return map;
  }, [days]);

  const options = useMemo(() => monthOptions(rangeStart, rangeEnd), [rangeStart, rangeEnd]);

  const [currentMonthIso, setCurrentMonthIso] = useState(() => {
    const monthIso = toIso(startOfMonth(toDate(initialDate)));
    const exists = options.some((option) => option.value === monthIso);
    return exists ? monthIso : options[options.length - 1]?.value ?? monthIso;
  });

  const currentMonthStart = useMemo(
    () => toIso(startOfMonth(toDate(currentMonthIso))),
    [currentMonthIso]
  );
  const currentMonthEnd = useMemo(
    () => toIso(endOfMonth(toDate(currentMonthIso))),
    [currentMonthIso]
  );

  useEffect(() => {
    if (!syncRangeAction || !editable) return;
    const key = `${currentMonthStart}:${currentMonthEnd}`;
    if (syncedRangesRef.current.has(key)) return;
    syncedRangesRef.current.add(key);
    const payload = new FormData();
    payload.set('start', currentMonthStart);
    payload.set('end', currentMonthEnd);
    syncRangeAction(payload).then((result) => {
      if (!result?.success && result?.error) {
        console.warn('[shift-plan] sync failed', result.error);
      }
    }).catch((error) => {
      console.warn('[shift-plan] sync failed', error);
    });
  }, [syncRangeAction, editable, currentMonthStart, currentMonthEnd]);

  const exportData = useMemo(() => {
    const filtered = days.filter(
      (day) => day.isoDate >= currentMonthStart && day.isoDate <= currentMonthEnd
    );
    return filtered.sort((a, b) => a.isoDate.localeCompare(b.isoDate));
  }, [days, currentMonthStart, currentMonthEnd]);

  const calendarRows = useMemo(
    () => buildCalendarGrid(startOfMonth(toDate(currentMonthIso))),
    [currentMonthIso]
  );

  const monthLabel = useMemo(() => {
    const monthDate = startOfMonth(toDate(currentMonthIso));
    return monthDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  }, [currentMonthIso]);

  const todayIso = useMemo(() => toIso(new Date()), []);
  const canEdit = editable && typeof updateAction === 'function';
  const [editing, setEditing] = useState<ShiftPlanDayInfo | null>(null);
  const [startValue, setStartValue] = useState('');
  const [endValue, setEndValue] = useState('');
  const [pauseValue, setPauseValue] = useState('');
  const [labelValue, setLabelValue] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [branchValue, setBranchValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const sortedTemplates = useMemo(
    () => [...templates].sort((a, b) => a.name.localeCompare(b.name, 'de-DE')),
    [templates]
  );
  const selectedTemplate = useMemo(
    () => sortedTemplates.find((item) => String(item.id) === selectedTemplateId) ?? null,
    [selectedTemplateId, sortedTemplates]
  );
  const hasTemplateSelected = Boolean(selectedTemplateId);
  const inputsDisabledByTemplate = hasTemplateSelected || isPending;
  const hasBranches = branches.length > 0;
  const resolveBranchValue = useCallback(
    (info?: ShiftPlanDayInfo | null): string => {
      if (info?.branchId && branches.some((branch) => branch.id === info.branchId)) {
        return String(info.branchId);
      }
      if (branches.length === 1) {
        return String(branches[0].id);
      }
      return '';
    },
    [branches]
  );

  const openEditor = (info: ShiftPlanDayInfo) => {
    setEditing(info);
    setStartValue(info.start ?? '');
    setEndValue(info.end ?? '');
    setPauseValue(info.pauseMinutes ? String(info.pauseMinutes) : '');
    setLabelValue(info.label ?? '');
    setSelectedTemplateId('');
    setBranchValue(resolveBranchValue(info));
    setError(null);
  };

  useEffect(() => {
    if (!editing || !selectedTemplate) return;

    const weekday = toWeekdayIndex(editing.isoDate);
    const templateDay = selectedTemplate.days.find((entry) => entry.weekday === weekday);
    const templateSegments = templateDay?.segments ?? [];
    if (!templateSegments.length) {
      setStartValue('');
      setEndValue('');
      setPauseValue('');
      setLabelValue('');
      return;
    }

    const availableSegment = templateSegments.find(
      (segment) => segment.mode === 'available' && (segment.start || segment.end)
    );
    if (availableSegment) {
      setStartValue(sanitizeTimeInput(availableSegment.start));
      setEndValue(sanitizeTimeInput(availableSegment.end));
      setPauseValue(
        availableSegment.requiredPauseMinutes ? String(availableSegment.requiredPauseMinutes) : ''
      );
      setLabelValue(availableSegment.label?.trim() ?? '');
      return;
    }

    const unavailableSegment = templateSegments.find((segment) => segment.mode === 'unavailable');
    if (unavailableSegment) {
      const label = (unavailableSegment.label ?? '').trim() || NO_WORK_LABEL;
      setLabelValue(label);
      if (isNoWorkLabel(label)) {
        setStartValue('');
        setEndValue('');
        setPauseValue('');
      } else {
        setStartValue(sanitizeTimeInput(unavailableSegment.start));
        setEndValue(sanitizeTimeInput(unavailableSegment.end));
        setPauseValue(
          unavailableSegment.requiredPauseMinutes ? String(unavailableSegment.requiredPauseMinutes) : ''
        );
      }
      return;
    }

    setStartValue('');
    setEndValue('');
    setPauseValue('');
    setLabelValue('');
    if (!branchValue) {
      setBranchValue(resolveBranchValue(editing));
    }
  }, [editing, selectedTemplate, resolveBranchValue, branchValue]);

  const closeEditor = () => {
    if (isPending) return;
    setEditing(null);
    setStartValue('');
    setEndValue('');
    setPauseValue('');
    setLabelValue('');
    setSelectedTemplateId('');
    setBranchValue('');
    setError(null);
  };

  const submitUpdate = (payload: { start: string; end: string; pause: string; label: string }) => {
    if (!editing || !updateAction) return;
    const formData = new FormData();
    formData.set('isoDate', editing.isoDate);
    formData.set('start', payload.start);
    formData.set('end', payload.end);
    formData.set('pause', payload.pause);
    formData.set('label', payload.label);
    if (branchValue) {
      formData.set('branchId', branchValue);
    }

    startTransition(() => {
      updateAction(formData).then((result) => {
        if (result.success) {
          closeEditor();
          router.refresh();
        } else {
          setError(result.error ?? 'Speichern fehlgeschlagen.');
        }
      });
    });
  };

  const handleClearWeek = () => {
    if (!editing || !clearWeekAction) return;
    const weekStart = toIso(startOfWeek(toDate(editing.isoDate)));
    const formData = new FormData();
    formData.set('weekStart', weekStart);

    startTransition(() => {
      clearWeekAction(formData).then((result) => {
        if (result.success) {
          closeEditor();
          router.refresh();
        } else {
          setError(result.error ?? 'Woche konnte nicht gelöscht werden.');
        }
      });
    });
  };

  const handleFillWeek = () => {
    if (!editing || !fillWeekAction) return;
    if (!selectedTemplateId) {
      setError('Bitte zuerst eine Schichtvorlage auswählen.');
      return;
    }
    const weekStart = toIso(startOfWeek(toDate(editing.isoDate)));
    const formData = new FormData();
    formData.set('weekStart', weekStart);
    formData.set('templateId', selectedTemplateId);
    formData.set('label', '');
    if (branchValue) {
      formData.set('branchId', branchValue);
    }

    startTransition(() => {
      fillWeekAction(formData).then((result) => {
        if (result.success) {
          closeEditor();
          router.refresh();
        } else {
          setError(result.error ?? 'Woche konnte nicht gefüllt werden.');
        }
      });
    });
  };

  const handleSave = () => {
    if (!editing) return;
    if (hasTemplateSelected) {
      handleFillWeek();
      return;
    }
    if ((startValue && !endValue) || (!startValue && endValue)) {
      setError('Bitte Start- und Endzeit angeben oder beide Felder leer lassen.');
      return;
    }

    submitUpdate({
      start: startValue.trim(),
      end: endValue.trim(),
      pause: pauseValue.trim(),
      label: labelValue.trim(),
    });
  };

  const handleDelete = () => {
    submitUpdate({ start: '', end: '', pause: '', label: '' });
  };

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Monat</p>
          <p className="text-lg font-semibold text-slate-900">{monthLabel}</p>
      </div>
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Monat wählen
        <select
          value={currentMonthIso}
            onChange={(event) => setCurrentMonthIso(event.target.value)}
            className="ml-2 rounded-full border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            const header = 'Datum;Start;Ende;Pause_Min;Hinweis;Code\n';
            const rows = exportData
              .map((day) => {
                const parts = [
                  day.isoDate,
                  day.start ?? '',
                  day.end ?? '',
                  String(day.pauseMinutes ?? 0),
                  (day.label ?? '').replace(/\\r?\\n/g, ' '),
                  day.code ?? '',
                ];
                return parts.map((part) => `"${part.replace(/"/g, '""')}"`).join(';');
              })
              .join('\\n');
            const csvContent = `${header}${rows}`;
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `schichtplan-${currentMonthIso.slice(0, 7)}.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          }}
          className="rounded-full border border-slate-300 px-3 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Exportieren (CSV)
        </button>
        <button
          type="button"
          onClick={() => {
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            doc.setFontSize(16);
            doc.text(`Schichtplan ${monthLabel}`, 14, 20);
            doc.setFontSize(10);

            let y = 30;
            const lineHeight = 6;
            exportData.forEach((day) => {
              const line = `${day.isoDate}  ${day.start ?? '--:--'} – ${day.end ?? '--:--'}  Pause: ${day.pauseMinutes} Min  ${
                day.label ? day.label.replace(/\\r?\\n/g, ' ') : ''
              } ${day.code ? `[${day.code}]` : ''}`;
              if (y > 280) {
                doc.addPage();
                y = 20;
              }
              doc.text(line.trim(), 14, y);
              y += lineHeight;
            });

            doc.save(`schichtplan-${currentMonthIso.slice(0, 7)}.pdf`);
          }}
          className="rounded-full border border-slate-300 px-3 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Exportieren (PDF)
        </button>
      </div>

      <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="py-2">
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-2">
        {calendarRows.map((row) =>
          row.map(({ isoDate, inMonth }) => {
            const info = dayMap.get(isoDate) ?? null;
            const isToday = isoDate === todayIso;
            const hasTime = Boolean(info?.start && info?.end && info.start !== '00:00' && info.end !== '00:00');
            const hasLabel = Boolean(info?.label && info.label.trim().length > 0);
            const isAbsence = Boolean(info) && !info?.isAvailable;

            let primaryLine = '';
            if (isAbsence) {
              primaryLine = info?.label ?? 'Nicht verfügbar';
            } else if (hasTime) {
              primaryLine = `${info?.start} – ${info?.end}`;
            } else if (hasLabel) {
              primaryLine = info?.label ?? '';
            }

            const classes = [
              'flex min-h-[120px] flex-col justify-between rounded-lg border px-4 py-3 text-left transition',
              inMonth ? 'bg-slate-50 border-slate-200 text-slate-700' : 'bg-slate-100 border-slate-200 text-slate-400',
            ];
            if (isToday) {
              classes.push('border-brand bg-brand/5 text-brand-900');
            }
            if (isAbsence) {
              classes.push('border-amber-200 bg-amber-50 text-amber-800');
            }

            const baseInfo: ShiftPlanDayInfo =
              info ??
              ({
                isoDate,
                start: null,
                end: null,
                pauseMinutes: 0,
                label: null,
                code: null,
                isAvailable: true,
              } as ShiftPlanDayInfo);
            const content = (
              <>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide">
                    {new Date(`${isoDate}T00:00:00`).toLocaleDateString('de-DE', {
                      day: '2-digit',
                      month: '2-digit',
                    })}
                  </p>
                  {primaryLine ? <p className="mt-2 text-sm font-semibold">{primaryLine}</p> : null}
                  {isAbsence && hasTime ? (
                    <p className="mt-1 text-xs text-slate-500">Plan: {info?.start} – {info?.end}</p>
                  ) : null}
                  {info?.branchName ? (
                    <p className="mt-1 text-xs text-slate-500">{info.branchName}</p>
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
              </>
            );

            if (canEdit) {
              return (
                <button
                  key={isoDate}
                  type="button"
                  className={`${classes.join(' ')} hover:shadow-sm`}
                  onClick={() => openEditor(baseInfo)}
                >
                  {content}
                </button>
              );
            }

            return (
              <div key={isoDate} className={classes.join(' ')}>
                {content}
              </div>
            );
          })
        )}
      </div>

      <p className="text-xs text-slate-500">
        Anzeige umfasst den Zeitraum {rangeStart} bis {rangeEnd}.{' '}
        {canEdit
          ? 'Änderungen werden direkt im zentralen Schichtplan gespeichert.'
          : 'Für weiterführende Anpassungen wende dich bitte an den Admin.'}
      </p>

      {canEdit && editing ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <header className="mb-4 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Schicht bearbeiten</p>
              <h3 className="text-lg font-semibold text-slate-900">{editing.isoDate}</h3>
            </header>

            {sortedTemplates.length ? (
              <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vorlage anwenden</p>
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium text-slate-700">Vorlage</span>
                    <select
                      value={selectedTemplateId}
                      onChange={(event) => setSelectedTemplateId(event.target.value)}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                      disabled={isPending}
                    >
                      <option value="">Bitte auswählen</option>
                      {sortedTemplates.map((template) => (
                        <option key={String(template.id)} value={String(template.id)}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Start</span>
                <input
                  type="time"
                  value={startValue}
                  onChange={(event) => setStartValue(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-slate-100"
                  disabled={inputsDisabledByTemplate}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Ende</span>
                <input
                  type="time"
                  value={endValue}
                  onChange={(event) => setEndValue(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-slate-100"
                  disabled={inputsDisabledByTemplate}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Pause (Minuten)</span>
                <input
                  type="number"
                  min={0}
                  value={pauseValue}
                  onChange={(event) => setPauseValue(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-slate-100"
                  disabled={inputsDisabledByTemplate}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="font-medium text-slate-700">Hinweis (optional)</span>
                <input
                  type="text"
                  value={labelValue}
                  onChange={(event) => setLabelValue(event.target.value)}
                  placeholder="z. B. Urlaub, Krank, Schulung"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-slate-100"
                  disabled={inputsDisabledByTemplate}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="font-medium text-slate-700">Standort</span>
                <select
                  value={branchValue}
                  onChange={(event) => setBranchValue(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-slate-100"
                  disabled={!hasBranches || isPending}
                >
                  <option value="">Keine Zuordnung</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-slate-500">
                  Feiertage und Verfügbarkeit richten sich nach dem zugeordneten Standort.
                </span>
              </label>
            </div>

            {error ? (
              <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isPending}
                >
                  Eintrag löschen
                </button>
                {!hasTemplateSelected ? (
                  <>
                    {clearWeekAction ? (
                      <button
                        type="button"
                        onClick={handleClearWeek}
                        className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isPending}
                      >
                        Woche leeren
                      </button>
                    ) : null}
                    {fillWeekAction ? (
                      <button
                        type="button"
                        onClick={handleFillWeek}
                        className="rounded-lg border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-600 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isPending}
                      >
                        Woche füllen
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={closeEditor}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isPending}
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-brand/50"
                  disabled={isPending}
                >
                  Speichern
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
