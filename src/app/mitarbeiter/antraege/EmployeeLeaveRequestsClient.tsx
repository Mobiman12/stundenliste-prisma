'use client';

import { useMemo, useActionState, useState, useCallback } from 'react';
import { useFormStatus } from 'react-dom';

import type { LeaveRequestView } from '@/lib/services/leave-requests';

export type LeaveRequestFormState = {
  status: 'idle' | 'success' | 'error';
  message: string | null;
};

type Props = {
  requests: LeaveRequestView[];
  submitAction: (
    initialState: LeaveRequestFormState,
    formData: FormData
  ) => Promise<LeaveRequestFormState>;
  cancelAction: (
    initialState: LeaveRequestFormState,
    formData: FormData
  ) => Promise<LeaveRequestFormState>;
};

const INITIAL_STATE: LeaveRequestFormState = {
  status: 'idle',
  message: null,
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Sende Antrag …' : 'Antrag einreichen'}
    </button>
  );
}

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(iso: string | null): string | null {
  if (!iso) return null;
  const normalized = iso.includes('T') ? iso : `${iso}T00:00:00`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTH_NAMES = [
  'Januar',
  'Februar',
  'März',
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

function getTodayIsoDate(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isIsoDate(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function compareIso(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function shiftMonthKey(monthKey: string, delta: number): string {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    const today = getTodayIsoDate();
    return today.slice(0, 7);
  }
  const year = Number.parseInt(monthKey.slice(0, 4), 10);
  const month = Number.parseInt(monthKey.slice(5, 7), 10);
  const date = new Date(year, month - 1 + delta, 1);
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, '0');
  return `${nextYear}-${nextMonth}`;
}

type CalendarCell = {
  isoDate: string;
  label: string;
  inCurrentMonth: boolean;
};

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildCalendarCells(year: number, month: number): CalendarCell[] {
  const firstOfMonth = new Date(year, month - 1, 1);
  const startWeekday = (firstOfMonth.getDay() + 6) % 7; // Monday = 0
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

function countDaysInclusive(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  const diffMs = end.getTime() - start.getTime();
  if (Number.isNaN(diffMs)) {
    return 0;
  }
  return Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
}

function formatRangeSummary(startIso: string, endIso: string): string {
  if (!startIso || !endIso) return '';
  if (compareIso(startIso, endIso) === 0) {
    return formatDate(startIso);
  }
  const days = countDaysInclusive(startIso, endIso);
  return `${formatDate(startIso)} – ${formatDate(endIso)} (${days} Tage)`;
}

function formatTimeLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const trimmed = value.trim();
  if (!trimmed) return '—';
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    return trimmed.padStart(5, '0');
  }
  return trimmed;
}

function formatIsoForDisplay(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString('de-DE');
}

export default function EmployeeLeaveRequestsClient({ requests, submitAction, cancelAction }: Props) {
  const [formState, formAction] = useActionState(submitAction, INITIAL_STATE);
  const [cancelState, cancelFormAction] = useActionState(cancelAction, INITIAL_STATE);

  const today = getTodayIsoDate();
  const [requestType, setRequestType] = useState<'vacation' | 'overtime'>('vacation');
  const [startDate, setStartDate] = useState<string>(today);
  const [endDate, setEndDate] = useState<string>(today);
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [showRangePicker, setShowRangePicker] = useState(false);
  const [rangeDraft, setRangeDraft] = useState<{ start: string | null; end: string | null }>({
    start: null,
    end: null,
  });
  const [rangePickerMonth, setRangePickerMonth] = useState<string>(today.slice(0, 7));
  const [rangeError, setRangeError] = useState<string | null>(null);

  const effectiveEndDate = requestType === 'vacation' ? endDate : startDate;

  const sortedRequests = useMemo(
    () => [...requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [requests]
  );

  const feedbackClassFor = (state: LeaveRequestFormState) =>
    state.status === 'success'
      ? 'border-green-200 bg-green-50 text-green-700'
      : 'border-red-200 bg-red-50 text-red-700';
  const requestFeedbackClass = feedbackClassFor(formState);
  const cancelFeedbackClass = feedbackClassFor(cancelState);
  const rangeSummary = useMemo(() => {
    if (!startDate || !effectiveEndDate) return null;
    return formatRangeSummary(startDate, effectiveEndDate);
  }, [startDate, effectiveEndDate]);

  const pickerMeta = useMemo(() => {
    const key = rangePickerMonth || getTodayIsoDate().slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(key)) {
      return {
        year: Number.parseInt(key.slice(0, 4), 10),
        month: Number.parseInt(key.slice(5, 7), 10),
      };
    }
    const fallback = getTodayIsoDate();
    return {
      year: Number.parseInt(fallback.slice(0, 4), 10),
      month: Number.parseInt(fallback.slice(5, 7), 10),
    };
  }, [rangePickerMonth]);

  const calendarCells = useMemo(
    () => buildCalendarCells(pickerMeta.year, pickerMeta.month),
    [pickerMeta]
  );

  const handleTypeChange = useCallback(
    (value: string) => {
      const next = value === 'overtime' ? 'overtime' : 'vacation';
      setRequestType(next);
      setRangeError(null);
      const base = isIsoDate(startDate) ? startDate : today;
      if (next === 'overtime') {
        setStartDate(base);
        setEndDate(base);
        setStartTime('');
        setEndTime('');
        setRangeDraft({ start: base, end: null });
        setRangePickerMonth(base.slice(0, 7));
        setShowRangePicker(true);
      } else {
        setStartDate(base);
        setRangeDraft({ start: null, end: null });
        setStartTime('');
        setEndTime('');
        setShowRangePicker(true);
      }
    },
    [startDate, today]
  );

  const handleOpenRangePicker = useCallback(() => {
    const base = isIsoDate(startDate) ? startDate : today;
    setRangeDraft({
      start: base,
      end: requestType === 'vacation' ? effectiveEndDate : base,
    });
    setRangePickerMonth(base.slice(0, 7));
    setRangeError(null);
    setShowRangePicker(true);
  }, [startDate, effectiveEndDate, requestType, today]);

  const handleRangeClear = useCallback(() => {
    setEndDate(startDate);
    setRangeDraft({ start: startDate, end: null });
    setRangeError(null);
  }, [startDate]);

  const handleRangeDayClick = useCallback(
    (isoDate: string) => {
      setRangeError(null);
      setRangeDraft((prev) => {
        if (!prev.start || (prev.start && prev.end)) {
          return { start: isoDate, end: null };
        }
        if (compareIso(isoDate, prev.start) < 0) {
          return { start: isoDate, end: prev.start };
        }
        return { start: prev.start, end: isoDate };
      });
    },
    []
  );

  const handleRangeApply = useCallback(() => {
    if (!rangeDraft.start) {
      setRangeError('Bitte zuerst ein Startdatum wählen.');
      return;
    }
    const rawStart = rangeDraft.start;
    const rawEnd = rangeDraft.end ?? rangeDraft.start;
    const sortedStart = compareIso(rawStart, rawEnd) <= 0 ? rawStart : rawEnd;
    const sortedEnd = compareIso(rawStart, rawEnd) <= 0 ? rawEnd : rawStart;
    const resolvedEnd = requestType === 'vacation' ? sortedEnd : sortedStart;
    if (requestType === 'overtime' && (!startTime || !endTime)) {
      setRangeError('Bitte Start- und Endzeit für den Überstundenabbau angeben.');
      return;
    }
    setStartDate(sortedStart);
    setEndDate(resolvedEnd);
    setRangePickerMonth(sortedStart.slice(0, 7));
    setShowRangePicker(false);
    setRangeError(null);
  }, [rangeDraft, requestType, startTime, endTime]);

  const handleRangeCancel = useCallback(() => {
    setShowRangePicker(false);
  }, []);

  const handleRangePrevMonth = useCallback(() => {
    setRangePickerMonth((prev) => shiftMonthKey(prev, -1));
  }, []);

  const handleRangeNextMonth = useCallback(() => {
    setRangePickerMonth((prev) => shiftMonthKey(prev, 1));
  }, []);

  const selectionStart = showRangePicker
    ? rangeDraft.start ?? startDate
    : startDate;
  const selectionEnd = showRangePicker
    ? rangeDraft.end ?? rangeDraft.start ?? startDate
    : effectiveEndDate;

  const resolvedRangeStart = selectionStart && selectionEnd
    ? compareIso(selectionStart, selectionEnd) <= 0
      ? selectionStart
      : selectionEnd
    : selectionStart;
  const resolvedRangeEnd = selectionStart && selectionEnd
    ? compareIso(selectionStart, selectionEnd) <= 0
      ? selectionEnd
      : selectionStart
    : selectionEnd;

  const handleStartTimeChange = useCallback((value: string) => {
    setStartTime(value);
    setRangeError(null);
  }, []);

  const handleEndTimeChange = useCallback((value: string) => {
    setEndTime(value);
    setRangeError(null);
  }, []);

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <header className="mb-4 space-y-1">
          <h2 className="text-lg font-semibold text-slate-900">Neuen Antrag stellen</h2>
          <p className="text-sm text-slate-500">
            Beantrage Urlaub oder Überstundenabbau. Die Anfrage wird an die Verwaltung zur Genehmigung weitergeleitet.
          </p>
        </header>
        <form action={formAction} className="space-y-6">
          <div>
            <label htmlFor="type" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Art des Antrags
            </label>
            <select
              id="type"
              name="type"
              value={requestType}
              onChange={(event) => handleTypeChange(event.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            >
              <option value="vacation">Urlaub</option>
              <option value="overtime">Überstundenabbau</option>
            </select>
          </div>

          <input type="hidden" name="start_date" value={startDate} />
          <input type="hidden" name="end_date" value={requestType === 'vacation' ? effectiveEndDate : startDate} />
          <input type="hidden" name="start_time" value={requestType === 'overtime' ? startTime : ''} />
          <input type="hidden" name="end_time" value={requestType === 'overtime' ? endTime : ''} />

          <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {requestType === 'vacation' ? 'Zeitraum' : 'Datum'}
            </span>
            <button
              type="button"
              onClick={handleOpenRangePicker}
              className="flex flex-col rounded-md border border-slate-300 px-3 py-2 text-left font-medium text-slate-700 hover:border-emerald-400 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-brand/20"
            >
              <span className="text-sm font-semibold text-slate-900">
                {rangeSummary ?? 'Jetzt auswählen'}
              </span>
              <span className="text-xs text-slate-500">Tippen oder klicken, um den Kalender zu öffnen.</span>
            </button>
            {requestType === 'overtime' && startTime && endTime ? (
              <span className="text-xs text-slate-500">
                Zeiten: {formatTimeLabel(startTime)} – {formatTimeLabel(endTime)}
              </span>
            ) : null}
            {requestType === 'vacation' && rangeSummary ? (
              <button
                type="button"
                onClick={handleRangeClear}
                className="w-fit rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-300"
              >
                Zeitraum zurücksetzen
              </button>
            ) : null}
            {rangeError ? <span className="text-xs text-red-600">{rangeError}</span> : null}
          </div>

          <div>
            <label htmlFor="reason" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Bemerkung (optional)
            </label>
            <textarea
              id="reason"
              name="reason"
              rows={3}
              maxLength={500}
              placeholder="Optional: Zusatzinformationen für die Verwaltung"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
            <p className="mt-1 text-xs text-slate-400">Maximal 500 Zeichen.</p>
          </div>

          <SubmitButton />
        </form>
        {showRangePicker ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-8">
            <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-lg font-semibold text-slate-900">Zeitraum auswählen</h4>
                  <p className="text-sm text-slate-500">
                    Erster Klick setzt „Von“, der zweite Klick setzt „Bis“.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRangeCancel}
                  className="rounded-full border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/20"
                  aria-label="Kalender schließen"
                >
                  ✕
                </button>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleRangePrevMonth}
                  className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/20"
                >
                  Zurück
                </button>
                <div className="text-sm font-medium text-slate-900">
                  {MONTH_NAMES[pickerMeta.month - 1]} {pickerMeta.year}
                </div>
                <button
                  type="button"
                  onClick={handleRangeNextMonth}
                  className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/20"
                >
                  Weiter
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {requestType === 'vacation'
                  ? 'Wähle Start- und Enddatum aus. Mehrere Tage können markiert werden.'
                  : 'Wähle den Tag für den Überstundenabbau. Es wird automatisch nur dieser Tag gespeichert.'}
              </p>
              <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500">
                {WEEKDAY_LABELS.map((label) => (
                  <div key={label} className="py-1">
                    {label}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calendarCells.map((cell) => {
                  const isStart = resolvedRangeStart === cell.isoDate;
                  const isEnd = resolvedRangeEnd === cell.isoDate;
                  const inRange =
                    resolvedRangeStart && resolvedRangeEnd &&
                    compareIso(cell.isoDate, resolvedRangeStart) >= 0 &&
                    compareIso(cell.isoDate, resolvedRangeEnd) <= 0;

                  const baseClasses =
                    'relative flex h-10 items-center justify-center rounded-md border text-sm transition focus:outline-none';
                  const monthClasses = cell.inCurrentMonth
                    ? 'border-slate-300 text-slate-900'
                    : 'border-slate-200 text-slate-400';
                  const rangeClasses = inRange ? 'bg-emerald-100 border-emerald-200' : '';
                  const endpointClasses =
                    isStart || isEnd ? 'bg-emerald-600 text-white border-emerald-600 font-semibold' : '';

                  return (
                    <button
                      type="button"
                      key={cell.isoDate}
                      onClick={() => handleRangeDayClick(cell.isoDate)}
                      className={`${baseClasses} ${monthClasses} ${rangeClasses} ${endpointClasses}`}
                    >
                      {cell.label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                <div>Von: {formatIsoForDisplay(resolvedRangeStart)}</div>
                <div>Bis: {formatIsoForDisplay(resolvedRangeEnd)}</div>
              </div>
              {requestType === 'overtime' ? (
                <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Zeiten für den Überstundenabbau
                  </p>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm text-slate-700">
                      <span>Startzeit</span>
                      <input
                        type="time"
                        value={startTime}
                        onChange={(event) => handleStartTimeChange(event.target.value)}
                        className="rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                        required
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm text-slate-700">
                      <span>Endzeit</span>
                      <input
                        type="time"
                        value={endTime}
                        onChange={(event) => handleEndTimeChange(event.target.value)}
                        className="rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                        required
                      />
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Bitte gib an, in welchem Zeitfenster du Überstunden abbauen möchtest.
                  </p>
                </div>
              ) : null}
              {rangeError ? <p className="mt-3 text-xs text-red-600">{rangeError}</p> : null}
              <div className="mt-6 flex flex-wrap justify-end gap-2 text-sm">
                <button
                  type="button"
                  onClick={handleRangeCancel}
                  className="rounded-md border border-slate-300 px-3 py-2 font-medium text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-400"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={handleRangeApply}
                  className="rounded-md bg-brand px-3 py-2 font-medium text-white hover:bg-brand/90 focus:outline-none focus:ring-2 focus:ring-brand/40"
                >
                  Übernehmen
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {formState.status !== 'idle' && formState.message ? (
          <p className={`mt-4 rounded-lg border px-4 py-3 text-sm ${requestFeedbackClass}`}>{formState.message}</p>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <header className="mb-4 space-y-1">
          <h2 className="text-lg font-semibold text-slate-900">Bisherige Anträge</h2>
          <p className="text-sm text-slate-500">
            Übersicht deiner eingereichten Anträge inklusive aktuellem Status und Kommentar der Verwaltung.
          </p>
        </header>

        {sortedRequests.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
            Es liegen noch keine Anträge vor.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-600">
                    Zeitraum
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-600">
                    Typ
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-600">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-600">
                    Bemerkung
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-600">
                    Verwaltung
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-600">
                    Aktion
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {sortedRequests.map((request) => {
                  const statusBadgeClasses =
                    request.status === 'approved'
                      ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                      : request.status === 'rejected'
                      ? 'bg-red-100 text-red-700 border border-red-200'
                      : request.cancellationRequested
                      ? 'bg-amber-200 text-amber-800 border border-amber-300'
                      : 'bg-amber-100 text-amber-700 border border-amber-200';

                  return (
                    <tr key={request.id} className="bg-white transition hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">
                          {formatDate(request.startDate)} – {formatDate(request.endDate)}
                        </div>
                        <div className="text-xs text-slate-500">{request.totalDays} Tage</div>
                        {request.startTime && request.endTime ? (
                          <div className="text-xs text-slate-500">
                            Zeiten: {formatTimeLabel(request.startTime)} – {formatTimeLabel(request.endTime)}
                          </div>
                        ) : null}
                        <div className="text-xs text-slate-400">
                          Erstellt am {formatDate(request.createdAt.slice(0, 10))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{request.typeLabel}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClasses}`}>
                          {request.statusLabel}
                        </span>
                        {request.cancellationRequested ? (
                          <div className="mt-1 text-xs font-medium text-amber-700">
                            Storno angefragt am{' '}
                            {formatDateTime(request.cancellationRequestedAt ?? request.updatedAt) ??
                              formatDate((request.cancellationRequestedAt ?? request.updatedAt).slice(0, 10))}
                          </div>
                        ) : null}
                        {request.cancelledAt ? (
                          <div className="mt-1 text-xs text-slate-500">
                            Storniert am {formatDateTime(request.cancelledAt) ?? formatDate(request.cancelledAt.slice(0, 10))}
                          </div>
                        ) : null}
                        {!request.cancellationRequested && !request.cancelledAt && request.decidedAt ? (
                          <div className="mt-1 text-xs text-slate-400">
                            Aktualisiert am {formatDate(request.decidedAt.slice(0, 10))}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {request.reason ? request.reason : <span className="text-slate-400">—</span>}
                        {request.cancellationNote ? (
                          <div className="mt-2 text-xs text-slate-500">
                            Storno-Notiz: {request.cancellationNote}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {request.adminNote ? request.adminNote : <span className="text-slate-400">—</span>}
                        {request.decidedAt ? (
                          <div className="mt-2 text-xs text-slate-500">
                            Entscheidung am {formatDateTime(request.decidedAt) ?? '—'}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {request.status === 'pending' ? (
                          <form action={cancelFormAction} className="space-y-2">
                            <input type="hidden" name="request_id" value={request.id} />
                            <input type="hidden" name="mode" value="cancel_pending" />
                            <textarea
                              name="message"
                              rows={2}
                              maxLength={300}
                              placeholder="Optionaler Kommentar zur Stornierung"
                              className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                            />
                            <button
                              type="submit"
                              className="inline-flex items-center justify-center rounded-full border border-red-200 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red-600 transition hover:border-red-300 hover:bg-red-50"
                            >
                              Stornieren
                            </button>
                          </form>
                        ) : null}
                        {request.status === 'approved' && !request.cancellationRequested ? (
                          <form action={cancelFormAction} className="space-y-2">
                            <input type="hidden" name="request_id" value={request.id} />
                            <input type="hidden" name="mode" value="request_cancellation" />
                            <textarea
                              name="message"
                              rows={2}
                              maxLength={300}
                              placeholder="Optionaler Kommentar zur Stornoanfrage"
                              className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                            />
                            <button
                              type="submit"
                              className="inline-flex items-center justify-center rounded-full border border-amber-300 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-700 transition hover:border-amber-400 hover:bg-amber-50"
                            >
                              Storno anfragen
                            </button>
                          </form>
                        ) : null}
                        {request.cancellationRequested ? (
                          <p className="text-xs font-medium text-amber-700">Stornierung wird geprüft.</p>
                        ) : null}
                        {request.cancelledAt ? (
                          <p className="text-xs font-medium text-slate-500">Antrag storniert.</p>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {cancelState.status !== 'idle' && cancelState.message ? (
          <p className={`mt-4 rounded-lg border px-4 py-3 text-sm ${cancelFeedbackClass}`}>{cancelState.message}</p>
        ) : null}
      </section>
    </div>
  );
}
