'use client';

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type { EmployeeListItem } from '@/lib/data/employees';
import type {
  WeeklyShiftPlan,
  WeeklyShiftPlanCell,
  WeeklyShiftPlanRow,
  WeeklyShiftTemplate,
} from '@/lib/services/shift-plan';
import { isHolidayIsoDate, normalizeHolidayRegion } from '@/lib/services/holidays';

import WeekPatternDrawer from './WeekPatternDrawer';

type UpdateAction = (formData: FormData) => Promise<{ success: boolean; error?: string }>;

type CreatePatternAction = (formData: FormData) => Promise<{ success: boolean; error?: string }>;

type ClearWeekAction = (formData: FormData) => Promise<{ success: boolean; error?: string }>;

type FillWeekAction = (formData: FormData) => Promise<{ success: boolean; error?: string }>;

type ShiftPlanBoardProps = {
  week: WeeklyShiftPlan;
  employees: EmployeeListItem[];
  updateAction: UpdateAction;
  clearWeekAction: ClearWeekAction;
  fillWeekAction: FillWeekAction;
  createPatternAction: CreatePatternAction;
  templates: WeeklyShiftTemplate[];
  basePath?: string;
  templatesPath?: string | null;
  stickyOffset?: number;
  showUsername?: boolean;
  editable?: boolean;
};

type EditingContext = {
  employee: WeeklyShiftPlanRow;
  cell: WeeklyShiftPlanCell;
};

const ADMIN_STICKY_BASE_OFFSET = 130;
const NO_WORK_LABEL = 'Kein Arbeitstag';
const NO_WORK_LABEL_LOWER = NO_WORK_LABEL.toLowerCase();
const isNoWorkLabel = (value: string | null | undefined): boolean =>
  (value ?? '').trim().toLowerCase() === NO_WORK_LABEL_LOWER;

const QUICK_STATUS_PRESETS = [
  { label: 'Verfügbar', type: 'available' as const },
  { label: 'Urlaub', type: 'absence' as const },
  { label: 'Krank', type: 'absence' as const },
  { label: 'Schulung/Fortbildung', type: 'absence' as const },
  { label: 'Überstundenabbau', type: 'absence' as const },
  { label: 'Kurzarbeit', type: 'absence' as const },
  { label: 'Feiertag', type: 'absence' as const },
  { label: 'Kein Arbeitstag', type: 'no-work' as const },
];

