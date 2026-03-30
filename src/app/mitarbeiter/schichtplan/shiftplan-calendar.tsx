'use client';

import { jsPDF } from 'jspdf';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
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
  hasPendingVacationRequest?: boolean;
  isHoliday?: boolean;
  holidayName?: string | null;
  branchId?: number | null;
  branchName?: string | null;
  segments?: Array<{
    segmentIndex: number;
    mode: 'available' | 'unavailable';
    start: string | null;
    end: string | null;
    pauseMinutes: number;
    label: string | null;
    branchId: number | null;
    branchName: string | null;
  }>;
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

type SegmentEditorRow = {
  key: string;
  start: string;
  end: string;
  branchId: string;
};

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

function parseTimeToMinutes(value: string): number | null {
  const trimmed = (value ?? '').trim();
  if (!/^\d{1,2}:\d{2}$/.test(trimmed)) return null;
  const [hhRaw, mmRaw] = trimmed.split(':', 2);
  const hh = Number.parseInt(hhRaw ?? '', 10);
  const mm = Number.parseInt(mmRaw ?? '', 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function hasOverlappingWorkTimes(segments: SegmentEditorRow[]): boolean {
  const intervals = segments
    .map((segment) => {
      const startMin = parseTimeToMinutes(segment.start);
      const endMin = parseTimeToMinutes(segment.end);
      if (startMin === null || endMin === null) return null;
      if (endMin <= startMin) return null;
      return { startMin, endMin };
    })
    .filter(Boolean)
    .sort((a, b) => a!.startMin - b!.startMin);

  for (let i = 1; i < intervals.length; i += 1) {
    const prev = intervals[i - 1]!;
    const cur = intervals[i]!;
    if (cur.startMin < prev.endMin) return true;
  }
  return false;
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

function monthYearOptions(rangeStart: string, rangeEnd: string) {
  const start = startOfMonth(toDate(rangeStart));
  const end = startOfMonth(toDate(rangeEnd));

  const years: number[] = [];
  for (let year = start.getFullYear(); year <= end.getFullYear(); year += 1) {
    years.push(year);
  }

  const monthLabels = Array.from({ length: 12 }, (_, monthIndex) =>
    new Date(2000, monthIndex, 1).toLocaleDateString('de-DE', { month: 'long' })
  );

  const monthsByYear = new Map<number, Array<{ value: string; label: string }>>();
  for (const year of years) {
    const list: Array<{ value: string; label: string }> = [];
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      const date = new Date(year, monthIndex, 1);
      date.setHours(0, 0, 0, 0);
      if (date < start || date > end) continue;
      list.push({
        value: toIso(date),
        label: monthLabels[monthIndex] ?? String(monthIndex + 1),
      });
    }
    monthsByYear.set(year, list);
  }

  return { years, monthsByYear };
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
  const { years, monthsByYear } = useMemo(() => monthYearOptions(rangeStart, rangeEnd), [rangeStart, rangeEnd]);

  const [currentMonthIso, setCurrentMonthIso] = useState(() => {
    const monthIso = toIso(startOfMonth(toDate(initialDate)));
    const exists = options.some((option) => option.value === monthIso);
    return exists ? monthIso : options[options.length - 1]?.value ?? monthIso;
  });

  const [selectedYear, setSelectedYear] = useState(() => {
    const currentYear = toDate(currentMonthIso).getFullYear();
    if (years.includes(currentYear)) return currentYear;
    return years[years.length - 1] ?? currentYear;
  });

  useEffect(() => {
    const currentYear = toDate(currentMonthIso).getFullYear();
    if (currentYear !== selectedYear) {
      setSelectedYear(currentYear);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMonthIso]);

  useEffect(() => {
    const months = monthsByYear.get(selectedYear) ?? [];
    if (!months.length) return;
    const currentYear = toDate(currentMonthIso).getFullYear();
    if (currentYear === selectedYear) return;
    setCurrentMonthIso(months[0]!.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear]);

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
  const holidayCheckRequestRef = useRef(0);
  const [editing, setEditing] = useState<ShiftPlanDayInfo | null>(null);
  const [segmentsValue, setSegmentsValue] = useState<SegmentEditorRow[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [holidayDecision, setHolidayDecision] = useState<'ask' | 'work' | null>(null);
  const [holidayName, setHolidayName] = useState<string | null>(null);
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
  const inputsDisabledByTemplate = hasTemplateSelected || isPending || holidayDecision === 'ask';
  const hasBranches = branches.length > 0;
  const defaultBranchId = useMemo(() => (branches.length === 1 ? String(branches[0].id) : ''), [branches]);

  const openEditor = (info: ShiftPlanDayInfo) => {
    const requestId = holidayCheckRequestRef.current + 1;
    holidayCheckRequestRef.current = requestId;
    setEditing(info);
    setSelectedTemplateId('');
    setHolidayDecision(null);
    setHolidayName(null);
    const segments = Array.isArray(info.segments) ? info.segments : [];
    const availableSegments = segments.filter((segment) => segment.mode === 'available' && segment.start && segment.end);
    if (availableSegments.length) {
      setSegmentsValue(
        availableSegments.map((segment, index) => ({
          key: `${info.isoDate}:${segment.segmentIndex}:${index}`,
          start: sanitizeTimeInput(segment.start),
          end: sanitizeTimeInput(segment.end),
          branchId:
            segment.branchId && branches.some((branch) => branch.id === segment.branchId)
              ? String(segment.branchId)
              : defaultBranchId,
        }))
      );
    } else if (info.start && info.end) {
      setSegmentsValue([
        {
          key: `${info.isoDate}:legacy:0`,
          start: sanitizeTimeInput(info.start),
          end: sanitizeTimeInput(info.end),
          branchId:
            info.branchId && branches.some((branch) => branch.id === info.branchId)
              ? String(info.branchId)
              : defaultBranchId,
        },
      ]);
    } else {
      setSegmentsValue(
        [
          {
            key: `${info.isoDate}:new:0`,
            start: '',
            end: '',
            branchId: defaultBranchId,
          },
        ]
      );
    }
    setError(null);

    const knownHolidayByEntry =
      (info.code ?? '').toUpperCase() === 'FT' || (info.label ?? '').trim().toLowerCase().includes('feiertag');
    if (knownHolidayByEntry) {
      setHolidayName((info.label ?? '').trim() || null);
      setHolidayDecision('ask');
      return;
    }

    void fetch(`/api/shift-plan/holiday-check?date=${encodeURIComponent(info.isoDate)}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json().catch(() => null)) as
          | { ok?: boolean; isHoliday?: boolean; name?: string | null }
          | null;
      })
      .then((payload) => {
        if (holidayCheckRequestRef.current !== requestId) return;
        if (payload?.ok && payload.isHoliday) {
          setHolidayName(payload.name ?? null);
          setHolidayDecision((prev) => prev ?? 'ask');
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (!editing || !selectedTemplate) return;

    const weekday = toWeekdayIndex(editing.isoDate);
    const templateDay = selectedTemplate.days.find((entry) => entry.weekday === weekday);
    const templateSegments = templateDay?.segments ?? [];
    if (!templateSegments.length) {
      setSegmentsValue([]);
      return;
    }

    const availableSegment = templateSegments.find(
      (segment) => segment.mode === 'available' && (segment.start || segment.end)
    );
    if (availableSegment) {
      setSegmentsValue([
        {
          key: `${editing.isoDate}:template:0`,
          start: sanitizeTimeInput(availableSegment.start),
          end: sanitizeTimeInput(availableSegment.end),
          branchId: defaultBranchId,
        },
      ]);
      return;
    }

    const unavailableSegment = templateSegments.find((segment) => segment.mode === 'unavailable');
    if (unavailableSegment) {
      const label = (unavailableSegment.label ?? '').trim() || NO_WORK_LABEL;
      if (isNoWorkLabel(label)) {
        setSegmentsValue([]);
      } else {
        setSegmentsValue([
          {
            key: `${editing.isoDate}:template:0`,
            start: sanitizeTimeInput(unavailableSegment.start),
            end: sanitizeTimeInput(unavailableSegment.end),
            branchId: defaultBranchId,
          },
        ]);
      }
      return;
    }

    setSegmentsValue([]);
  }, [editing, selectedTemplate, defaultBranchId]);

  const closeEditor = () => {
    if (isPending) return;
    holidayCheckRequestRef.current += 1;
    setEditing(null);
    setSegmentsValue([]);
    setSelectedTemplateId('');
    setHolidayDecision(null);
    setHolidayName(null);
    setError(null);
  };

  const submitUpdate = (payload: { label: string; segments: SegmentEditorRow[] }) => {
    if (!editing || !updateAction) return;
    const normalizedSegments = payload.segments
      .map((segment, index) => {
        const start = segment.start.trim();
        const end = segment.end.trim();
        if (!start || !end) return null;
        const branchId = segment.branchId ? Number(segment.branchId) : null;
        return {
          segmentIndex: index,
          mode: 'available' as const,
          start,
          end,
          requiredPauseMinutes: 0,
          label: null,
          branchId: Number.isFinite(branchId as number) && (branchId as number) > 0 ? Number(branchId) : null,
        };
      })
      .filter(Boolean);

    const formData = new FormData();
    formData.set('isoDate', editing.isoDate);
    formData.set('label', payload.label);
    formData.set('segments', JSON.stringify(normalizedSegments));

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
    const weekStart = toIso(startOfWeek(toDate(editing.isoDate)));
    const formData = new FormData();
    formData.set('weekStart', weekStart);
    if (selectedTemplateId) {
      formData.set('templateId', selectedTemplateId);
      formData.set('label', '');
    } else {
      const invalid = segmentsValue.some((segment) => {
        const start = segment.start.trim();
        const end = segment.end.trim();
        return (start && !end) || (!start && end);
      });
      if (invalid) {
        setError('Bitte Start- und Endzeit angeben oder beide Felder leer lassen.');
        return;
      }

      const invalidOrder = segmentsValue.some((segment) => {
        const startMin = parseTimeToMinutes(segment.start);
        const endMin = parseTimeToMinutes(segment.end);
        if (startMin === null || endMin === null) return false;
        return endMin <= startMin;
      });
      if (invalidOrder) {
        setError('Endzeit muss nach der Startzeit liegen.');
        return;
      }

      if (hasOverlappingWorkTimes(segmentsValue)) {
        setError('Arbeitszeiten dürfen sich nicht überschneiden.');
        return;
      }

      if (branches.length > 1) {
        const missingBranch = segmentsValue.some((segment) => {
          const start = segment.start.trim();
          const end = segment.end.trim();
          return Boolean(start && end) && !segment.branchId;
        });
        if (missingBranch) {
          setError('Bitte zuerst einen Standort auswählen.');
          return;
        }
      }

      const normalizedSegments = segmentsValue
        .map((segment, index) => {
          const start = segment.start.trim();
          const end = segment.end.trim();
          if (!start || !end) return null;
          const branchId = segment.branchId ? Number(segment.branchId) : null;
          return {
            segmentIndex: index,
            mode: 'available' as const,
            start,
            end,
            requiredPauseMinutes: 0,
            label: null,
            branchId: Number.isFinite(branchId as number) && (branchId as number) > 0 ? Number(branchId) : null,
          };
        })
        .filter(Boolean);
      formData.set('segments', JSON.stringify(normalizedSegments));
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
    const invalid = segmentsValue.some((segment) => {
      const start = segment.start.trim();
      const end = segment.end.trim();
      return (start && !end) || (!start && end);
    });
    if (invalid) {
      setError('Bitte Start- und Endzeit angeben oder beide Felder leer lassen.');
      return;
    }

    const invalidOrder = segmentsValue.some((segment) => {
      const startMin = parseTimeToMinutes(segment.start);
      const endMin = parseTimeToMinutes(segment.end);
      if (startMin === null || endMin === null) return false;
      return endMin <= startMin;
    });
    if (invalidOrder) {
      setError('Endzeit muss nach der Startzeit liegen.');
      return;
    }

    if (hasOverlappingWorkTimes(segmentsValue)) {
      setError('Arbeitszeiten dürfen sich nicht überschneiden.');
      return;
    }

    if (branches.length > 1) {
      const missingBranch = segmentsValue.some((segment) => {
        const start = segment.start.trim();
        const end = segment.end.trim();
        return Boolean(start && end) && !segment.branchId;
      });
      if (missingBranch) {
        setError('Bitte zuerst einen Standort auswählen.');
        return;
      }
    }

    submitUpdate({ label: '', segments: segmentsValue });
  };

  const handleDelete = () => {
    submitUpdate({ label: '', segments: [] });
  };

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Monat</p>
          <p className="text-lg font-semibold text-slate-900">{monthLabel}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Jahr wählen
            <select
              value={String(selectedYear)}
              onChange={(event) => setSelectedYear(Number(event.target.value))}
              className="rounded-full border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            >
              {years.map((year) => (
                <option key={year} value={String(year)}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Monat wählen
            <select
              value={currentMonthIso}
              onChange={(event) => setCurrentMonthIso(event.target.value)}
              className="rounded-full border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            >
              {(monthsByYear.get(selectedYear) ?? []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        <button
          type="button"
          onClick={() => {
            const header = 'Datum;Start;Ende;Pause_Min;Notiz;Code\n';
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
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="min-w-[720px]">
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
            const segments = (info?.segments ?? []).filter(
              (segment) => segment.mode === 'available' && Boolean(segment.start && segment.end)
            );
            const hasTime = Boolean(
              (segments.length > 0 && segments[0]?.start && segments[0]?.end) ||
                (info?.start && info?.end && info.start !== '00:00' && info.end !== '00:00')
            );
            const hasLabel = Boolean(info?.label && info.label.trim().length > 0);
            const isAbsence = Boolean(info) && !info?.isAvailable;
            const hasPendingVacation = Boolean(info?.hasPendingVacationRequest);

            let primaryLine = '';
            if (isAbsence) {
              primaryLine = info?.label ?? 'Nicht verfügbar';
            } else if (hasPendingVacation) {
              primaryLine = 'Urlaub angefragt';
            } else if (segments.length > 1) {
              primaryLine = `${segments.length} Arbeitszeiten`;
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
            } else if (hasPendingVacation) {
              classes.push('border-rose-200 bg-rose-50/40 text-rose-700');
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
                  {!isAbsence && segments.length > 1 ? (
                    <div className="mt-2 space-y-1 text-xs text-slate-600">
                      {segments.map((segment) => {
                        const branchHint = segment.branchName ? ` (${segment.branchName})` : '';
                        return (
                          <p key={`${isoDate}:${segment.segmentIndex}`}>
                            {segment.start} – {segment.end}
                            {branchHint}
                          </p>
                        );
                      })}
                    </div>
                  ) : null}
                  {isAbsence && hasTime ? (
                    <p className="mt-1 text-xs text-slate-500">Plan: {info?.start} – {info?.end}</p>
                  ) : null}
                  {info?.branchName && segments.length <= 1 ? (
                    <p className="mt-1 text-xs text-slate-500">{info.branchName}</p>
                  ) : null}
                  {info?.code ? (
                    <span className="mt-2 inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                      {info.code}
                    </span>
                  ) : null}
                  {hasPendingVacation ? (
                    <span className="mt-2 inline-flex items-center rounded-full bg-rose-100/70 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-rose-700">
                      Urlaub angefragt
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
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Anzeige umfasst den Zeitraum {rangeStart} bis {rangeEnd}.{' '}
        {canEdit
          ? 'Änderungen werden direkt im zentralen Schichtplan gespeichert.'
          : 'Für weiterführende Anpassungen wende dich bitte an den Admin.'}
      </p>

      {canEdit && editing ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeEditor();
            }
          }}
        >
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <header className="mb-4 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Schicht bearbeiten</p>
              <h3 className="text-lg font-semibold text-slate-900">{editing.isoDate}</h3>
            </header>

            {!hasTemplateSelected && holidayDecision === 'ask' ? (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-sm font-semibold text-amber-900">
                  {holidayName ? `${holidayName} (Feiertag)` : 'Feiertag'}
                </p>
                <p className="mt-1 text-xs text-amber-800">
                  Soll dieser Tag als Feiertag gespeichert werden?
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      submitUpdate({ label: 'Feiertag', segments: [] });
                    }}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                      holidayDecision === 'ask'
                        ? 'border-amber-400 bg-amber-100 text-amber-900'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                    disabled={isPending}
                  >
                    Ja, als Feiertag speichern
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHolidayDecision('work');
                      if (!segmentsValue.length) {
                        setSegmentsValue([
                          {
                            key:
                              typeof crypto !== 'undefined' && 'randomUUID' in crypto
                                ? crypto.randomUUID()
                                : `${Date.now()}-${Math.random()}`,
                            start: '',
                            end: '',
                            branchId: defaultBranchId,
                          },
                        ]);
                      }
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    disabled={isPending}
                  >
                    Nein, als Arbeitstag erfassen
                  </button>
                </div>
              </div>
            ) : null}

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

            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Arbeitszeiten</p>
                    <button
                      type="button"
                      onClick={() => {
                        setSegmentsValue((prev) => [
                          ...prev,
                          {
                            key: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
                            start: '',
                            end: '',
                            branchId: defaultBranchId,
                          },
                        ]);
                      }}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={inputsDisabledByTemplate}
                    >
                      Arbeitszeit hinzufügen
                    </button>
                  </div>

                  {segmentsValue.length ? (
                    <div className="mt-3 space-y-3">
                      {segmentsValue.map((segment) => (
                        <div key={segment.key} className="grid gap-3 sm:grid-cols-2">
                          <label className="flex flex-col gap-1 text-sm">
                            <span className="font-medium text-slate-700">Start</span>
                            <input
                              type="time"
                              value={segment.start}
                              onChange={(event) => {
                                const value = event.target.value;
                                setSegmentsValue((prev) =>
                                  prev.map((entry) => (entry.key === segment.key ? { ...entry, start: value } : entry))
                                );
                              }}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-slate-100"
                              disabled={inputsDisabledByTemplate}
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-sm">
                            <span className="font-medium text-slate-700">Ende</span>
                            <input
                              type="time"
                              value={segment.end}
                              onChange={(event) => {
                                const value = event.target.value;
                                setSegmentsValue((prev) =>
                                  prev.map((entry) => (entry.key === segment.key ? { ...entry, end: value } : entry))
                                );
                              }}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-slate-100"
                              disabled={inputsDisabledByTemplate}
                            />
                          </label>

                          {branches.length > 1 ? (
                            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                              <span className="font-medium text-slate-700">Standort</span>
                              <select
                                value={segment.branchId}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setSegmentsValue((prev) =>
                                    prev.map((entry) =>
                                      entry.key === segment.key ? { ...entry, branchId: value } : entry
                                    )
                                  );
                                }}
                                className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-slate-100"
                                disabled={!hasBranches || isPending}
                              >
                                <option value="">Bitte auswählen</option>
                                {branches.map((branch) => (
                                  <option key={branch.id} value={branch.id}>
                                    {branch.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : null}

                          {segmentsValue.length > 1 ? (
                            <div className="sm:col-span-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setSegmentsValue((prev) => prev.filter((entry) => entry.key !== segment.key));
                                }}
                                className="rounded-lg border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={inputsDisabledByTemplate}
                              >
                                Arbeitszeit entfernen
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-600">Noch keine Arbeitszeiten hinterlegt.</p>
                  )}
                </div>
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
