'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type DateRangeFilterProps = {
  initialStart: string;
  initialEnd: string;
  minDate: string;
  maxDate: string;
};

const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTH_NAMES = [
  'Januar',
  'Februar',
  'Maerz',
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

type CalendarCell = {
  isoDate: string;
  label: string;
  inCurrentMonth: boolean;
};

type DateRangeDraft = {
  start: string | null;
  end: string | null;
};

type Preset = {
  key: string;
  label: string;
  range?: { start: string; end: string };
};

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString('de-DE');
}

function formatRangeLabel(start: string, end: string): string {
  if (start === end) {
    return formatDate(start);
  }
  return `${formatDate(start)} - ${formatDate(end)}`;
}

function compareIso(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function addDays(isoDate: string, delta: number): string {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + delta);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftMonths(isoDate: string, delta: number): string {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setMonth(date.getMonth() + delta);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfMonth(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

function endOfMonth(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const endDate = new Date(year, month, 0);
  const endMonth = String(endDate.getMonth() + 1).padStart(2, '0');
  const endDay = String(endDate.getDate()).padStart(2, '0');
  return `${endDate.getFullYear()}-${endMonth}-${endDay}`;
}

function startOfYear(isoDate: string): string {
  const year = isoDate.slice(0, 4);
  return `${year}-01-01`;
}

function endOfYear(isoDate: string): string {
  const year = isoDate.slice(0, 4);
  return `${year}-12-31`;
}

function shiftMonthKey(monthKey: string, delta: number): string {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  }
  const year = Number.parseInt(monthKey.slice(0, 4), 10);
  const month = Number.parseInt(monthKey.slice(5, 7), 10);
  const date = new Date(year, month - 1 + delta, 1);
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, '0');
  return `${nextYear}-${nextMonth}`;
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildCalendarCells(year: number, month: number): CalendarCell[] {
  const firstOfMonth = new Date(year, month - 1, 1);
  const startWeekday = (firstOfMonth.getDay() + 6) % 7;
  const totalCells = 42;
  const cells: CalendarCell[] = [];
  for (let index = 0; index < totalCells; index += 1) {
    const offset = index - startWeekday;
    const cellDate = new Date(year, month - 1, 1 + offset);
    cells.push({
      isoDate: toIsoDate(cellDate),
      label: String(cellDate.getDate()),
      inCurrentMonth: cellDate.getMonth() === month - 1,
    });
  }
  return cells;
}

function clampRange(start: string, end: string, minDate: string, maxDate: string): { start: string; end: string } {
  let normalizedStart = start;
  let normalizedEnd = end;
  if (normalizedStart < minDate) normalizedStart = minDate;
  if (normalizedEnd > maxDate) normalizedEnd = maxDate;
  if (normalizedStart > normalizedEnd) normalizedStart = normalizedEnd;
  return { start: normalizedStart, end: normalizedEnd };
}

function resolveRange(draft: DateRangeDraft, fallback: { start: string; end: string }) {
  const start = draft.start ?? fallback.start;
  const end = draft.end ?? draft.start ?? fallback.end;
  if (start <= end) {
    return { start, end };
  }
  return { start: end, end: start };
}

function buildPresets(minDate: string, maxDate: string): Preset[] {
  const last7Start = addDays(maxDate, -6);
  const last30Start = addDays(maxDate, -29);
  const last90Start = addDays(maxDate, -89);
  const last12Start = shiftMonths(maxDate, -11);
  const thisMonthStart = startOfMonth(maxDate);
  const thisMonthEnd = endOfMonth(maxDate);
  const lastMonthEnd = addDays(thisMonthStart, -1);
  const lastMonthStart = startOfMonth(lastMonthEnd);
  const thisYearStart = startOfYear(maxDate);
  const thisYearEnd = endOfYear(maxDate);
  const lastYearStart = `${Number.parseInt(maxDate.slice(0, 4), 10) - 1}-01-01`;
  const lastYearEnd = `${Number.parseInt(maxDate.slice(0, 4), 10) - 1}-12-31`;

  return [
    { key: 'all', label: 'Alle Daten', range: { start: minDate, end: maxDate } },
    { key: 'last-12-months', label: 'Letzte 12 Monate', range: { start: last12Start, end: maxDate } },
    { key: 'last-90', label: 'Letzte 90 Tage', range: { start: last90Start, end: maxDate } },
    { key: 'last-30', label: 'Letzte 30 Tage', range: { start: last30Start, end: maxDate } },
    { key: 'last-7', label: 'Letzte 7 Tage', range: { start: last7Start, end: maxDate } },
    { key: 'this-month', label: 'Dieser Monat', range: { start: thisMonthStart, end: thisMonthEnd } },
    { key: 'last-month', label: 'Letzter Monat', range: { start: lastMonthStart, end: lastMonthEnd } },
    { key: 'this-year', label: 'Dieses Jahr', range: { start: thisYearStart, end: thisYearEnd } },
    { key: 'last-year', label: 'Letztes Jahr', range: { start: lastYearStart, end: lastYearEnd } },
    { key: 'custom', label: 'Benutzerdefiniert' },
  ];
}

function parseMonthKey(monthKey: string): { year: number; month: number } {
  const year = Number.parseInt(monthKey.slice(0, 4), 10);
  const month = Number.parseInt(monthKey.slice(5, 7), 10);
  return { year, month };
}

export default function DateRangeFilter({
  initialStart,
  initialEnd,
  minDate,
  maxDate,
}: DateRangeFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [isOpen, setIsOpen] = useState(false);
  const [rangeDraft, setRangeDraft] = useState<DateRangeDraft>({ start: initialStart, end: initialEnd });
  const [pickerMonth, setPickerMonth] = useState(() => initialStart.slice(0, 7));
  const presets = useMemo(() => buildPresets(minDate, maxDate), [minDate, maxDate]);

  const appliedRange = useMemo(() => ({ start: initialStart, end: initialEnd }), [initialStart, initialEnd]);
  const appliedLabel = useMemo(
    () => formatRangeLabel(appliedRange.start, appliedRange.end),
    [appliedRange.end, appliedRange.start]
  );

  const resolvedDraft = useMemo(
    () => resolveRange(rangeDraft, appliedRange),
    [rangeDraft, appliedRange]
  );

  const matchingPreset = useMemo(() => {
    return presets.find((preset) => {
      if (!preset.range) return false;
      const normalized = clampRange(preset.range.start, preset.range.end, minDate, maxDate);
      return normalized.start === appliedRange.start && normalized.end === appliedRange.end;
    })?.key;
  }, [appliedRange.end, appliedRange.start, minDate, maxDate, presets]);

  const [activePreset, setActivePreset] = useState<string | null>(matchingPreset ?? null);

  useEffect(() => {
    setRangeDraft({ start: initialStart, end: initialEnd });
    setPickerMonth(initialStart.slice(0, 7));
    setActivePreset(matchingPreset ?? null);
  }, [initialEnd, initialStart, matchingPreset]);

  const handlePresetClick = (preset: Preset) => {
    if (!preset.range) {
      setActivePreset('custom');
      return;
    }
    const normalized = clampRange(preset.range.start, preset.range.end, minDate, maxDate);
    setRangeDraft({ start: normalized.start, end: normalized.end });
    setPickerMonth(normalized.start.slice(0, 7));
    setActivePreset(preset.key);
  };

  const handleRangeDayClick = (isoDate: string) => {
    setActivePreset('custom');
    setRangeDraft((prev) => {
      if (!prev.start || (prev.start && prev.end)) {
        return { start: isoDate, end: null };
      }
      return { start: prev.start, end: isoDate };
    });
  };

  const handleApply = () => {
    const normalized = clampRange(resolvedDraft.start, resolvedDraft.end, minDate, maxDate);
    const params = new URLSearchParams(searchParams?.toString());
    params.delete('year');
    params.delete('month');
    params.delete('date');
    params.delete('from');
    params.delete('to');
    params.set('from', normalized.start);
    params.set('to', normalized.end);
    router.replace(`${pathname}?${params.toString()}`);
    setIsOpen(false);
  };

  const handleCancel = () => {
    setRangeDraft({ start: initialStart, end: initialEnd });
    setActivePreset(matchingPreset ?? null);
    setIsOpen(false);
  };

  const leftMonthKey = pickerMonth;
  const rightMonthKey = shiftMonthKey(pickerMonth, 1);
  const leftMonth = parseMonthKey(leftMonthKey);
  const rightMonth = parseMonthKey(rightMonthKey);
  const leftCells = buildCalendarCells(leftMonth.year, leftMonth.month);
  const rightCells = buildCalendarCells(rightMonth.year, rightMonth.month);

  const resolvedStart = resolvedDraft.start;
  const resolvedEnd = resolvedDraft.end;

  const isWithinBounds = (isoDate: string) => isoDate >= minDate && isoDate <= maxDate;

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-slate-900">Alle nach Zeitraum filtern</p>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex w-full items-center justify-between rounded-md border border-slate-300 bg-white px-4 py-2 text-left text-base font-medium text-slate-900 shadow-sm transition hover:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 sm:max-w-md"
      >
        <span>{appliedLabel}</span>
        <span className="text-xs text-slate-400">v</span>
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-8">
          <div className="w-full max-w-4xl rounded-xl bg-white shadow-xl">
            <div className="border-b border-slate-200 px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h4 className="text-lg font-semibold text-slate-900">Zeitraum auswaehlen</h4>
                  <p className="text-sm text-slate-500">
                    Waehle einen Zeitraum oder eine Voreinstellung.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded-full border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  aria-label="Dialog schliessen"
                >
                  x
                </button>
              </div>
            </div>
            <div className="grid gap-6 p-6 md:grid-cols-[200px_1fr]">
              <div className="space-y-1">
                {presets.map((preset) => {
                  const isActive = activePreset === preset.key;
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => handlePresetClick(preset)}
                      className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition ${
                        isActive ? 'bg-emerald-100 text-emerald-700' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <span>{preset.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setPickerMonth((prev) => shiftMonthKey(prev, -1))}
                    className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    Zurueck
                  </button>
                  <div className="flex items-center gap-12 text-sm font-medium text-slate-900">
                    <span>
                      {MONTH_NAMES[leftMonth.month - 1]} {leftMonth.year}
                    </span>
                    <span>
                      {MONTH_NAMES[rightMonth.month - 1]} {rightMonth.year}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPickerMonth((prev) => shiftMonthKey(prev, 1))}
                    className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    Weiter
                  </button>
                </div>
                <div className="grid gap-6 md:grid-cols-2">
                  {[{ cells: leftCells, month: leftMonth }, { cells: rightCells, month: rightMonth }].map(
                    ({ cells }, index) => (
                      <div key={index}>
                        <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500">
                          {WEEKDAY_LABELS.map((label) => (
                            <div key={label} className="py-1">
                              {label}
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-7 gap-1">
                          {cells.map((cell) => {
                            const isStart = resolvedStart === cell.isoDate;
                            const isEnd = resolvedEnd === cell.isoDate;
                            const inRange =
                              resolvedStart &&
                              resolvedEnd &&
                              compareIso(cell.isoDate, resolvedStart) >= 0 &&
                              compareIso(cell.isoDate, resolvedEnd) <= 0;
                            const disabled = !isWithinBounds(cell.isoDate);

                            const baseClasses =
                              'relative flex h-9 items-center justify-center rounded-md border text-sm transition';
                            const monthClasses = cell.inCurrentMonth
                              ? 'border-slate-300 text-slate-900'
                              : 'border-slate-200 text-slate-400';
                            const rangeClasses = inRange ? 'bg-emerald-100 border-emerald-200' : '';
                            const endpointClasses =
                              isStart || isEnd ? 'bg-emerald-600 text-white border-emerald-600 font-semibold' : '';
                            const disabledClasses = disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-emerald-50';

                            return (
                              <button
                                type="button"
                                key={cell.isoDate}
                                onClick={() => {
                                  if (disabled) return;
                                  handleRangeDayClick(cell.isoDate);
                                }}
                                className={`${baseClasses} ${monthClasses} ${rangeClasses} ${endpointClasses} ${disabledClasses}`}
                              >
                                {cell.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )
                  )}
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  <div>Von: {formatDate(resolvedStart)}</div>
                  <div>Bis: {formatDate(resolvedEnd)}</div>
                </div>
                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    Abbrechen
                  </button>
                  <button
                    type="button"
                    onClick={handleApply}
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    Anwenden
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