type HolidayInfo = {
  isHoliday: boolean;
  name?: string;
  region?: string | null;
  branchName?: string | null;
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

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatRangeLabel(startIso: string, endIso: string): string {
  const startDate = new Date(`${startIso}T00:00:00`);
  const endDate = new Date(`${endIso}T00:00:00`);
  const formatter = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' });
  return `${formatter.format(startDate)} – ${formatter.format(endDate)}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
}

function resolveHolidayInfo(
  row: WeeklyShiftPlanRow,
  isoDate: string,
  branchId?: number | null
): HolidayInfo {
  const fallbackBranch = row.branches.length === 1 ? row.branches[0] : null;
  const resolvedBranch =
    branchId && Number.isFinite(branchId)
      ? row.branches.find((branch) => branch.id === branchId) ?? null
      : fallbackBranch;
  if (!resolvedBranch) {
    return { isHoliday: false };
  }
  const region = normalizeHolidayRegion(resolvedBranch.federalState ?? resolvedBranch.country ?? null);
  if (!region) {
    return { isHoliday: false };
  }
  const info = isHolidayIsoDate(isoDate, region);
  return {
    isHoliday: info.isHoliday,
    name: info.name,
    region,
    branchName: resolvedBranch.name,
  };
}

function parseBranchId(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolveSelectedBranchId(row: WeeklyShiftPlanRow, branchValue: string): number | null {
  if (branchValue && branchValue.trim()) {
    return parseBranchId(branchValue);
  }
  if (row.branches.length === 1) {
    return row.branches[0].id;
  }
  return null;
}

function resolveVariant(cell: WeeklyShiftPlanCell, holidayInfo?: HolidayInfo): {
  container: string;
  title: string;
  subtitle: string;
} {
  const branchLabel = cell.branchName ?? holidayInfo?.branchName ?? null;
  const branchSuffix = branchLabel ? ` · ${branchLabel}` : '';
  const label = cell.label?.trim();
  if (isNoWorkLabel(label)) {
    const subtitle = branchSuffix ? `Frei${branchSuffix}` : 'Frei';
    return {
      container: 'bg-slate-50 text-slate-400 border border-slate-200',
      title: 'Keine Schicht',
      subtitle,
    };
  }
  if (holidayInfo?.isHoliday && !label && !cell.start && !cell.end) {
    const subtitle = holidayInfo.name ? holidayInfo.name : 'Feiertag';
    return {
      container: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
      title: 'Feiertag',
      subtitle: branchSuffix ? `${subtitle}${branchSuffix}` : subtitle,
    };
  }
  if (label) {
    const normalized = label.toLowerCase();
    if (normalized.includes('urlaub') || normalized.includes('frei')) {
      const subtitle = 'Urlaub';
      return {
        container: 'bg-rose-100 text-rose-700 border border-rose-200',
        title: label,
        subtitle: branchSuffix ? `${subtitle}${branchSuffix}` : subtitle,
      };
    }
    if (normalized.includes('krank')) {
      const subtitle = 'Krank';
      return {
        container: 'bg-amber-100 text-amber-700 border border-amber-200',
        title: label,
        subtitle: branchSuffix ? `${subtitle}${branchSuffix}` : subtitle,
      };
    }
    if (
      normalized.includes('feiertag') ||
      normalized.includes('feier') ||
      normalized.includes('sonder') ||
      normalized.includes('holiday')
    ) {
      const subtitle = 'Feiertag';
      return {
        container: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
        title: label,
        subtitle: branchSuffix ? `${subtitle}${branchSuffix}` : subtitle,
      };
    }
    const subtitle = cell.start && cell.end ? 'Spezial-Schicht' : 'Status';
    return {
      container: 'bg-sky-100 text-sky-700 border border-sky-200',
      title: label,
      subtitle: branchSuffix ? `${subtitle}${branchSuffix}` : subtitle,
    };
  }

  if (cell.start && cell.end) {
    const subtitle = cell.source === 'fallback' ? 'Plan (Standard)' : 'Verfügbar';
    const container =
      cell.source === 'fallback'
        ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
        : 'bg-emerald-100 text-emerald-700 border border-emerald-200';
    return {
      container,
      title: `${cell.start} – ${cell.end}`,
      subtitle: branchSuffix ? `${subtitle}${branchSuffix}` : subtitle,
    };
  }

  const subtitle = 'Frei';
  return {
    container: 'bg-slate-50 text-slate-400 border border-slate-200',
    title: 'Keine Schicht',
    subtitle: branchSuffix ? `${subtitle}${branchSuffix}` : subtitle,
  };
}

function resolveSegmentVariant(
  segment: WeeklyShiftPlanCell['segments'][number],
  holidayInfo?: HolidayInfo
): { container: string; title: string; subtitle: string } {
  const labelRaw = segment.label?.trim() ?? '';
  const labelLower = labelRaw.toLowerCase();
  const branchLabel = segment.branchName ?? holidayInfo?.branchName ?? null;
  const holidayLabel =
    holidayInfo?.isHoliday && !labelLower.includes('feiertag')
      ? `Feiertag${holidayInfo.name ? ` · ${holidayInfo.name}` : ''}`
      : null;
  const metaParts = [branchLabel, holidayLabel].filter(Boolean) as string[];
  const metaSuffix = metaParts.join(' · ');
  const withMeta = (value: string | null) =>
    value ? [value, ...metaParts].filter(Boolean).join(' · ') : metaSuffix;

  const hasTimes = Boolean(segment.start && segment.end);

  if (isNoWorkLabel(labelRaw)) {
    return {
      container: 'bg-slate-50 text-slate-400 border border-slate-200',
      title: 'Keine Schicht',
      subtitle: withMeta('Frei'),
    };
  }

  if (labelLower.includes('urlaub') || labelLower.includes('frei')) {
    return {
      container: 'bg-rose-100 text-rose-700 border border-rose-200',
      title: hasTimes ? `${segment.start} – ${segment.end}` : labelRaw,
      subtitle: hasTimes ? withMeta(labelRaw) : metaSuffix,
    };
  }

  if (labelLower.includes('krank')) {
    return {
      container: 'bg-amber-100 text-amber-700 border border-amber-200',
      title: hasTimes ? `${segment.start} – ${segment.end}` : labelRaw,
      subtitle: hasTimes ? withMeta(labelRaw) : metaSuffix,
    };
  }

  if (
    labelLower.includes('feiertag') ||
    labelLower.includes('feier') ||
    labelLower.includes('sonder') ||
    labelLower.includes('holiday')
  ) {
    return {
      container: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
      title: hasTimes ? `${segment.start} – ${segment.end}` : (labelRaw || 'Feiertag'),
      subtitle: hasTimes ? withMeta(labelRaw || 'Feiertag') : metaSuffix,
    };
  }

  if (labelRaw) {
    return {
      container: 'bg-sky-100 text-sky-700 border border-sky-200',
      title: hasTimes ? `${segment.start} – ${segment.end}` : labelRaw,
      subtitle: hasTimes ? withMeta(labelRaw) : metaSuffix,
    };
  }

  if (hasTimes) {
    const statusLabel = segment.mode === 'available' ? 'Verfügbar' : 'Nicht verfügbar';
    return {
      container:
        segment.mode === 'available'
          ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
          : 'bg-slate-100 text-slate-600 border border-slate-200',
      title: `${segment.start} – ${segment.end}`,
      subtitle: withMeta(statusLabel),
    };
  }

  return {
    container: 'bg-white text-slate-400 border border-slate-200',
    title: '',
    subtitle: metaSuffix,
  };
}

function findDayLabel(week: WeeklyShiftPlan, isoDate: string): { primary: string; secondary: string } {
  const match = week.days.find((day) => day.isoDate === isoDate);
  if (!match) {
    return { primary: isoDate, secondary: '' };
  }
  return {
    primary: `${match.weekdayShort}, ${match.dayLabel}`,
    secondary: '',
  };
}

export default function ShiftPlanBoard({
  week,
  employees,
  updateAction,
  clearWeekAction,
  fillWeekAction,
  createPatternAction,
  templates,
  basePath,
  templatesPath,
  stickyOffset,
  showUsername = true,
  editable = true,
}: ShiftPlanBoardProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<EditingContext | null>(null);
  const [startValue, setStartValue] = useState('');
  const [endValue, setEndValue] = useState('');
  const [pauseValue, setPauseValue] = useState('');
  const [labelValue, setLabelValue] = useState('');
  const [branchValue, setBranchValue] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isPatternOpen, setPatternOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [scrollMetrics, setScrollMetrics] = useState({ left: 0, width: 0 });
  const resolvedBasePath = basePath ?? '/admin/schichtplan';
  const resolvedTemplatesPath = templatesPath === undefined ? '/admin/schichtplan/vorlagen' : templatesPath;
  const resolvedStickyOffset = stickyOffset ?? ADMIN_STICKY_BASE_OFFSET;
  const isEditable = editable;

  const rangeLabel = useMemo(() => formatRangeLabel(week.weekStart, week.weekEnd), [week.weekEnd, week.weekStart]);
  const editingHolidayInfo = useMemo(() => {
    if (!editing) return null;
    const branchId = resolveSelectedBranchId(editing.employee, branchValue);
    const info = resolveHolidayInfo(editing.employee, editing.cell.isoDate, branchId);
    return info.isHoliday ? info : null;
  }, [branchValue, editing]);

  useEffect(() => {
    const node = scrollContainerRef.current;
    if (!node) {
      return;
    }

    const updateWidth = () => {
      setScrollMetrics((prev) => {
        const width = node.scrollWidth;
        if (prev.width === width) {
          return prev;
        }
        return { ...prev, width };
      });
    };

    const handleScroll = () => {
      const left = node.scrollLeft;
      setScrollMetrics((prev) => {
        if (prev.left === left) {
          return prev;
        }
        return { ...prev, left };
      });
    };

    updateWidth();
    handleScroll();

    node.addEventListener('scroll', handleScroll, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof window !== 'undefined' && 'ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(updateWidth);
      resizeObserver.observe(node);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', updateWidth);
    }

    return () => {
      node.removeEventListener('scroll', handleScroll);
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else if (typeof window !== 'undefined') {
        window.removeEventListener('resize', updateWidth);
      }
    };
  }, [week.weekStart, week.weekEnd, employees.length]);

  const goToWeek = (delta: number) => {
    const nextWeekStart = addDays(week.weekStart, delta * 7);
    router.replace(`${resolvedBasePath}?week=${nextWeekStart}`, { scroll: false });
  };

  const goToToday = () => {
    router.replace(resolvedBasePath, { scroll: false });
  };

  const handleOpenEditor = (context: EditingContext) => {
    if (!isEditable) return;
    setEditing(context);
    setStartValue(context.cell.start ?? '00:00');
    setEndValue(context.cell.end ?? '00:00');
    setPauseValue(context.cell.requiredPauseMinutes ? String(context.cell.requiredPauseMinutes) : '');
    setLabelValue(context.cell.label ?? '');
    const candidateBranch = context.cell.branchId ? String(context.cell.branchId) : '';
    const allowedBranches = context.employee.branches ?? [];
    if (candidateBranch && allowedBranches.some((branch) => String(branch.id) === candidateBranch)) {
      setBranchValue(candidateBranch);
    } else if (allowedBranches.length === 1) {
      setBranchValue(String(allowedBranches[0].id));
    } else {
      setBranchValue('');
    }
    setSelectedTemplateId('');
    setError(null);
  };

  const handleClose = () => {
    if (isPending) return;
    setEditing(null);
    setError(null);
    setStartValue('00:00');
    setEndValue('00:00');
    setPauseValue('');
    setLabelValue('');
    setBranchValue('');
  };

  const handleSave = () => {
    if (!editing) return;
    if (hasTemplateSelected) {
      handleFillWeek();
      return;
    }
    const trimmedLabel = labelValue.trim();
    const isNoWork = isNoWorkLabel(trimmedLabel);
    const hasStart = Boolean(startValue.trim());
    const hasEnd = Boolean(endValue.trim());
    if (!isNoWork && (!hasStart || !hasEnd)) {
      setError('Bitte Start- und Endzeit angeben oder "Kein Arbeitstag" wählen.');
      return;
    }
    const formData = new FormData();
    formData.set('employeeId', String(editing.employee.employeeId));
    formData.set('isoDate', editing.cell.isoDate);
    formData.set('weekStart', week.weekStart);
    formData.set('start', startValue.trim());
    formData.set('end', endValue.trim());
    formData.set('pause', pauseValue);
    formData.set('label', trimmedLabel);
    const selectedBranchId = resolveSelectedBranchId(editing.employee, branchValue);
    formData.set('branchId', selectedBranchId ? String(selectedBranchId) : '');

    const holidayInfo = resolveHolidayInfo(
      editing.employee,
      editing.cell.isoDate,
      selectedBranchId
    );
    if (holidayInfo.isHoliday && hasStart && hasEnd) {
      const holidayLabel = holidayInfo.name ? ` (${holidayInfo.name})` : '';
      const confirmed = window.confirm(
        `Der ausgewählte Tag ist ein Feiertag${holidayLabel}. Soll trotzdem eine Schicht geplant werden?`
      );
      if (!confirmed) {
        return;
      }
    }

    startTransition(() => {
      updateAction(formData).then((result) => {
        if (result.success) {
          setEditing(null);
          setError(null);
          router.refresh();
        } else {
          setError(result.error ?? 'Unbekannter Fehler.');
        }
      });
    });
  };

  const handleClear = () => {
    if (!editing) return;
    const formData = new FormData();
    formData.set('employeeId', String(editing.employee.employeeId));
    formData.set('isoDate', editing.cell.isoDate);
    formData.set('weekStart', week.weekStart);
    formData.set('start', '');
    formData.set('end', '');
    formData.set('pause', '');
    formData.set('label', '');
    formData.set('branchId', '');
    formData.set('branchId', '');

    startTransition(() => {
      updateAction(formData).then((result) => {
        if (result.success) {
          setEditing(null);
          setError(null);
          router.refresh();
        } else {
          setError(result.error ?? 'Unbekannter Fehler.');
        }
      });
    });
  };

  const handleClearWeek = () => {
    if (!editing) return;
    const formData = new FormData();
    formData.set('employeeId', String(editing.employee.employeeId));
    formData.set('weekStart', week.weekStart);

    startTransition(() => {
      clearWeekAction(formData).then((result) => {
        if (result.success) {
          setEditing(null);
          setError(null);
          router.refresh();
        } else {
          setError(result.error ?? 'Unbekannter Fehler.');
        }
      });
    });
  };

  const handleFillWeek = () => {
    if (!editing) return;
    if (!selectedTemplateId) {
      setError('Bitte zuerst eine Schichtvorlage auswählen.');
      return;
    }
    const formData = new FormData();
    formData.set('employeeId', String(editing.employee.employeeId));
    formData.set('weekStart', week.weekStart);
    formData.set('templateId', String(selectedTemplateId));
    formData.set('label', hasTemplateSelected ? '' : labelValue.trim());
    const selectedBranchId = resolveSelectedBranchId(editing.employee, branchValue);
    if (selectedBranchId) {
      const holidayDays = week.days.filter((day) =>
        resolveHolidayInfo(editing.employee, day.isoDate, selectedBranchId).isHoliday
      );
      if (holidayDays.length) {
        const confirmed = window.confirm(
          `Die Woche enthält ${holidayDays.length} Feiertag${holidayDays.length === 1 ? '' : 'e'}. Soll die Vorlage trotzdem angewendet werden?`
        );
        if (!confirmed) {
          return;
        }
      }
    }
    formData.set('branchId', selectedBranchId ? String(selectedBranchId) : '');

    startTransition(() => {
      fillWeekAction(formData).then((result) => {
        if (result.success) {
          setEditing(null);
          setError(null);
          router.refresh();
        } else {
          setError(result.error ?? 'Unbekannter Fehler.');
        }
      });
    });
  };

  const handleQuickStatus = (preset: (typeof QUICK_STATUS_PRESETS)[number]) => {
    if (isPending || !editing) return;
    switch (preset.type) {
      case 'available':
        setLabelValue('');
        break;
      case 'absence':
        setLabelValue(preset.label);
        if (!hasTemplateSelected) {
          const baseStart = sanitizeTimeInput(startValue || editing.cell.start);
          const baseEnd = sanitizeTimeInput(endValue || editing.cell.end);
          setStartValue(baseStart);
          setEndValue(baseEnd);
          if (!pauseValue.trim() && editing.cell.requiredPauseMinutes) {
            setPauseValue(String(editing.cell.requiredPauseMinutes));
          }
        }
        break;
      case 'no-work':
        setLabelValue(preset.label);
        setStartValue('');
        setEndValue('');
        setPauseValue('');
        setBranchValue('');
        break;
      default:
        break;
    }
  };

  const selectedTemplate = selectedTemplateId
    ? templates.find((template) => template.id === selectedTemplateId)
    : null;

  const hasTemplateSelected = Boolean(selectedTemplateId);
  const inputsDisabledByTemplate = hasTemplateSelected || isPending;

  useEffect(() => {
    if (!editing) return;
    if (!selectedTemplate) return;

    const date = new Date(`${editing.cell.isoDate}T00:00:00`);
    const weekdayIndex = Number.isNaN(date.getTime()) ? 0 : (date.getDay() + 6) % 7; // Monday = 0
    const templateDay = selectedTemplate.days.find((day) => day.weekday === weekdayIndex);

    if (!templateDay) {
      setStartValue('');
      setEndValue('');
      setPauseValue('');
      setLabelValue('');
      return;
    }

    const availableSegment = templateDay.segments.find(
      (segment) => segment.mode === 'available' && (segment.start || segment.end)
    );
    if (availableSegment) {
      setStartValue(sanitizeTimeInput(availableSegment.start));
      setEndValue(sanitizeTimeInput(availableSegment.end));
      setPauseValue(
        availableSegment.requiredPauseMinutes !== undefined && availableSegment.requiredPauseMinutes !== null
          ? String(availableSegment.requiredPauseMinutes)
          : ''
      );
      setLabelValue(availableSegment.label?.trim() ?? '');
      return;
    }

    const unavailableSegment = templateDay.segments.find((segment) => segment.mode === 'unavailable');
    if (unavailableSegment) {
      const label = (unavailableSegment.label ?? '').trim() || 'Kein Arbeitstag';
      setLabelValue(label);
      if (label.toLowerCase() === 'kein arbeitstag') {
        setStartValue('');
        setEndValue('');
        setPauseValue('');
      } else {
        setStartValue(sanitizeTimeInput(unavailableSegment.start));
        setEndValue(sanitizeTimeInput(unavailableSegment.end));
        setPauseValue(
          unavailableSegment.requiredPauseMinutes !== undefined && unavailableSegment.requiredPauseMinutes !== null
            ? String(unavailableSegment.requiredPauseMinutes)
            : ''
        );
      }
      return;
    }

    setStartValue('');
    setEndValue('');
    setPauseValue('');
    setLabelValue('');
  }, [editing, selectedTemplate]);

  const handleOpenPattern = () => {
    if (!isEditable) return;
    setPatternOpen(true);
  };

  const handleClosePattern = () => {
    if (isPending) return;
    setPatternOpen(false);
  };

  const handlePatternSaved = () => {
    setPatternOpen(false);
    router.refresh();
  };

  const handleManageTemplates = () => {
    if (!resolvedTemplatesPath) return;
    router.push(resolvedTemplatesPath);
  };

  const employeeLookup = useMemo(() => {
    const map = new Map<number, EmployeeListItem>();
    for (const employee of employees) {
      map.set(employee.id, employee);
    }
    return map;
  }, [employees]);

  const gridTemplateClass = 'grid min-w-[920px] grid-cols-[220px_repeat(7,minmax(140px,1fr))] text-sm';
  const overlayHeaderStyle = useMemo(() => {
    const style: React.CSSProperties = {
      transform: `translateX(-${scrollMetrics.left}px)`,
    };
    if (scrollMetrics.width > 0) {
      style.width = `${scrollMetrics.width}px`;
    }
    return style;
  }, [scrollMetrics.left, scrollMetrics.width]);

  return (
    <section className="space-y-4">
      <div
        className="sticky z-20 space-y-3 border-b border-slate-200 bg-slate-100/95 px-2 py-2 backdrop-blur"
        style={{ top: `${resolvedStickyOffset}px` }}
      >
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Schichtplan</h1>
            <p className="text-sm text-slate-500">
              Plane Verfügbarkeiten und Abwesenheiten pro Woche. Tippe oder klicke auf eine Zelle, um Zeiten zu bearbeiten.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              onClick={goToToday}
              className="rounded-full border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              Heute
            </button>
            <div className="flex items-center rounded-full border border-slate-200 bg-white px-2 py-1 shadow-sm">
              <button
                type="button"
                onClick={() => goToWeek(-1)}
                className="rounded-full px-3 py-2 text-slate-500 hover:bg-slate-100 focus:outline-none"
                aria-label="Vorherige Woche"
              >
                ◀
              </button>
              <div className="px-3 text-sm font-medium text-slate-700">{rangeLabel}</div>
              <button
                type="button"
                onClick={() => goToWeek(1)}
                className="rounded-full px-3 py-2 text-slate-500 hover:bg-slate-100 focus:outline-none"
                aria-label="Nächste Woche"
              >
                ▶
              </button>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              Woche {week.weekNumber}
            </span>
            {isEditable && resolvedTemplatesPath ? (
              <button
                type="button"
                onClick={handleManageTemplates}
                className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300"
              >
                Vorlagen verwalten
              </button>
            ) : null}
            {isEditable ? (
              <button
                type="button"
                onClick={handleOpenPattern}
                className="rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-300"
              >
                Neue Schicht
              </button>
            ) : null}
          </div>
        </header>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="min-w-[920px]" style={overlayHeaderStyle}>
            <div className={`${gridTemplateClass} text-xs font-semibold uppercase tracking-wide text-slate-500`}>
              <div className="bg-slate-50 px-4 py-2">Ressourcen</div>
              {week.days.map((day) => (
                <div
                  key={day.isoDate}
                  className={`border-l border-slate-200 px-3 py-2 text-center ${
                    day.isToday ? 'bg-slate-100 text-slate-900' : 'bg-slate-50 text-slate-500'
                  }`}
                >
                  <div>{day.weekdayShort}</div>
                  <div className="mt-1 font-normal normal-case text-slate-600">{day.dayLabel}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm" ref={scrollContainerRef}>
        <div className="min-w-[920px]" role="grid">
          <div className={gridTemplateClass}>
            {week.rows.map((row) => {
              const baseInfo = employeeLookup.get(row.employeeId);
              return (
                <Fragment key={row.employeeId}>
                  <div className="flex items-center gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-600">
                      {initials(row.displayName || baseInfo?.displayName || row.username)}
                    </div>
                    <div>
                      <p className="font-medium text-slate-900">{row.displayName || baseInfo?.displayName}</p>
                      {showUsername ? (
                        <p className="text-xs text-slate-500">{baseInfo?.username ?? row.username}</p>
                      ) : null}
                    </div>
                  </div>
                  {row.cells.map((cell) => {
                    const segments = cell.segments.length ? cell.segments : null;
                    const holidayInfo = resolveHolidayInfo(row, cell.isoDate, cell.branchId ?? null);
                    const variant = segments ? null : resolveVariant(cell, holidayInfo);
                    const hasTimes = Boolean(cell.start && cell.end);
                    const pauseInfo =
                      !segments && hasTimes && cell.requiredPauseMinutes
                        ? `${cell.requiredPauseMinutes} Min Pause`
                        : '';
                    const subtitleText = variant?.subtitle ?? '';
                    const showHolidayBadge =
                      !segments &&
                      holidayInfo.isHoliday &&
                      variant?.title !== 'Feiertag' &&
                      !subtitleText.toLowerCase().includes('feiertag');
                    const holidayBadge = showHolidayBadge
                      ? `Feiertag${holidayInfo.name ? ` · ${holidayInfo.name}` : ''}`
                      : '';

                    return (
                      <button
                        key={`${row.employeeId}-${cell.isoDate}`}
                        type="button"
                        onClick={() => handleOpenEditor({ employee: row, cell })}
                        disabled={!isEditable}
                        className={`flex min-h-[88px] flex-col items-center justify-center gap-1 border-t border-l border-slate-200 px-2 py-3 text-center transition ${
                          isEditable ? 'hover:scale-[1.01] hover:shadow-sm' : 'cursor-default'
                        } ${
                          segments ? 'bg-white' : variant?.container ?? 'bg-white'
                        }${!segments && holidayInfo.isHoliday ? ' ring-1 ring-indigo-200' : ''}`}
                      >
                        {segments ? (
                          <div className="flex w-full flex-col gap-2">
                            {segments.map((segment) => {
                              const segmentHoliday = resolveHolidayInfo(row, cell.isoDate, segment.branchId ?? null);
                              const segmentVariant = resolveSegmentVariant(segment, segmentHoliday);
                              const segmentHasTimes = Boolean(segment.start && segment.end);
                              const segmentPause =
                                segmentHasTimes && segment.requiredPauseMinutes
                                  ? `${segment.requiredPauseMinutes} Min Pause`
                                  : '';
                              return (
                                <div
                                  key={`${row.employeeId}-${cell.isoDate}-${segment.segmentIndex}`}
                                  className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-center leading-tight ${segmentVariant.container}`}
                                >
                                  {segmentVariant.title ? (
                                    <span className="text-[13px] font-semibold whitespace-nowrap sm:text-sm">
                                      {segmentVariant.title}
                                    </span>
                                  ) : null}
                                  {segmentVariant.subtitle ? (
                                    <span className="text-[11px] font-semibold sm:text-xs">
                                      {segmentVariant.subtitle}
                                    </span>
                                  ) : null}
                                  {segmentPause ? (
                                    <span className="text-[10px] text-slate-500 sm:text-[11px]">
                                      {segmentPause}
                                    </span>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <>
                            <span className="text-[13px] font-semibold whitespace-nowrap sm:text-sm">
                              {hasTimes ? `${cell.start} – ${cell.end}` : variant?.title ?? ''}
                            </span>
                            <span className="text-[11px] font-semibold sm:text-xs">{subtitleText}</span>
                            {holidayBadge ? <span className="text-[11px] text-indigo-600">{holidayBadge}</span> : null}
                            {pauseInfo ? (
                              <span className="text-[10px] text-slate-500 sm:text-[11px]">{pauseInfo}</span>
                            ) : null}
                          </>
                        )}
                      </button>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
            <header className="mb-4 space-y-1">
              <p className="text-sm font-semibold text-slate-500">Schicht bearbeiten</p>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold text-slate-900">{editing.employee.displayName}</h2>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Vorlage
                  <select
                    value={selectedTemplateId}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSelectedTemplateId(value ? Number(value) : '');
                    }}
                    className="ml-2 rounded-full border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
                    disabled={isPending}
                  >
                    <option value="">Auswählen …</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedTemplate ? (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-600">
                    {selectedTemplate.name}
                  </span>
                ) : null}
              </div>
              <p className="text-sm text-slate-500">
                {findDayLabel(week, editing.cell.isoDate).primary}
              </p>
              {editingHolidayInfo ? (
                <p className="text-sm font-medium text-indigo-600">
                  Feiertag{editingHolidayInfo.name ? ` · ${editingHolidayInfo.name}` : ''}
                </p>
              ) : null}
            </header>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Start</span>
                <input
                  type="time"
                  value={startValue}
                  onChange={(event) => setStartValue(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500"
                  disabled={inputsDisabledByTemplate}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Ende</span>
                <input
                  type="time"
                  value={endValue}
                  onChange={(event) => setEndValue(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500"
                  disabled={inputsDisabledByTemplate}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="font-medium text-slate-700">Status / Hinweis</span>
                <input
                  type="text"
                  value={labelValue}
                  onChange={(event) => setLabelValue(event.target.value)}
                  placeholder="z. B. Urlaub, Krank, Schulung..."
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500"
                  disabled={inputsDisabledByTemplate}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="font-medium text-slate-700">Filiale</span>
                <select
                  value={branchValue}
                  onChange={(event) => setBranchValue(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500"
                  disabled={isPending || editing.employee.branches.length === 0}
                >
                  <option value="">Keine Zuordnung</option>
                  {editing.employee.branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-slate-500">
                  Es stehen nur Filialen zur Auswahl, denen der Mitarbeiter zugeordnet ist.
                </span>
              </label>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
              <span>Quick-Aktionen:</span>
              <button
                type="button"
                onClick={() => {
                  handleQuickStatus(QUICK_STATUS_PRESETS[0]);
                }}
                className="rounded-full border border-slate-200 px-3 py-1 text-slate-600 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isPending}
              >
                Verfügbar
              </button>
              {QUICK_STATUS_PRESETS.slice(1).map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handleQuickStatus(preset)}
                  className="rounded-full border border-slate-200 px-3 py-1 text-slate-600 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isPending}
                >
                  {preset.label}
                </button>
              ))}
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
                  onClick={handleClear}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isPending}
                >
                  Eintrag löschen
                </button>
                {!hasTemplateSelected ? (
                  <>
                    <button
                      type="button"
                      onClick={handleClearWeek}
                      className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isPending}
                    >
                      Woche leeren
                    </button>
                    <button
                      type="button"
                      onClick={handleFillWeek}
                      className="rounded-lg border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-600 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isPending}
                    >
                      Woche füllen
                    </button>
                  </>
                ) : null}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isPending}
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-sky-300"
                  disabled={isPending}
                >
                  Speichern
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <WeekPatternDrawer
        open={isPatternOpen}
        week={week}
        employees={employees}
        onClose={handleClosePattern}
        onSaved={handlePatternSaved}
        createAction={createPatternAction}
        templates={templates}
      />
    </section>
  );
}
