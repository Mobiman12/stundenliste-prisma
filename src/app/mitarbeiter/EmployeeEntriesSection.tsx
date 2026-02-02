'use client';

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';

import type { DailyDaySummary } from '@/lib/data/daily-days';
import type { ShiftPlanDay } from '@/lib/services/shift-plan';
import { parseTimeString, timeToDecimalHours } from '@/lib/services/time-calculations';
import { isHolidayIsoDate, normalizeHolidayRegion } from '@/lib/services/holidays';

import type { EntryActionState } from './types';

type Props = {
  entries: DailyDaySummary[];
  closedMonths: string[];
  requiresMealFlag: boolean;
  minPauseUnder6Minutes: number;
  shiftPlan: Record<string, ShiftPlanDay>;
  federalState?: string | null;
  createAction: (prevState: EntryActionState, formData: FormData) => Promise<EntryActionState>;
  createInitialState: EntryActionState;
  deleteAction: (prevState: EntryActionState, formData: FormData) => Promise<EntryActionState>;
  deleteInitialState: EntryActionState;
  hiddenFields?: Record<string, string>;
};

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

const CODE_OPTIONS = [
  { value: 'RA', label: 'Reguläre Arbeitszeit', description: 'Standard' },
  { value: 'Ü', label: 'Über-/Minusstundenkorrektur', description: 'Korrektur von Über- oder Minusstunden' },
  { value: 'K', label: 'Krank', description: 'bezahlt, volle Sollstunden' },
  { value: 'KK', label: 'Kind krank', description: 'bezahlt, volle Sollstunden' },
  { value: 'KKR', label: 'Kind krank Reststunden', description: 'Differenz zu Soll' },
  { value: 'KR', label: 'Krank Reststunden', description: 'Differenz zu Soll' },
  { value: 'KU', label: 'Kurzarbeit', description: 'reduzierte Arbeitszeit' },
  { value: 'U', label: 'Urlaub', description: 'voller Tag' },
  { value: 'UH', label: 'Urlaub 1/2 Tag', description: 'halber Tag' },
  { value: 'FT', label: 'Feiertag', description: '' },
  { value: 'UBF', label: 'Abwesend', description: '(Unbezahlte Freistellung)' },
];

const RANGE_ELIGIBLE_CODES = new Set(['U', 'UH', 'K', 'KK', 'KKR', 'KR', 'KU']);

const CODE_HELP_TEXT = CODE_OPTIONS.filter((option) => option.value)
  .map((option) => {
    const detail = option.description ? `${option.label} – ${option.description}` : option.label;
    return `${option.value}: ${detail}`;
  })
  .join('\n');

type WizardStepKey = 'status' | 'time' | 'revenue' | 'note' | 'summary';

const WIZARD_STEP_ORDER: WizardStepKey[] = [
  'status',
  'time',
  'revenue',
  'note',
  'summary',
];

const WIZARD_STEP_META: Record<
  WizardStepKey,
  { label: string; description: string; short: string }
> = {
  status: {
    label: 'Arbeitsstatus & Datum',
    short: 'Status',
    description: 'Arbeitsstatus wählen und Datum bzw. Zeitraum festlegen',
  },
  time: {
    label: 'Zeiten',
    short: 'Zeiten',
    description: 'Kommt-/Geht-Zeiten ergänzen',
  },
  revenue: {
    label: 'Umsatz',
    short: 'Umsatz',
    description: 'Optional Umsatz erfassen',
  },
  note: {
    label: 'Notiz',
    short: 'Notiz',
    description: 'Optional Bemerkung hinterlegen',
  },
  summary: {
    label: 'Zusammenfassung',
    short: 'Check',
    description: 'Eingaben prüfen und speichern',
  },
};

const DEFAULT_WIZARD_FLOW: WizardStepKey[] = ['status', 'time', 'revenue', 'note', 'summary'];

const FULL_DAY_CODES = new Set(['U', 'UBF', 'K', 'KK', 'KU']);
const OPTIONAL_TIME_CODES = new Set(['KU']);
const TIME_REQUIRED_CODES = new Set(['RA', 'Ü', 'KR', 'KKR']);
const MEAL_BLOCKED_CODES = new Set(['U', 'UH', 'UBF', 'K', 'KK', 'KR', 'KKR', 'KU']);
const PLAN_ABSENCE_KEYWORDS = [
  'urlaub',
  'krank',
  'krankheit',
  'nicht verfügbar',
  'nicht verfuegbar',
  'überstunden',
  'ueberstunden',
  'kurzarbeit',
  'abbau',
  'feiertag',
];

const derivePlanCode = (normalized: string): string => {
  if (normalized.includes('feiertag')) return 'FT';
  if (normalized.includes('urlaub')) return 'U';
  if (normalized.includes('krank')) return 'K';
  if (normalized.includes('kurzarbeit')) return 'KU';
  if (normalized.includes('überstunden') || normalized.includes('ueberstunden') || normalized.includes('abbau')) return 'Ü';
  return 'PLAN';
};

function normalizeCode(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase();
}

function getWizardFlow(code: string | null | undefined): WizardStepKey[] {
  const normalized = normalizeCode(code);
  if (!normalized) {
    return DEFAULT_WIZARD_FLOW;
  }
  if (FULL_DAY_CODES.has(normalized)) {
    return ['status', 'note', 'summary'];
  }
  if (OPTIONAL_TIME_CODES.has(normalized)) {
    return ['status', 'time', 'note', 'summary'];
  }
  return DEFAULT_WIZARD_FLOW;
}

function codeRequiresTimeInputs(code: string | null | undefined): boolean {
  const normalized = normalizeCode(code);
  return TIME_REQUIRED_CODES.has(normalized);
}

function formatMonthKey(monthKey: string): string {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    return monthKey;
  }
  const year = Number.parseInt(monthKey.slice(0, 4), 10);
  const month = Number.parseInt(monthKey.slice(5, 7), 10);
  const name = MONTH_NAMES[month - 1];
  return name ? `${name} ${year}` : `${monthKey.slice(5)}.${monthKey.slice(0, 4)}`;
}

function getTodayIsoDate(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function diffHours(start: string | null, end: string | null): number {
  const startTime = parseTimeString(start ?? undefined);
  const endTime = parseTimeString(end ?? undefined);
  if (!startTime || !endTime) {
    return 0;
  }
  let raw = timeToDecimalHours(endTime) - timeToDecimalHours(startTime);
  if (raw < 0) {
    raw += 24;
  }
  return Math.max(raw, 0);
}

const HOURS_EPSILON = 0.01;

function compareTimeValues(a: string | null | undefined, b: string | null | undefined): number {
  const parsedA = parseTimeString(a ?? undefined);
  const parsedB = parseTimeString(b ?? undefined);
  if (!parsedA || !parsedB) {
    return 0;
  }
  const minutesA = parsedA.hour * 60 + parsedA.minute;
  const minutesB = parsedB.hour * 60 + parsedB.minute;
  if (minutesA === minutesB) {
    return 0;
  }
  return minutesA > minutesB ? 1 : -1;
}

type ShiftPlanMap = Record<string, ShiftPlanDay>;

function computeDefaultValues(opts: {
  shiftPlan: ShiftPlanMap;
  isoDate: string;
  requiresMealFlag: boolean;
  minPauseUnder6Minutes: number;
}): {
  kommt1: string;
  geht1: string;
  pause: string;
  mittag: string;
  planPauseMinutes: number;
  planSpanHours: number;
  hasPlan: boolean;
  planStart: string;
  planEnd: string;
  planLabel: string | null;
} {
  const entry = opts.shiftPlan[opts.isoDate] ?? null;
  if (!entry) {
    const fallbackMittag = opts.requiresMealFlag ? 'Ja' : 'Nein';
    return {
      kommt1: '',
      geht1: '',
      pause: 'Keine',
      mittag: fallbackMittag,
      planPauseMinutes: 0,
      planSpanHours: 0,
      hasPlan: false,
      planStart: '',
      planEnd: '',
      planLabel: null,
    };
  }

  const kommt1 = entry.start ?? '';
  const geht1 = entry.end ?? '';
  const span = diffHours(entry.start, entry.end);

  let requiredPauseMinutes = Math.max(entry.requiredPauseMinutes ?? 0, 0);
  const legalPauseMinutes = span > 9 ? 45 : span > 6 ? 30 : 0;
  requiredPauseMinutes = Math.max(requiredPauseMinutes, legalPauseMinutes);

  if (legalPauseMinutes >= 30) {
    const mandatorySetting = Math.max(opts.minPauseUnder6Minutes ?? 0, 0);
    if (mandatorySetting > requiredPauseMinutes) {
      requiredPauseMinutes = mandatorySetting;
    }
  }

  const mittag = opts.requiresMealFlag ? 'Ja' : span > 6 ? 'Ja' : 'Nein';

  return {
    kommt1,
    geht1,
    pause: String(requiredPauseMinutes),
    mittag,
    planPauseMinutes: requiredPauseMinutes,
    planSpanHours: span,
    hasPlan: true,
    planStart: entry.start ?? '',
    planEnd: entry.end ?? '',
    planLabel: entry.label ?? null,
  };
}

function formatHours(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return Number(value).toFixed(2);
}

function buildCodeInfo(entry: DailyDaySummary): string {
  const info: string[] = [];
  const code = (entry.code ?? '').toUpperCase();
  if (code === 'RA' || !code) {
    info.push('Reguläre Arbeitszeit');
  }
  if (entry.sick_hours > 0) {
    info.push(`Krank=${entry.sick_hours.toFixed(2)}h`);
  }
  if (entry.child_sick_hours > 0) {
    info.push(`KK=${entry.child_sick_hours.toFixed(2)}h`);
  }
  if (entry.short_work_hours > 0) {
    info.push(`KuArb=${entry.short_work_hours.toFixed(2)}h`);
  }
  if (entry.vacation_hours > 0) {
    info.push(`Urlaub=${entry.vacation_hours.toFixed(2)}h`);
  }
  if ((entry.code ?? '').toUpperCase() === 'UBF') {
    info.push('unbezahltes Frei');
  }
  if (entry.holiday_hours > 0) {
    info.push(`FT=${entry.holiday_hours.toFixed(2)}h`);
  }
  const overtime = entry.overtime_delta ?? 0;
  if (overtime > 0.009) {
    info.push(`+Ü=${overtime.toFixed(2)}h`);
  } else if (overtime < -0.009) {
    info.push(`-Ü=${Math.abs(overtime).toFixed(2)}h`);
  }
  if (!info.length && entry.code) {
    info.push(entry.code.toUpperCase());
  }
  return info.length ? info.join(', ') : '—';
}

function buildAdminChangeInfo(entry: DailyDaySummary): string | null {
  if (!entry.admin_last_change_at || !entry.admin_last_change_by) {
    return null;
  }

  const timestamp = (() => {
    const parsed = new Date(entry.admin_last_change_at);
    if (Number.isNaN(parsed.getTime())) {
      return entry.admin_last_change_at;
    }
    return new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(parsed);
  })();

  const typeLabel = entry.admin_last_change_type === 'create' ? 'Erfasst' : 'Geändert';
  const summary = entry.admin_last_change_summary ?? '';
  return `${typeLabel} durch ${entry.admin_last_change_by} am ${timestamp}${summary ? ` – ${summary}` : ''}`;
}

function isRangeCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return RANGE_ELIGIBLE_CODES.has(code.trim().toUpperCase());
}

function parsePauseToMinutes(value: string | null | undefined): number {
  if (!value) return 0;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === 'keine') {
    return 0;
  }
  const match = trimmed.match(/^([0-9]+)(?:\s*min\.?)?$/i);
  if (match) {
    return Number.parseInt(match[1], 10);
  }
  return 0;
}

function isNoPauseValue(value: string | null | undefined): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return true;
  const collapsed = trimmed.replace(/\s+/g, '');
  return (
    collapsed === 'keine' ||
    collapsed === '0' ||
    collapsed === '0min' ||
    collapsed === '0min.' ||
    collapsed === 'keine.' ||
    collapsed === '0minute' ||
    collapsed === '0minuten'
  );
}

function calculateArbzgPauseMinutes(hours: number): number {
  if (hours > 9 + HOURS_EPSILON) {
    return 45;
  }
  if (hours > 6 + HOURS_EPSILON) {
    return 30;
  }
  return 0;
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

type CalendarCell = {
  isoDate: string;
  label: string;
  inCurrentMonth: boolean;
};

const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function buildCalendarCells(year: number, month: number): CalendarCell[] {
  const firstOfMonth = new Date(year, month - 1, 1);
  const startWeekday = (firstOfMonth.getDay() + 6) % 7; // Monday = 0
  const totalCells = 42;
  const cells: CalendarCell[] = [];
  for (let index = 0; index < totalCells; index += 1) {
    const offset = index - startWeekday;
    const cellDate = new Date(year, month - 1, 1 + offset);
    const isoDate = toIsoDate(cellDate);
    const inCurrentMonth = cellDate.getMonth() === month - 1;
    cells.push({
      isoDate,
      label: String(cellDate.getDate()),
      inCurrentMonth,
    });
  }
  return cells;
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
  const date = new Date(year, month - 1, 1);
  date.setMonth(date.getMonth() + delta);
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, '0');
  return `${nextYear}-${nextMonth}`;
}

function formatIsoForDisplay(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString('de-DE');
}

export default function EmployeeEntriesSection({
  entries,
  closedMonths,
  requiresMealFlag,
  minPauseUnder6Minutes,
  shiftPlan,
  federalState = null,
  createAction,
  createInitialState,
  deleteAction,
  deleteInitialState,
  hiddenFields = {},
}: Props) {
  const normalizedFederalState = useMemo(
    () => normalizeHolidayRegion(federalState),
    [federalState]
  );
  const closedMonthSet = useMemo(() => new Set(closedMonths), [closedMonths]);
  const employeeIdValue = useMemo(
    () => Number.parseInt(hiddenFields.employeeId ?? '0', 10),
    [hiddenFields]
  );
  const allEntries = useMemo(() => {
    if (!shiftPlan) {
      return entries;
    }
    const entryMap = new Map(entries.map((entry) => [entry.day_date, entry]));
    const synthetic: DailyDaySummary[] = [];
    let syntheticIndex = 0;
    for (const [isoDate, plan] of Object.entries(shiftPlan)) {
      if (!plan) continue;
      const rawLabel = plan.label?.trim();
      if (!rawLabel) continue;
      const normalized = rawLabel.toLowerCase();
      const planAbsence = PLAN_ABSENCE_KEYWORDS.some((keyword) => normalized.includes(keyword));
      const isHoliday = normalized.includes('feiertag') || normalized.includes('ft');
      if (!planAbsence && !isHoliday) continue;
      if (entryMap.has(isoDate)) continue;
      const parsedDate = new Date(`${isoDate}T00:00:00`);
      if (Number.isNaN(parsedDate.getTime())) {
        continue;
      }
      const spanHours = diffHours(plan.start ?? null, plan.end ?? null);
      const planRequiredPauseMinutes = Number(plan.requiredPauseMinutes ?? 0) || 0;
      const legalPauseMinutes = spanHours > 9 ? 45 : spanHours > 6 ? 30 : 0;
      let enforcedPauseMinutes = spanHours > 0 ? Math.max(planRequiredPauseMinutes, legalPauseMinutes) : 0;
      if (spanHours > 0 && legalPauseMinutes >= 30) {
        const mandatorySetting = Math.max(minPauseUnder6Minutes, 0);
        if (mandatorySetting > enforcedPauseMinutes) {
          enforcedPauseMinutes = mandatorySetting;
        }
      }
      const netPlanHours = spanHours > 0 ? Math.max(spanHours - enforcedPauseMinutes / 60, 0) : 0;
      synthetic.push({
        id: Number.MIN_SAFE_INTEGER + syntheticIndex,
        employee_id: employeeIdValue,
        day_date: isoDate,
        brutto: null,
        kommt1: plan.start ?? null,
        geht1: plan.end ?? null,
        kommt2: null,
        geht2: null,
        pause: 'Keine',
        code: derivePlanCode(normalized),
        bemerkungen: null,
        mittag: 'Nein',
        schicht: rawLabel,
        sick_hours: normalized.includes('krank') ? netPlanHours : 0,
        child_sick_hours: 0,
        short_work_hours: normalized.includes('kurzarbeit') ? netPlanHours : 0,
        vacation_hours: normalized.includes('urlaub') ? netPlanHours : 0,
        holiday_hours: isHoliday ? netPlanHours : 0,
        overtime_delta: 0,
        plan_hours: netPlanHours,
        forced_overflow: 0,
        forced_overflow_real: 0,
        required_pause_under6_minutes: 0,
        admin_last_change_at: null,
        admin_last_change_by: null,
        admin_last_change_type: null,
        admin_last_change_summary: 'Automatisch aus Schichtplan',
        ist_hours: 0,
      });
      syntheticIndex += 1;
    }
    if (!synthetic.length) {
      return entries;
    }
    const combined = [...entries, ...synthetic];
    combined.sort((a, b) => {
      if (a.day_date === b.day_date) {
        return b.id - a.id;
      }
      return a.day_date < b.day_date ? 1 : -1;
    });
    return combined;
  }, [entries, shiftPlan, employeeIdValue, minPauseUnder6Minutes]);

  const initialIsoDate = getTodayIsoDate();

  const currentMonthKey = initialIsoDate.slice(0, 7);

  const monthMeta = useMemo(() => {
    const monthKeySet = new Set<string>();
    const addMonthKey = (key: string | null | undefined) => {
      if (!key) return;
      if (!/^\d{4}-\d{2}$/.test(key)) return;
      monthKeySet.add(key);
    };

    for (const entry of allEntries) {
      addMonthKey(entry.day_date?.slice(0, 7));
    }
    addMonthKey(currentMonthKey);

    const yearMap = new Map<number, Set<number>>();
    const addToYearMap = (key: string) => {
      const year = Number.parseInt(key.slice(0, 4), 10);
      const month = Number.parseInt(key.slice(5, 7), 10);
      if (!Number.isFinite(year) || !Number.isFinite(month)) {
        return;
      }
      if (!yearMap.has(year)) {
        yearMap.set(year, new Set<number>());
      }
      yearMap.get(year)!.add(month);
    };

    monthKeySet.forEach((key) => addToYearMap(key));

    const yearOptions = Array.from(yearMap.keys()).sort((a, b) => b - a);
    const monthOptionsByYear = new Map<number, number[]>(
      Array.from(yearMap.entries()).map(([year, monthSet]) => [year, Array.from(monthSet).sort((a, b) => b - a)])
    );

    const todayIso = initialIsoDate;
    const entriesSet = new Set(allEntries.map((entry) => entry.day_date));

    const sortedMonthKeys = Array.from(monthKeySet).sort();
    const missingByMonth = new Map<string, string[]>();

    for (const key of sortedMonthKeys) {
      const year = Number.parseInt(key.slice(0, 4), 10);
      const month = Number.parseInt(key.slice(5, 7), 10);
      if (!Number.isFinite(year) || !Number.isFinite(month)) {
        continue;
      }
      const daysInMonth = new Date(year, month, 0).getDate();
      const missing: string[] = [];
      for (let day = 1; day <= daysInMonth; day += 1) {
        const isoDay = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (isoDay > todayIso) {
          continue;
        }
        const date = new Date(`${isoDay}T00:00:00`);
        if (Number.isNaN(date.getTime())) {
          continue;
        }
        const weekday = date.getDay();
        if (weekday === 0 || weekday === 6) {
          continue;
        }
        if (!entriesSet.has(isoDay)) {
          missing.push(isoDay);
        }
      }
      missingByMonth.set(key, missing);
    }

    const attentionMonthKey = sortedMonthKeys.find((key) => {
      if (key > currentMonthKey) return false;
      if (closedMonthSet.has(key)) return false;
      return (missingByMonth.get(key) ?? []).length > 0;
    });

    const defaultMonthKey = attentionMonthKey ?? currentMonthKey;
    const defaultYear = Number.parseInt(defaultMonthKey.slice(0, 4), 10) || null;
    const defaultMonth = Number.parseInt(defaultMonthKey.slice(5, 7), 10) || null;

    const defaultMissing = missingByMonth.get(defaultMonthKey) ?? [];
    let initialSuggestedDate = defaultMissing[0] ?? defaultMonthKey + '-01';
    if (initialSuggestedDate > initialIsoDate) {
      initialSuggestedDate = initialIsoDate;
    }

    return {
      yearOptions,
      monthOptionsByYear,
      defaultYear,
      defaultMonth,
      defaultMonthKey,
      missingByMonth,
      initialSuggestedDate,
    };
  }, [allEntries, closedMonthSet, currentMonthKey, initialIsoDate]);

  const {
    yearOptions,
    monthOptionsByYear,
    defaultYear,
    defaultMonth,
    missingByMonth,
    initialSuggestedDate,
  } = monthMeta;

  const initialDefaults = useMemo(
    () =>
      computeDefaultValues({
        shiftPlan,
        isoDate: initialSuggestedDate,
        requiresMealFlag,
        minPauseUnder6Minutes,
      }),
    [initialSuggestedDate, minPauseUnder6Minutes, requiresMealFlag, shiftPlan]
  );

  const [formValues, setFormValues] = useState(() => ({
    dayDate: initialSuggestedDate,
    kommt1: initialDefaults.kommt1,
    geht1: initialDefaults.geht1,
    kommt2: '',
    geht2: '',
    pause: initialDefaults.pause,
    mittag: initialDefaults.mittag,
    code: 'RA',
    brutto: '',
    bemerkungen: '',
    rangeEndDate: '',
  }));

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);

  const selectedMonthKey = formValues.dayDate ? formValues.dayDate.slice(0, 7) : '';
  const selectedMonthClosed = selectedMonthKey ? closedMonthSet.has(selectedMonthKey) : false;

  const [createState, createFormAction] = useActionState(createAction, createInitialState);
  const [deleteState, deleteFormAction] = useActionState(deleteAction, deleteInitialState);
  const createFormRef = useRef<HTMLFormElement | null>(null);
  const [pendingHolidaySubmit, setPendingHolidaySubmit] = useState<string | null>(null);

  const [codeHelpOpen, setCodeHelpOpen] = useState(false);
  const codeHelpId = useMemo(() => {
    const suffix = Number.isFinite(employeeIdValue) && employeeIdValue > 0 ? `employee-${employeeIdValue}` : 'entry';
    return `code-help-${suffix}`;
  }, [employeeIdValue]);
  const [tillhubRevenueLoading, setTillhubRevenueLoading] = useState(false);
  const [tillhubRevenueError, setTillhubRevenueError] = useState<string | null>(null);
  const tillhubUserId = hiddenFields.tillhubUserId?.trim();

  const [showRangePicker, setShowRangePicker] = useState(false);
  const [rangeDraft, setRangeDraft] = useState<{ start: string | null; end: string | null }>({
    start: null,
    end: null,
  });
  const mealOverrideRef = useRef(false);
  const pauseOverrideRef = useRef(false);
  const revenueOverrideRef = useRef(false);
  const mealWithoutPauseConfirmedRef = useRef(false);
  const normalizedPlanLabel = useMemo(() => {
    if (!formValues.dayDate) return '';
    const entry = shiftPlan[formValues.dayDate];
    if (!entry?.label) return '';
    return entry.label.trim().toLowerCase();
  }, [shiftPlan, formValues.dayDate]);

  const [planMeta, setPlanMeta] = useState({
    hasPlan: initialDefaults.hasPlan,
    spanHours: initialDefaults.planSpanHours,
    pauseMinutes: initialDefaults.planPauseMinutes,
    start: initialDefaults.planStart,
    end: initialDefaults.planEnd,
    label: initialDefaults.planLabel,
  });
  useEffect(() => {
    if (!formValues.dayDate) {
      setPlanMeta({
        hasPlan: false,
        spanHours: 0,
        pauseMinutes: 0,
        start: '',
        end: '',
        label: null,
      });
      return;
    }
    const defaults = computeDefaultValues({
      shiftPlan,
      isoDate: formValues.dayDate,
      requiresMealFlag,
      minPauseUnder6Minutes,
    });
    setPlanMeta({
      hasPlan: defaults.hasPlan,
      spanHours: defaults.planSpanHours,
      pauseMinutes: defaults.planPauseMinutes,
      start: defaults.planStart,
      end: defaults.planEnd,
      label: defaults.planLabel,
    });
  }, [formValues.dayDate, shiftPlan, requiresMealFlag, minPauseUnder6Minutes]);

  useEffect(() => {
    revenueOverrideRef.current = false;
    setTillhubRevenueError(null);
    setTillhubRevenueLoading(false);
    if (!formValues.dayDate || !tillhubUserId) {
      return;
    }

    setTillhubRevenueLoading(true);
    const controller = new AbortController();
    fetch(`/api/tillhub/staff/daily?date=${formValues.dayDate}&tillhubUserId=${encodeURIComponent(tillhubUserId)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body?.error || `Tillhub-Fehler (${response.status})`);
        }
        return response.json();
      })
      .then((payload: { success: boolean; gross?: number | null; error?: string }) => {
        if (!payload.success) {
          throw new Error(payload.error || 'Tillhub-Antwort fehlgeschlagen.');
        }
        const gross = payload.gross;
        if (gross !== null && gross !== undefined && !revenueOverrideRef.current) {
          setFormValues((prev) => ({ ...prev, brutto: String(gross) }));
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setTillhubRevenueError(error instanceof Error ? error.message : 'Tillhub-Antwort fehlgeschlagen.');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setTillhubRevenueLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [formValues.dayDate, tillhubUserId]);

  const normalizedCode = useMemo(() => (formValues.code ?? '').trim().toUpperCase(), [formValues.code]);
  const actualPrimaryHours = useMemo(
    () => diffHours(formValues.kommt1, formValues.geht1),
    [formValues.kommt1, formValues.geht1]
  );
  const secondaryHours = useMemo(
    () => diffHours(formValues.kommt2, formValues.geht2),
    [formValues.kommt2, formValues.geht2]
  );
  const totalRecordedHours = useMemo(
    () => actualPrimaryHours + secondaryHours,
    [actualPrimaryHours, secondaryHours]
  );
  const recordedHoursForPause = useMemo(
    () => (normalizedCode === 'Ü' ? actualPrimaryHours : totalRecordedHours),
    [normalizedCode, actualPrimaryHours, totalRecordedHours]
  );
  const overtimeMatchesPlan = useMemo(() => {
    if (normalizedCode !== 'Ü') return false;
    if (!planMeta.hasPlan) return false;
    const planStart = planMeta.start ?? '';
    const planEnd = planMeta.end ?? '';
    if (!planStart || !planEnd) return false;
    return (
      (formValues.kommt1 ?? '') === planStart &&
      (formValues.geht1 ?? '') === planEnd &&
      !formValues.kommt2 &&
      !formValues.geht2
    );
  }, [
    normalizedCode,
    planMeta.hasPlan,
    planMeta.start,
    planMeta.end,
    formValues.kommt1,
    formValues.geht1,
    formValues.kommt2,
    formValues.geht2,
  ]);
  const effectivePrimaryHours = useMemo(
    () => (overtimeMatchesPlan ? 0 : actualPrimaryHours),
    [overtimeMatchesPlan, actualPrimaryHours]
  );
  const mandatoryPauseUnder6 = useMemo(
    () => Math.max(minPauseUnder6Minutes ?? 0, 0),
    [minPauseUnder6Minutes]
  );
  const legalPauseMinutes = useMemo(() => {
    if (normalizedCode === 'Ü') {
      return calculateArbzgPauseMinutes(effectivePrimaryHours);
    }
    if (normalizedCode === 'UH') {
      return 0;
    }
    return calculateArbzgPauseMinutes(recordedHoursForPause);
  }, [normalizedCode, recordedHoursForPause, effectivePrimaryHours]);
  const overtimeFullDay = useMemo(
    () => normalizedCode === 'Ü' && effectivePrimaryHours <= HOURS_EPSILON,
    [normalizedCode, effectivePrimaryHours]
  );
  const mealBlocked = useMemo(
    () =>
      normalizedCode !== 'FT' && (MEAL_BLOCKED_CODES.has(normalizedCode) || overtimeFullDay),
    [normalizedCode, overtimeFullDay]
  );
  const baseStepFlow = useMemo(() => getWizardFlow(formValues.code), [formValues.code]);
  const stepFlow = useMemo(
    () => (overtimeFullDay ? baseStepFlow.filter((step) => step !== 'revenue') : baseStepFlow),
    [baseStepFlow, overtimeFullDay]
  );
  const stepFlowRef = useRef(stepFlow);
  useEffect(() => {
    if (!overtimeMatchesPlan) {
      return;
    }
    mealOverrideRef.current = false;
    pauseOverrideRef.current = false;
    revenueOverrideRef.current = false;
    setFormValues((prev) => {
      const prevCode = (prev.code ?? '').toUpperCase();
      if (prevCode !== 'Ü' && prevCode !== 'UH') {
        return prev;
      }
      let changed = false;
      let next = prev;
      const ensureNext = () => {
        if (!changed) {
          next = { ...prev };
          changed = true;
        }
      };
      if (!isNoPauseValue(prev.pause)) {
        ensureNext();
        next.pause = 'Keine';
      }
      if (requiresMealFlag && (prev.mittag ?? '') !== 'Nein') {
        ensureNext();
        next.mittag = 'Nein';
      }
      if (prev.brutto) {
        ensureNext();
        next.brutto = '';
      }
      return changed ? next : prev;
    });
  }, [overtimeMatchesPlan, requiresMealFlag, setFormValues]);

  const applyHolidayPreset = useCallback(
    (isoDate: string) => {
      setFormValues({
        dayDate: isoDate,
        code: 'FT',
        kommt1: '',
        geht1: '',
        kommt2: '',
        geht2: '',
        pause: 'Keine',
        mittag: 'Nein',
        brutto: '',
        bemerkungen: '',
        rangeEndDate: '',
      });
      setPlanMeta({
        hasPlan: false,
        spanHours: 0,
        pauseMinutes: 0,
        start: '',
        end: '',
        label: null,
      });
      setRangeDraft({ start: isoDate, end: null });
    },
    [setFormValues, setPlanMeta, setRangeDraft]
  );

  const applyVacationPreset = useCallback(
    (isoDate: string) => {
      setFormValues({
        dayDate: isoDate,
        code: 'U',
        kommt1: '',
        geht1: '',
        kommt2: '',
        geht2: '',
        pause: 'Keine',
        mittag: 'Nein',
        brutto: '',
        bemerkungen: '',
        rangeEndDate: '',
      });
      setPlanMeta({
        hasPlan: false,
        spanHours: 0,
        pauseMinutes: 0,
        start: '',
        end: '',
        label: null,
      });
      setRangeDraft({ start: isoDate, end: null });
    },
    [setFormValues, setPlanMeta, setRangeDraft]
  );

  const handledHolidayRef = useRef<string | null>(null);
  const handledPlanLabelRef = useRef<string | null>(null);
  const [holidayDialog, setHolidayDialog] = useState<{
    isoDate: string;
    label: string;
    description: string;
  } | null>(null);

  useEffect(() => {
    const isoDate = formValues.dayDate;
    if (!isoDate) {
      return;
    }

    const planLabel = normalizedPlanLabel;
    const planIndicatesVacation = planLabel.includes('urlaub');
    if (
      planIndicatesVacation &&
      formValues.code === 'RA' &&
      handledPlanLabelRef.current !== isoDate
    ) {
      handledPlanLabelRef.current = isoDate;
      applyVacationPreset(isoDate);
      setHolidayDialog(null);
    }

    const holidayInfo = isHolidayIsoDate(isoDate, normalizedFederalState ?? undefined);
    if (!holidayInfo.isHoliday) {
      handledHolidayRef.current = isoDate;
      return;
    }

    if (planIndicatesVacation) {
      handledHolidayRef.current = isoDate;
      return;
    }

    const planIndicatesHoliday =
      planLabel === 'feiertag' ||
      planLabel === 'ft' ||
      planLabel.includes('feiertag');

    if (planIndicatesHoliday && formValues.code === 'RA') {
      if (handledHolidayRef.current !== isoDate) {
        handledHolidayRef.current = isoDate;
        handledPlanLabelRef.current = isoDate;
        applyHolidayPreset(isoDate);
        setHolidayDialog(null);
      }
      return;
    }

    if (formValues.code === 'FT') {
      handledHolidayRef.current = isoDate;
      return;
    }

    if (handledHolidayRef.current === isoDate) {
      return;
    }

    const label = new Date(`${isoDate}T00:00:00`).toLocaleDateString('de-DE');
    const description = holidayInfo.name ? ` (${holidayInfo.name})` : '';
    handledHolidayRef.current = isoDate;
    setHolidayDialog({ isoDate, label, description });
  }, [
    applyHolidayPreset,
    applyVacationPreset,
    formValues.code,
    formValues.dayDate,
    normalizedFederalState,
    normalizedPlanLabel,
    setHolidayDialog,
  ]);

  useEffect(() => {
    if (!stepFlow.length) {
      if (currentStepIndex !== 0) {
        setCurrentStepIndex(0);
      }
      return;
    }
    if (currentStepIndex >= stepFlow.length) {
      setCurrentStepIndex(stepFlow.length - 1);
    }
  }, [stepFlow, currentStepIndex]);

  const currentStepKey: WizardStepKey = stepFlow[currentStepIndex] ?? 'status';

  useEffect(() => {
    setStepError(null);
  }, [currentStepKey]);

  useEffect(() => {
    if (currentStepKey !== 'status' && codeHelpOpen) {
      setCodeHelpOpen(false);
    }
  }, [currentStepKey, codeHelpOpen]);
  useEffect(() => {
    stepFlowRef.current = stepFlow;
  }, [stepFlow]);
  const [rangePickerMonth, setRangePickerMonth] = useState<string>(() => {
    const base = formValues.dayDate || getTodayIsoDate();
    return base.slice(0, 7);
  });

  const requiresRangeSelection = useMemo(() => isRangeCode(formValues.code), [formValues.code]);
  const requiresTimeEntry = useMemo(
    () => codeRequiresTimeInputs(formValues.code),
    [formValues.code]
  );
  const overtimeExtension = useMemo(() => {
    if (formValues.code !== 'RA') return false;
    if (!planMeta.hasPlan) return false;
    if (!formValues.kommt1 || !formValues.geht1) return false;
    if (formValues.kommt2 || formValues.geht2) return false;
    const planSpan = planMeta.spanHours ?? 0;
    if (planSpan <= 0) return false;
    const actualSpan = diffHours(formValues.kommt1, formValues.geht1);
    if (actualSpan <= planSpan + 0.01) return false;
    if (planMeta.start && compareTimeValues(formValues.kommt1, planMeta.start) > 0) {
      return false;
    }
    if (planMeta.end && compareTimeValues(formValues.geht1, planMeta.end) < 0) {
      return false;
    }
    return true;
  }, [
    formValues.code,
    formValues.kommt1,
    formValues.geht1,
    formValues.kommt2,
    formValues.geht2,
    planMeta.end,
    planMeta.hasPlan,
    planMeta.spanHours,
    planMeta.start,
  ]);
  const showSecondTimeBlock = useMemo(() => {
    if (normalizedCode === 'Ü') return false;
    if (normalizedCode === 'UH' || normalizedCode === 'KR' || normalizedCode === 'KKR' || normalizedCode === 'KU' || normalizedCode === 'FT') return false;
    if (normalizedCode !== 'RA') return true;
    if (!planMeta.hasPlan) return true;
    if (overtimeExtension) return false;
    if (formValues.kommt2 || formValues.geht2) return true;
    const planStart = planMeta.start;
    const planEnd = planMeta.end;
    if (planStart && formValues.kommt1 && formValues.kommt1 !== planStart) return true;
    if (planEnd && formValues.geht1 && formValues.geht1 !== planEnd) return true;
    return false;
  }, [
    normalizedCode,
    formValues.kommt1,
    formValues.geht1,
    formValues.kommt2,
    formValues.geht2,
    overtimeExtension,
    planMeta.hasPlan,
    planMeta.start,
    planMeta.end,
  ]);
  const planDeviation = useMemo(() => {
    if (formValues.code !== 'RA') return false;
    if (!planMeta.hasPlan) return false;
    const planStart = planMeta.start || '';
    const planEnd = planMeta.end || '';
    const actualStart = formValues.kommt1 || '';
    const actualEnd = formValues.geht1 || '';
    if (planStart && actualStart && actualStart !== planStart) return true;
    if (planEnd && actualEnd && actualEnd !== planEnd) return true;
    if (planStart && !actualStart) return true;
    if (planEnd && !actualEnd) return true;
    if (!planStart && actualStart) return true;
    if (!planEnd && actualEnd) return true;
    if (formValues.kommt2 || formValues.geht2) return true;
    return false;
  }, [
    formValues.code,
    formValues.kommt1,
    formValues.geht1,
    formValues.kommt2,
    formValues.geht2,
    planMeta.hasPlan,
    planMeta.start,
    planMeta.end,
  ]);
  const alternativeStatusOptions = useMemo(
    () => CODE_OPTIONS.filter((option) => option.value && option.value !== 'RA'),
    []
  );
  const [statusDialogCode, setStatusDialogCode] = useState<string>(() => alternativeStatusOptions[0]?.value ?? 'Ü');
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const autoAdvance = useCallback(() => {
    setCurrentStepIndex((prev) => {
      const flow = stepFlowRef.current;
      const next = prev + 1;
      if (next < flow.length) {
        return next;
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    if (formValues.code === 'RA' && planDeviation && !overtimeExtension) {
      setStatusDialogCode((prev) => {
        if (prev && alternativeStatusOptions.some((option) => option.value === prev)) {
          return prev;
        }
        return alternativeStatusOptions[0]?.value ?? 'Ü';
      });
      const hasDeviationActive =
        planMeta.hasPlan &&
        (formValues.kommt1 !== planMeta.start ||
          formValues.geht1 !== planMeta.end ||
          Boolean(formValues.kommt2) ||
          Boolean(formValues.geht2) ||
          formValues.pause !== String(planMeta.pauseMinutes));
      if (hasDeviationActive) {
        setStatusDialogOpen(true);
      } else {
        setStatusDialogOpen(false);
      }
    } else {
      setStatusDialogOpen(false);
    }
  }, [
    alternativeStatusOptions,
    formValues.code,
    formValues.geht1,
    formValues.geht2,
    formValues.kommt1,
    formValues.kommt2,
    formValues.pause,
    overtimeExtension,
    planDeviation,
    planMeta.end,
    planMeta.hasPlan,
    planMeta.pauseMinutes,
    planMeta.start,
  ]);

  useEffect(() => {
    if ((formValues.code ?? '').toUpperCase() !== 'Ü') {
      return;
    }
    const trimmedKommt2 = (formValues.kommt2 ?? '').trim();
    const trimmedGeht2 = (formValues.geht2 ?? '').trim();
    if (!trimmedKommt2 && !trimmedGeht2) {
      return;
    }
    setFormValues((prev) => {
      const prevCode = (prev.code ?? '').toUpperCase();
      if (prevCode !== 'Ü' && prevCode !== 'UH') {
        return prev;
      }
      const prevKommt2 = (prev.kommt2 ?? '').trim();
      const prevGeht2 = (prev.geht2 ?? '').trim();
      if (!prevKommt2 && !prevGeht2) {
        return prev;
      }
      return {
        ...prev,
        kommt2: '',
        geht2: '',
      };
    });
  }, [formValues.code, formValues.kommt2, formValues.geht2]);

  const scheduleAutoAdvance = useCallback(
    (originStep: WizardStepKey, delay = 150) => {
      if (currentStepKey !== originStep) {
        return;
      }
      window.setTimeout(() => {
        autoAdvance();
      }, delay);
    },
    [autoAdvance, currentStepKey]
  );

  const canGoBack = currentStepIndex > 0;
  const canGoNext = currentStepIndex < stepFlow.length - 1;

  const goToStep = (index: number) => {
    if (index < 0 || index >= stepFlow.length) return;
    setCurrentStepIndex(index);
  };

  const validateStep = (step: WizardStepKey): boolean => {
    if (step === 'status') {
      if (!formValues.dayDate) {
        setStepError('Bitte wähle ein Datum aus.');
        return false;
      }
      if (requiresRangeSelection && !formValues.rangeEndDate) {
        setStepError('Bitte bestätige den Zeitraum.');
        return false;
      }
    }
    if (step === 'time') {
      if (requiresTimeEntry && (!formValues.kommt1 || !formValues.geht1)) {
        setStepError('Bitte gib Start- und Endzeit an.');
        return false;
      }
      if ((normalizedCode === 'KR' || normalizedCode === 'KKR') && planMeta.hasPlan && planMeta.start && planMeta.end) {
        const matchesPlanTimes =
          (formValues.kommt1 ?? '') === planMeta.start &&
          (formValues.geht1 ?? '') === planMeta.end &&
          !formValues.kommt2 &&
          !formValues.geht2;
        if (matchesPlanTimes) {
          setStepError('KR/KRR mit unveränderten Planzeiten nicht zulässig. Bitte Code wie K oder Zeiten anpassen.');
          return false;
        }
      }
      const pauseMinutes = parsePauseToMinutes(formValues.pause);
      const pauseIsZero = isNoPauseValue(formValues.pause) || pauseMinutes === 0;
      const mittagIsYes = (formValues.mittag ?? '').toLowerCase() === 'ja';
      if (pauseIsZero && mittagIsYes && !mealWithoutPauseConfirmedRef.current) {
        const confirmed = window.confirm('Du hast „Verpflegung = Ja“ gewählt, aber keine Pause eingetragen. Hast du trotzdem Sachbezug erhalten?');
        if (!confirmed) {
          setStepError('Bitte prüfe Pause und Verpflegung.');
          return false;
        }
        mealWithoutPauseConfirmedRef.current = true;
        setFormValues((prev) => {
          const marker = 'Verpflegung ohne Pause bestätigt.';
          const existing = (prev.bemerkungen ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
          if (existing.includes(marker)) {
            return prev;
          }
          const nextNotes = [...existing, marker];
          return {
            ...prev,
            bemerkungen: nextNotes.join('\n'),
          };
        });
      }
      if (
        requiresMealFlag &&
        planMeta.hasPlan &&
        formValues.code === 'RA'
      ) {
        if (pauseMinutes === 0 && planMeta.pauseMinutes > 0) {
          setStepError('Der Schichtplan sieht eine Pflichtpause vor. Bitte prüfe deine Angaben.');
          return false;
        }
      }
      const totalRawHours = diffHours(formValues.kommt1, formValues.geht1) + diffHours(formValues.kommt2, formValues.geht2);
      const legalPauseMinutes = calculateArbzgPauseMinutes(totalRawHours);
      const treatAsOvertimeAbsence =
        normalizedCode === 'Ü' && (overtimeMatchesPlan || effectivePrimaryHours <= HOURS_EPSILON);
      if (!treatAsOvertimeAbsence && legalPauseMinutes >= 30) {
        const pauseMinutes = parsePauseToMinutes(formValues.pause);
        if (pauseMinutes + 0.9 < legalPauseMinutes) {
          setStepError(
            `Bei ${totalRawHours.toFixed(2).replace('.', ',')} h Arbeitszeit sind gemäß § 4 ArbZG mindestens ${legalPauseMinutes} Minuten Pause erforderlich.`
          );
          return false;
        }
      }
    }
    setStepError(null);
    return true;
  };

  const handleNextStep = () => {
    if (!canGoNext) return;
    if (!validateStep(currentStepKey)) {
      return;
    }
    setCurrentStepIndex((prev) => Math.min(prev + 1, stepFlow.length - 1));
  };

  const handlePrevStep = () => {
    if (!canGoBack) return;
    setCurrentStepIndex((prev) => Math.max(prev - 1, 0));
  };

  const [selectedYear, setSelectedYear] = useState<string>(() => {
    if (defaultYear) {
      return String(defaultYear);
    }
    return yearOptions.length ? String(yearOptions[0]) : '';
  });

  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    if (defaultYear && defaultMonth) {
      return String(defaultMonth).padStart(2, '0');
    }
    if (defaultYear && yearOptions.includes(defaultYear)) {
      const months = monthOptionsByYear.get(defaultYear) ?? [];
      if (months.length) {
        return String(months[0]).padStart(2, '0');
      }
    }
    if (yearOptions.length) {
      const months = monthOptionsByYear.get(yearOptions[0]) ?? [];
      if (months.length) {
        return String(months[0]).padStart(2, '0');
      }
    }
    return '';
  });

  useEffect(() => {
    if (!yearOptions.length) {
      if (selectedYear !== '') {
        setSelectedYear('');
      }
      return;
    }
    const numericSelected = Number.parseInt(selectedYear, 10);
    if (!selectedYear || !Number.isFinite(numericSelected) || !yearOptions.includes(numericSelected)) {
      const fallbackYear = defaultYear ?? yearOptions[0];
      if (fallbackYear !== undefined && String(fallbackYear) !== selectedYear) {
        setSelectedYear(String(fallbackYear));
      }
    }
  }, [defaultYear, selectedYear, yearOptions]);

  useEffect(() => {
    if (!selectedYear) {
      if (selectedMonth !== '') {
        setSelectedMonth('');
      }
      return;
    }
    const yearNumber = Number.parseInt(selectedYear, 10);
    const months = monthOptionsByYear.get(yearNumber) ?? [];
    if (!months.length) {
      if (selectedMonth !== '') {
        setSelectedMonth('');
      }
      return;
    }
    const currentMonthNumber = Number.parseInt(selectedMonth, 10);
    if (Number.isFinite(currentMonthNumber) && months.includes(currentMonthNumber)) {
      return;
    }
    const preferredMonth =
      yearNumber === defaultYear && defaultMonth && months.includes(defaultMonth)
        ? defaultMonth
        : months[0];
    const nextValue = preferredMonth ? String(preferredMonth).padStart(2, '0') : '';
    if (nextValue !== selectedMonth) {
      setSelectedMonth(nextValue);
    }
  }, [selectedYear, monthOptionsByYear, defaultYear, defaultMonth, selectedMonth]);

  const filteredEntries = useMemo(() => {
    if (!allEntries.length) {
      return [];
    }
    return allEntries
      .filter((entry) => {
        const year = entry.day_date.slice(0, 4);
        const month = entry.day_date.slice(5, 7);
        if (selectedYear && year !== selectedYear) {
          return false;
        }
        if (selectedMonth && month !== selectedMonth) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (a.day_date < b.day_date ? -1 : a.day_date > b.day_date ? 1 : 0));
  }, [allEntries, selectedYear, selectedMonth]);

  const monthOptionsForSelectedYear = useMemo(() => {
    if (!selectedYear) {
      return [];
    }
    return monthOptionsByYear.get(Number.parseInt(selectedYear, 10)) ?? [];
  }, [selectedYear, monthOptionsByYear]);

  const nonCountingCodes = useMemo(() => new Set(['U', 'UH', 'K', 'KK', 'KR', 'KKR', 'KU', 'FT', 'UBF']), []);

  const visibleEntries = filteredEntries;
  const displayEntries = visibleEntries;

  const hasAnyEntries = visibleEntries.length > 0;

  const missingWeekdaysLabel = useMemo(() => {
    if (!selectedYear || !selectedMonth) {
      return null;
    }
    const key = `${selectedYear}-${selectedMonth}`;
    const missing = missingByMonth.get(key) ?? [];
    if (!missing.length) {
      return 'Alle Werktage des Monats sind erfasst.';
    }
    const formatted = missing.map((iso) => {
      const date = new Date(`${iso}T00:00:00`);
      return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString('de-DE');
    });
    if (formatted.length > 8) {
      return `${formatted.length} Werktage noch offen (${formatted
        .slice(0, 6)
        .join(', ')} …)`;
    }
    return `Noch offen (Vergangenheit): ${formatted.join(', ')}`;
  }, [missingByMonth, selectedMonth, selectedYear]);

  const pickerMeta = useMemo(() => {
    const key = rangePickerMonth || getTodayIsoDate().slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(key)) {
      return {
        year: Number.parseInt(key.slice(0, 4), 10),
        month: Number.parseInt(key.slice(5, 7), 10),
      };
    }
    const today = getTodayIsoDate();
    return {
      year: Number.parseInt(today.slice(0, 4), 10),
      month: Number.parseInt(today.slice(5, 7), 10),
    };
  }, [rangePickerMonth]);

  const calendarCells = useMemo(
    () => buildCalendarCells(pickerMeta.year, pickerMeta.month),
    [pickerMeta]
  );

  const rangeSummary = useMemo(() => {
    if (!formValues.dayDate || !formValues.rangeEndDate) {
      return null;
    }
    const start = new Date(`${formValues.dayDate}T00:00:00`);
    const end = new Date(`${formValues.rangeEndDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return null;
    }
    const startLabel = start.toLocaleDateString('de-DE');
    const endLabel = end.toLocaleDateString('de-DE');
    const days = countDaysInclusive(formValues.dayDate, formValues.rangeEndDate);
    const dayLabel = days === 1 ? 'Tag' : 'Tage';
    return `${startLabel} – ${endLabel} (${days} ${dayLabel})`;
  }, [formValues.dayDate, formValues.rangeEndDate]);

  useEffect(() => {
    if (createState?.status === 'success') {
      setCurrentStepIndex(0);
      setFormValues(() => {
        const monthKey = selectedYear && selectedMonth ? `${selectedYear}-${selectedMonth}` : null;
        let nextIsoDate = initialSuggestedDate;
        if (monthKey && /^\d{4}-\d{2}$/.test(monthKey)) {
          const missing = missingByMonth.get(monthKey) ?? [];
          if (missing.length) {
            nextIsoDate = missing[0];
          } else if (monthKey === currentMonthKey) {
            nextIsoDate = initialIsoDate;
          } else {
            nextIsoDate = `${monthKey}-01`;
          }
        }

        const defaults = computeDefaultValues({
          shiftPlan,
          isoDate: nextIsoDate,
          requiresMealFlag,
          minPauseUnder6Minutes,
        });
        setPlanMeta({
          hasPlan: defaults.hasPlan,
          spanHours: defaults.planSpanHours,
          pauseMinutes: defaults.planPauseMinutes,
          start: defaults.planStart,
          end: defaults.planEnd,
          label: defaults.planLabel,
        });
        setRangeDraft({ start: null, end: null });
        setShowRangePicker(false);
        const currentMonthMissing = missingByMonth.get(monthKey ?? '') ?? [];
        return {
          dayDate: currentMonthMissing.length ? nextIsoDate : '',
          kommt1: defaults.kommt1,
          geht1: defaults.geht1,
          kommt2: '',
          geht2: '',
          pause: defaults.pause,
          mittag: defaults.mittag,
          code: 'RA',
          brutto: '',
          bemerkungen: '',
          rangeEndDate: '',
        };
      });
    }
  }, [
    createState,
    currentMonthKey,
    initialSuggestedDate,
    initialIsoDate,
    minPauseUnder6Minutes,
    missingByMonth,
    requiresMealFlag,
    selectedMonth,
    selectedYear,
    shiftPlan,
  ]);

  useEffect(() => {
    if (!requiresMealFlag) {
      setFormValues((prev) => ({
        ...prev,
        mittag: 'Nein',
      }));
    }
  }, [requiresMealFlag]);

  useEffect(() => {
    const base = formValues.dayDate || getTodayIsoDate();
    setRangePickerMonth((prev) => {
      const next = base.slice(0, 7);
      if (showRangePicker) {
        return prev;
      }
      return prev !== next ? next : prev;
    });
  }, [formValues.dayDate, showRangePicker]);

  const handleInputChange =
    (name: keyof typeof formValues) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      if (name === 'mittag') {
        mealOverrideRef.current = true;
        mealWithoutPauseConfirmedRef.current = false;
      } else if (name === 'pause') {
        pauseOverrideRef.current = true;
        mealWithoutPauseConfirmedRef.current = false;
      } else if (name === 'brutto') {
        revenueOverrideRef.current = true;
      }
      const value = name === 'code' ? event.target.value.toUpperCase() : event.target.value;
      setFormValues((prev) => ({
        ...prev,
        [name]: value,
      }));
    };

  const applyCodeChange = useCallback(
    (rawValue: string) => {
      const value = normalizeCode(rawValue);

      mealOverrideRef.current = false;
      pauseOverrideRef.current = false;
      revenueOverrideRef.current = false;
      mealWithoutPauseConfirmedRef.current = false;

      setFormValues((prev) => {
        let next = {
          ...prev,
          code: value,
          rangeEndDate: '',
        };

        if (value === 'U') {
          next = {
            ...next,
            kommt1: '',
            geht1: '',
            kommt2: '',
            geht2: '',
            pause: 'Keine',
            mittag: 'Nein',
          };
        } else if (value === 'KU') {
          next = {
            ...next,
            kommt1: '00:00',
            geht1: '00:00',
            kommt2: '',
            geht2: '',
            pause: '0',
            mittag: 'Nein',
          };
        } else if (value === 'RA') {
          next = {
            ...next,
            kommt1: '',
            geht1: '',
            kommt2: '',
            geht2: '',
            pause: 'Keine',
            mittag: requiresMealFlag ? 'Nein' : prev.mittag,
          };
        } else if (!planMeta.hasPlan) {
          next = {
            ...next,
            kommt1: '',
            geht1: '',
            kommt2: '',
            geht2: '',
            pause: 'Keine',
            mittag: requiresMealFlag ? 'Nein' : prev.mittag,
          };
        } else if ((value === 'RA') && planMeta.hasPlan && planMeta.start && planMeta.end) {
          next = {
            ...next,
            kommt1: planMeta.start,
            geht1: planMeta.end,
            kommt2: '',
            geht2: '',
            pause: planMeta.pauseMinutes > 0 ? String(planMeta.pauseMinutes) : 'Keine',
            mittag: requiresMealFlag ? (planMeta.spanHours > 6 ? 'Ja' : 'Nein') : prev.mittag,
          };
        } else if (value === 'UH' && planMeta.hasPlan && planMeta.start && planMeta.end) {
          next = {
            ...next,
            kommt1: planMeta.start,
            geht1: planMeta.end,
            kommt2: '',
            geht2: '',
            pause: '0',
            mittag: 'Nein',
          };
        } else if (value === 'UH') {
          next = {
            ...next,
            kommt1: '',
            geht1: '',
            kommt2: '',
            geht2: '',
            pause: '0',
            mittag: 'Nein',
          };
        } else if (value === 'KR' || value === 'KKR') {
          next = {
            ...next,
            kommt2: '',
            geht2: '',
          };
        } else if (value === 'Ü') {
          next = {
            ...next,
            kommt2: '',
            geht2: '',
          };
        } else if (MEAL_BLOCKED_CODES.has(value)) {
          next = {
            ...next,
            mittag: 'Nein',
          };
        }

        return next;
      });

      if (value === 'RA') {
        setRangeDraft({ start: null, end: null });
        setShowRangePicker(false);
      } else if (isRangeCode(value)) {
        const base = formValues.dayDate || getTodayIsoDate();
        setRangeDraft({
          start: formValues.dayDate || null,
          end: formValues.rangeEndDate || null,
        });
        setRangePickerMonth(base.slice(0, 7));
        setShowRangePicker(true);
      } else {
        setRangeDraft({ start: null, end: null });
        setShowRangePicker(false);
      }
    },
    [
      formValues.dayDate,
      formValues.rangeEndDate,
      planMeta.hasPlan,
      planMeta.start,
      planMeta.end,
      planMeta.spanHours,
      planMeta.pauseMinutes,
      requiresMealFlag,
    ]
  );

  useEffect(() => {
    if (normalizedCode !== 'Ü' && normalizedCode !== 'UH') {
      mealOverrideRef.current = false;
      pauseOverrideRef.current = false;
      revenueOverrideRef.current = false;
      mealWithoutPauseConfirmedRef.current = false;
      return;
    }

    const hours = effectivePrimaryHours;
    const mandatoryPauseActive = hours > HOURS_EPSILON && mandatoryPauseUnder6 > 0;
    const requiredPauseMinutes = Math.max(
      calculateArbzgPauseMinutes(hours),
      mandatoryPauseActive ? mandatoryPauseUnder6 : 0
    );

    setFormValues((prev) => {
      const prevCode = (prev.code ?? '').toUpperCase();
      if (prevCode !== 'Ü' && prevCode !== 'UH') {
        return prev;
      }
      const isHalfOvertime = prevCode === 'UH';

      let changed = false;
      let next = prev;
      const ensureNext = () => {
        if (!changed) {
          next = { ...prev };
          changed = true;
        }
      };

      if (!pauseOverrideRef.current) {
        const prevPauseMinutes = parsePauseToMinutes(prev.pause);
        if (requiredPauseMinutes === 0 || isHalfOvertime) {
          if (!isNoPauseValue(prev.pause) || isHalfOvertime) {
            ensureNext();
            next.pause = '0';
          }
        } else {
          const shouldUpdatePause =
            prevPauseMinutes + 0.5 < requiredPauseMinutes ||
            prevPauseMinutes > requiredPauseMinutes + 0.5 ||
            isHalfOvertime;
          if (shouldUpdatePause) {
            ensureNext();
            next.pause = String(requiredPauseMinutes);
          }
        }
      }

      if (!mealOverrideRef.current) {
        if (isHalfOvertime) {
          if ((prev.mittag ?? '') !== 'Nein') {
            ensureNext();
            next.mittag = 'Nein';
          }
        } else if (mandatoryPauseActive || hours > 6 + HOURS_EPSILON) {
          if ((prev.mittag ?? '') !== 'Ja') {
            ensureNext();
            next.mittag = 'Ja';
          }
        } else if ((prev.mittag ?? '') !== 'Nein') {
          ensureNext();
          next.mittag = 'Nein';
        }
      }

      if (!revenueOverrideRef.current && hours <= HOURS_EPSILON) {
        if (prev.brutto) {
          ensureNext();
          next.brutto = '';
        }
      }

      return changed ? next : prev;
    });
  }, [normalizedCode, effectivePrimaryHours, requiresMealFlag, mandatoryPauseUnder6, setFormValues]);

  useEffect(() => {
    if (normalizedCode === 'Ü') {
      return;
    }
    const hasRecordedHours = recordedHoursForPause > HOURS_EPSILON;
    const mandatoryActive = hasRecordedHours && mandatoryPauseUnder6 > 0;
    const basePauseMinutes = calculateArbzgPauseMinutes(recordedHoursForPause);
    const targetPauseMinutes = mandatoryActive ? Math.max(basePauseMinutes, mandatoryPauseUnder6) : basePauseMinutes;

    setFormValues((prev) => {
      if ((prev.code ?? '').toUpperCase() === 'Ü') {
        return prev;
      }

      let changed = false;
      let next = prev;
      const ensureNext = () => {
        if (!changed) {
          next = { ...prev };
          changed = true;
        }
      };

      if (!pauseOverrideRef.current) {
        const prevMinutes = parsePauseToMinutes(prev.pause);
        if (normalizedCode === 'UH') {
          if (!isNoPauseValue(prev.pause) || prev.pause !== '0') {
            ensureNext();
            next.pause = '0';
          }
        } else if (targetPauseMinutes === 0) {
          if (!isNoPauseValue(prev.pause)) {
            ensureNext();
            next.pause = 'Keine';
          }
        } else if (prevMinutes + 0.5 < targetPauseMinutes || prevMinutes > targetPauseMinutes + 0.5) {
          ensureNext();
          next.pause = String(targetPauseMinutes);
        }
      }

      if (!mealOverrideRef.current) {
        if (normalizedCode === 'UH') {
          if ((prev.mittag ?? '') !== 'Nein') {
            ensureNext();
            next.mittag = 'Nein';
          }
        } else if (mandatoryActive && (prev.mittag ?? '') !== 'Ja') {
          ensureNext();
          next.mittag = 'Ja';
        } else if (!mandatoryActive && targetPauseMinutes === 0 && (prev.mittag ?? '') !== 'Nein') {
          ensureNext();
          next.mittag = 'Nein';
        }
      }

      if (!changed) {
        return prev;
      }
      return next;
    });
  }, [normalizedCode, recordedHoursForPause, legalPauseMinutes, mandatoryPauseUnder6, setFormValues]);

  const overtimeMessages = useMemo(() => {
    if (normalizedCode !== 'Ü') {
      return [] as Array<{ tone: 'info' | 'tip' | 'warning'; text: string }>;
    }
    const hours = effectivePrimaryHours;
    const formattedHours = hours.toFixed(2).replace('.', ',');
    const messages: Array<{ tone: 'info' | 'tip' | 'warning'; text: string }> = [];
    const mealSuffix = requiresMealFlag ? ' sowie Verpflegung' : '';
    const mandatoryActive = mandatoryPauseUnder6 > 0 && hours > HOURS_EPSILON;

    if (hours <= HOURS_EPSILON) {
      messages.push({
        tone: 'tip',
        text: `Ganzer Tag Überstundenabbau – Pause${mealSuffix} wurden automatisch auf „Keine/Nein“ gesetzt, Umsatz ist leer.`,
      });
      return messages;
    }

    if (hours > 6 + HOURS_EPSILON) {
      const pauseMinutes = calculateArbzgPauseMinutes(hours);
      const mealPart = requiresMealFlag ? ' und die Verpflegung steht auf „Ja“' : '';
      messages.push({
        tone: 'warning',
        text: `Du hast aktuell ${formattedHours} h Arbeitszeit erfasst. Die Pause wurde auf mindestens ${pauseMinutes} Minuten gestellt${mealPart}. Bitte bestätige das und trage Umsatz nach, falls vorhanden.`,
      });
    } else if (mandatoryActive) {
      messages.push({
        tone: 'warning',
        text: `Für diesen Einsatz ist eine verpflichtende Pause von ${mandatoryPauseUnder6} Minuten hinterlegt. Pause und Verpflegung stehen daher auf „Ja“. Bitte bestätige das.`,
      });
    } else if (hours < 4 - HOURS_EPSILON) {
      const mealPart = requiresMealFlag ? '; die Verpflegung bleibt auf „Nein“' : '';
      messages.push({
        tone: 'tip',
        text: `Du hast nur ${formattedHours} h Arbeitszeit erfasst. Eine Pflichtpause ist nicht erforderlich, daher bleibt die Pause auf „Keine“${mealPart}.`,
      });
    } else {
      const mealPart = requiresMealFlag ? ' und ob Verpflegung nötig war' : '';
      messages.push({
        tone: 'info',
        text: `Du hast ${formattedHours} h Arbeitszeit erfasst. Prüfe bitte, ob du eine Pause${mealPart} eintragen möchtest und ergänze ggf. Umsatz.`,
      });
    }

    return messages;
  }, [normalizedCode, effectivePrimaryHours, requiresMealFlag, mandatoryPauseUnder6]);

  const overtimeToneClasses: Record<'tip' | 'info' | 'warning', string> = {
    tip: 'border-red-200 bg-red-50 text-red-700',
    info: 'border-red-200 bg-red-50 text-red-700',
    warning: 'border-red-300 bg-red-50 text-red-800',
  };

  const handleCodeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    applyCodeChange(event.target.value);
  };

  const handleDateChange = (value: string) => {
    if (!value) {
      const defaults = computeDefaultValues({
        shiftPlan,
        isoDate: getTodayIsoDate(),
        requiresMealFlag,
        minPauseUnder6Minutes,
      });
      setFormValues((prev) => ({
        ...prev,
        dayDate: '',
        kommt1: defaults.kommt1,
        geht1: defaults.geht1,
        kommt2: '',
        geht2: '',
        pause: defaults.pause,
        mittag: defaults.mittag,
        code: 'RA',
        rangeEndDate: '',
      }));
      setPlanMeta({
        hasPlan: defaults.hasPlan,
        spanHours: defaults.planSpanHours,
        pauseMinutes: defaults.planPauseMinutes,
        start: defaults.planStart,
        end: defaults.planEnd,
        label: defaults.planLabel,
      });
      setRangeDraft({ start: null, end: null });
      return;
    }

    const defaults = computeDefaultValues({
      shiftPlan,
      isoDate: value,
      requiresMealFlag,
      minPauseUnder6Minutes,
    });

    setFormValues((prev) => ({
      ...prev,
      dayDate: value,
      kommt1: defaults.kommt1,
      geht1: defaults.geht1,
      kommt2: '',
      geht2: '',
      pause: defaults.pause,
      mittag: defaults.mittag,
      code: prev.code,
      brutto: '',
      bemerkungen: '',
      rangeEndDate: '',
    }));
    setPlanMeta({
      hasPlan: defaults.hasPlan,
      spanHours: defaults.planSpanHours,
      pauseMinutes: defaults.planPauseMinutes,
      start: defaults.planStart,
      end: defaults.planEnd,
      label: defaults.planLabel,
    });
    setRangeDraft({ start: null, end: null });
  };

  const handleOpenRangePicker = () => {
    const base = formValues.dayDate || getTodayIsoDate();
    setRangeDraft({
      start: formValues.dayDate || null,
      end: formValues.rangeEndDate || null,
    });
    setRangePickerMonth(base.slice(0, 7));
    setShowRangePicker(true);
  };

  const handleRangeClear = () => {
    setFormValues((prev) => ({
      ...prev,
      rangeEndDate: '',
    }));
    setRangeDraft({ start: formValues.dayDate || null, end: null });
  };

  const handleRangeDayClick = (isoDate: string) => {
    if (!rangeDraft.start || (rangeDraft.start && rangeDraft.end)) {
      setRangeDraft({ start: isoDate, end: null });
      return;
    }
    let start = rangeDraft.start;
    let end = isoDate;
    if (compareIso(end, start) < 0) {
      [start, end] = [end, start];
    }
    setRangeDraft({ start, end });
  };

  const handleRangeApply = () => {
    if (!rangeDraft.start) {
      return;
    }
    const startIso = rangeDraft.start;
    const endIso = rangeDraft.end ? rangeDraft.end : rangeDraft.start;
    const sortedStart = compareIso(startIso, endIso) <= 0 ? startIso : endIso;
    const sortedEnd = compareIso(startIso, endIso) <= 0 ? endIso : startIso;
    setFormValues((prev) => ({
      ...prev,
      dayDate: sortedStart,
      rangeEndDate: sortedEnd,
    }));
    const changed =
      formValues.dayDate !== sortedStart || formValues.rangeEndDate !== sortedEnd;

  setRangeDraft({ start: sortedStart, end: sortedEnd });
  setShowRangePicker(false);
  if (changed) {
    scheduleAutoAdvance('status');
  }
  };

  const handleRangeCancel = () => {
    setShowRangePicker(false);
  };

  const handleRangePrevMonth = () => {
    setRangePickerMonth((prev) => shiftMonthKey(prev, -1));
  };

  const handleRangeNextMonth = () => {
    setRangePickerMonth((prev) => shiftMonthKey(prev, 1));
  };

  const handleHolidayWorked = useCallback(() => {
    setHolidayDialog(null);
  }, []);

  const handleHolidayNotWorked = useCallback(() => {
    const isoDate = holidayDialog?.isoDate ?? formValues.dayDate;
    if (!isoDate) {
      setHolidayDialog(null);
      return;
    }
    handledHolidayRef.current = isoDate;
    handledPlanLabelRef.current = isoDate;
    applyHolidayPreset(isoDate);
    setPendingHolidaySubmit(isoDate);
    setHolidayDialog(null);
  }, [applyHolidayPreset, formValues.dayDate, holidayDialog, setHolidayDialog]);

  useEffect(() => {
    if (!pendingHolidaySubmit) {
      return;
    }
    if (formValues.code !== 'FT' || formValues.dayDate !== pendingHolidaySubmit) {
      return;
    }
    setPendingHolidaySubmit(null);
    createFormRef.current?.requestSubmit();
  }, [formValues.code, formValues.dayDate, pendingHolidaySubmit]);

  const handleStatusDialogConfirm = () => {
    if (!statusDialogCode) {
      return;
    }
    applyCodeChange(statusDialogCode);
    setStatusDialogOpen(false);
    window.setTimeout(() => {
      scheduleAutoAdvance('status');
    }, 0);
  };

  const handleStatusDialogRevert = () => {
    applyPlanDefaults();
    setStatusDialogOpen(false);
  };

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (normalizedCode === 'FT' && formValues.dayDate) {
      const holidayInfo = isHolidayIsoDate(formValues.dayDate, normalizedFederalState ?? undefined);
      if (!holidayInfo.isHoliday) {
        const confirmed = window.confirm('Der ausgewählte Tag ist laut Kalender kein Feiertag. Soll er trotzdem als Feiertag (FT) erfasst werden?');
        if (!confirmed) {
          event.preventDefault();
          return;
        }
      }
    }
    const pauseMinutes = parsePauseToMinutes(formValues.pause);
    const mittagSet = (formValues.mittag ?? '').toLowerCase() === 'ja';
    const shouldConfirm =
      planMeta.hasPlan &&
      planMeta.pauseMinutes === 0 &&
      planMeta.spanHours > 0 &&
      planMeta.spanHours <= 6 &&
      ((pauseMinutes > 0) || mittagSet) &&
      (formValues.code === 'RA' || !formValues.code);

    if (shouldConfirm) {
      const formattedHours = planMeta.spanHours.toFixed(2).replace('.', ',');
      const messages: string[] = [];
      if (pauseMinutes > 0) {
        messages.push('eine Pause');
      }
      if (mittagSet) {
        messages.push('Verpflegung „Ja“');
      }
      const parts = messages.join(' und ');
      const message = `Du hast laut Plan ${formattedHours} Stunden gearbeitet und es gibt keine Pflichtpause. Bist du sicher, dass du ${parts} eingetragen hast?`;
      if (!window.confirm(message)) {
        event.preventDefault();
      }
    }
  };

  const applyPlanDefaults = () => {
    if (!formValues.dayDate) {
      return;
    }
    const defaults = computeDefaultValues({
      shiftPlan,
      isoDate: formValues.dayDate,
      requiresMealFlag,
      minPauseUnder6Minutes,
    });
    setFormValues((prev) => ({
      ...prev,
      kommt1: defaults.kommt1,
      geht1: defaults.geht1,
      kommt2: '',
      geht2: '',
      pause: defaults.pause,
      mittag: MEAL_BLOCKED_CODES.has((prev.code ?? '').toUpperCase()) ? 'Nein' : defaults.mittag,
    }));
    setPlanMeta({
      hasPlan: defaults.hasPlan,
      spanHours: defaults.planSpanHours,
      pauseMinutes: defaults.planPauseMinutes,
      start: defaults.planStart,
      end: defaults.planEnd,
      label: defaults.planLabel,
    });
  };

  const closedMonthLabels = useMemo(
    () => closedMonths.map((monthKey) => formatMonthKey(monthKey)),
    [closedMonths]
  );

  const effectiveRangeStart = rangeDraft.start && rangeDraft.end
    ? (compareIso(rangeDraft.start, rangeDraft.end) <= 0 ? rangeDraft.start : rangeDraft.end)
    : rangeDraft.start;
  const effectiveRangeEnd = rangeDraft.start && rangeDraft.end
    ? (compareIso(rangeDraft.start, rangeDraft.end) <= 0 ? rangeDraft.end : rangeDraft.start)
    : rangeDraft.start;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Neue Zeiterfassung</h3>
        <p className="text-sm text-slate-500">
          Erfasse hier deine Arbeitszeiten für den ausgewählten Tag.
        </p>
        {missingWeekdaysLabel ? (
          <p className="mt-2 text-xs text-slate-500">
            {missingWeekdaysLabel}
          </p>
        ) : null}

        {createState ? (
          <div
            className={`mt-3 rounded-md border px-3 py-2 text-sm ${
              createState.status === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-red-200 bg-red-50 text-red-600'
            }`}
          >
            {createState.message}
          </div>
        ) : null}

        {selectedMonthClosed ? (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
            Der Monat {formatMonthKey(selectedMonthKey)} ist abgeschlossen. Es können keine neuen Einträge gespeichert
            werden.
          </p>
        ) : null}

        <form ref={createFormRef} action={createFormAction} onSubmit={handleFormSubmit} className="mt-6 space-y-6">
          {Object.entries(hiddenFields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <input type="hidden" name="rangeEndDate" value={formValues.rangeEndDate} />
          {!requiresMealFlag ? <input type="hidden" name="mittag" value="Nein" /> : null}

          <div className="space-y-6">
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-700">
                  Schritt {currentStepIndex + 1} von {stepFlow.length}
                </p>
                <span className="text-xs text-slate-500">
                  {WIZARD_STEP_META[currentStepKey]?.description}
                </span>
              </div>
              <div className="mt-3 overflow-x-auto">
                <ol className="flex min-w-full gap-3" role="list">
                  {stepFlow.map((step, index) => {
                    const status =
                      index < currentStepIndex ? 'complete' : index === currentStepIndex ? 'active' : 'upcoming';
                    const meta = WIZARD_STEP_META[step];
                    const baseClasses =
                      'flex min-w-[150px] items-start gap-3 rounded-lg border px-3 py-2 text-left transition';
                    const variantClasses =
                      status === 'complete'
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : status === 'active'
                        ? 'border-emerald-500 bg-white text-emerald-600 shadow-sm'
                        : 'border-slate-200 bg-white text-slate-400';
                    const indicatorClasses =
                      status === 'complete'
                        ? 'border-emerald-400 bg-emerald-500 text-white'
                        : status === 'active'
                        ? 'border-emerald-500 text-emerald-600'
                        : 'border-slate-300 text-slate-400';
                    return (
                      <li key={step} className="min-w-[150px]">
                        <button
                          type="button"
                          disabled={index > currentStepIndex}
                          onClick={() => {
                            if (index <= currentStepIndex) {
                              goToStep(index);
                            }
                          }}
                          className={`${baseClasses} ${variantClasses} ${
                            index <= currentStepIndex
                              ? 'hover:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500'
                              : 'cursor-default'
                          }`}
                        >
                          <span
                            className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold ${indicatorClasses}`}
                          >
                            {index + 1}
                          </span>
                          <span className="flex flex-col">
                            <span className="text-xs uppercase tracking-wide text-slate-500">{meta.short}</span>
                            <span className="text-sm font-semibold">{meta.label}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>

            {stepError ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                {stepError}
              </div>
            ) : null}

            <div className="space-y-6">
              {WIZARD_STEP_ORDER.map((stepKey) => {
                const included = stepFlow.includes(stepKey);
                const active = included && currentStepKey === stepKey;
                const visibilityClass = included ? (active ? 'block' : 'hidden') : 'hidden';

                if (stepKey === 'status') {
                  return (
                    <section
                      key={stepKey}
                      aria-hidden={!active}
                      className={`${visibilityClass} space-y-4`}
                    >
                      <p className="text-sm text-slate-600">
                        Wähle deinen Arbeitsstatus und lege das Datum bzw. den Zeitraum fest, für den die Angabe gelten
                        soll.
                      </p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="relative flex flex-col gap-1 text-sm">
                          <span className="flex items-center gap-2 font-medium text-slate-700">
                            Arbeitsstatus
                            <button
                              type="button"
                              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-xs text-slate-600 hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                              onClick={() => setCodeHelpOpen((prev) => !prev)}
                              onMouseEnter={() => setCodeHelpOpen(true)}
                              onMouseLeave={() => setCodeHelpOpen(false)}
                              onBlur={() => setCodeHelpOpen(false)}
                              aria-haspopup="true"
                              aria-expanded={codeHelpOpen}
                              aria-controls={codeHelpId}
                            >
                              ℹ️
                            </button>
                          </span>
                          <select
                            name="code"
                            value={formValues.code}
                            onChange={handleCodeChange}
                            className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                          >
                            {CODE_OPTIONS.map((option, index) => (
                              <option key={`${option.value || 'none'}-${index}`} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          {codeHelpOpen ? (
                            <div
                              id={codeHelpId}
                              role="note"
                              className="absolute left-0 top-full z-20 mt-2 w-72 rounded-md border border-slate-300 bg-slate-900/95 px-3 py-2 text-xs text-white shadow-lg whitespace-pre-line"
                            >
                              {CODE_HELP_TEXT}
                            </div>
                          ) : null}
                        </div>
                        <label className="flex flex-col gap-1 text-sm">
                          <span className="font-medium text-slate-700">{requiresRangeSelection ? 'Startdatum' : 'Datum'}</span>
                          <input
                            name="dayDate"
                            type="date"
                            value={formValues.dayDate}
                            onChange={(event) => handleDateChange(event.target.value)}
                            className="rounded-md border border-slate-300 px-3 py-2"
                            required
                          />
                        </label>
                      </div>
                      {requiresRangeSelection ? (
                        <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm">
                          {rangeSummary ? (
                            <span className="text-emerald-700">Zeitraum: {rangeSummary}</span>
                          ) : (
                            <span className="text-amber-700">Bitte Zeitraum auswählen.</span>
                          )}
                          <p className="text-xs text-slate-500">
                            Nach Auswahl von Urlaub oder Krankheit kannst du über den Kalender mehrere Tage markieren, genauso wie in der regulären Tageserfassung.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={handleOpenRangePicker}
                              className="rounded-md border border-slate-300 px-3 py-2 font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            >
                              Kalender öffnen
                            </button>
                            {rangeSummary ? (
                              <button
                                type="button"
                                onClick={handleRangeClear}
                                className="rounded-md border border-red-200 px-3 py-2 font-medium text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400"
                              >
                                Zeitraum zurücksetzen
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </section>
                  );
                }

                if (stepKey === 'time') {
                  const isFullDay = normalizedCode === 'FT';
                  const isOvertimeCode = normalizedCode === 'Ü';
                  const showPauseControls = isFullDay || !(isOvertimeCode && overtimeMatchesPlan);
                  const showMealControl = isFullDay || requiresMealFlag;
                  const timeGridCols = showSecondTimeBlock
                    ? showMealControl
                      ? 'sm:grid-cols-3 lg:grid-cols-6'
                      : showPauseControls
                        ? 'sm:grid-cols-3 lg:grid-cols-5'
                        : 'sm:grid-cols-3 lg:grid-cols-4'
                    : showMealControl
                      ? 'sm:grid-cols-3 lg:grid-cols-4'
                      : showPauseControls
                        ? 'sm:grid-cols-3 lg:grid-cols-3'
                        : 'sm:grid-cols-2 lg:grid-cols-2';

                  return (
                    <section
                      key={stepKey}
                      aria-hidden={!active}
                      className={`${visibilityClass} space-y-4`}
                    >
                      <p className="text-sm text-slate-600">
                        Trage deine Kommt-/Geht-Zeiten ein. Du kannst einen zweiten Block nutzen, falls du zwischendurch
                        eine längere Pause hattest.
                      </p>
                      {normalizedCode === 'Ü' && overtimeMessages.length ? (
                        <div className="space-y-2">
                          {overtimeMessages.map((item, index) => (
                            <div
                              key={`overtime-hint-${index}`}
                              className={`rounded-md border px-3 py-2 text-sm ${overtimeToneClasses[item.tone]}`}
                            >
                              {item.text}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div className={`grid gap-4 grid-cols-1 ${timeGridCols}`}>
                        <label className="flex flex-col gap-1 text-sm">
                          <span>Kommt</span>
                          <input
                            name="kommt1"
                            type="time"
                            className="time-no-placeholder rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                            autoComplete="off"
                            value={formValues.kommt1}
                            onChange={handleInputChange('kommt1')}
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-sm">
                          <span>Geht</span>
                          <input
                            name="geht1"
                            type="time"
                            className="time-no-placeholder rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                            autoComplete="off"
                            value={formValues.geht1}
                            onChange={handleInputChange('geht1')}
                          />
                        </label>
                        {showSecondTimeBlock ? (
                          <>
                            <label className="flex flex-col gap-1 text-sm">
                              <span>Kommt 2</span>
                              <input
                                name="kommt2"
                                type="time"
                                className="time-no-placeholder rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                                autoComplete="off"
                                value={formValues.kommt2}
                                onChange={handleInputChange('kommt2')}
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-sm">
                              <span>Geht 2</span>
                              <input
                                name="geht2"
                                type="time"
                                className="time-no-placeholder rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                                autoComplete="off"
                                value={formValues.geht2}
                                onChange={handleInputChange('geht2')}
                              />
                            </label>
                          </>
                        ) : null}
                        {showPauseControls ? (
                          <label className="flex flex-col gap-1 text-sm">
                            <span className="text-red-600">Pause (Minuten oder „Keine“)</span>
                            <input
                              name="pause"
                              type="text"
                              className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-900 placeholder:text-red-300"
                              placeholder="z. B. 30"
                              value={formValues.pause}
                              onChange={handleInputChange('pause')}
                            />
                          </label>
                        ) : null}
                        {showMealControl ? (
                          <label className="flex flex-col gap-1 text-sm">
                            <span>Verpflegung</span>
                            <select
                              name="mittag"
                              value={formValues.mittag}
                              onChange={handleInputChange('mittag')}
                              className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                              disabled={mealBlocked}
                              aria-disabled={mealBlocked}
                            >
                              <option value="Ja">Ja</option>
                              <option value="Nein">Nein</option>
                            </select>
                            {mealBlocked ? (
                              <span className="text-xs text-slate-500">
                                Bei Urlaub oder Krankheit steht die Verpflegung nicht zur Verfügung.
                              </span>
                            ) : null}
                          </label>
                        ) : null}
                      </div>
                      {!showPauseControls ? (
                        <p className="text-xs text-slate-500">
                          Für einen vollständigen Überstundenabbau werden Pause und Verpflegung automatisch auf „Keine/Nein“ gesetzt.
                        </p>
                      ) : null}
                      {!showSecondTimeBlock ? (
                        <p className="text-xs text-slate-500">
                          Ein zweiter Block erscheint automatisch, sobald du die eingeplante Zeit anpasst.
                        </p>
                      ) : null}
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                        {planMeta.hasPlan ? (
                          <span>
                            Plan: {planMeta.spanHours.toFixed(2)} h · Pflichtpause{' '}
                            {planMeta.pauseMinutes > 0 ? `${planMeta.pauseMinutes} Min` : 'keine'}
                          </span>
                        ) : (
                          <span>Kein Schichtplan hinterlegt – Zeiten frei eintragen.</span>
                        )}
                        <button
                          type="button"
                          onClick={applyPlanDefaults}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                          Planwerte übernehmen
                        </button>
                      </div>
                      {!planMeta.hasPlan ? (
                        <p className="text-xs text-slate-500">
                          Bei Überstunden oder flexiblen Einsätzen gelten keine automatischen Pausenvorgaben.
                        </p>
                      ) : null}
                    </section>
                  );
                }

                if (stepKey === 'revenue') {
                  return (
                    <section
                      key={stepKey}
                      aria-hidden={!active}
                      className={`${visibilityClass} space-y-4`}
                    >
                      <p className="text-sm text-slate-600">
                        Trage hier optional deinen Brutto-Umsatz ein. Dezimalwerte sind mit Punkt oder Komma möglich.
                      </p>
                      <label className="flex flex-col gap-1 text-sm">
                        <span>Brutto (€)</span>
                        <input
                          name="brutto"
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          placeholder="z. B. 120.50"
                          className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                          value={formValues.brutto}
                          onChange={handleInputChange('brutto')}
                        />
                        {tillhubRevenueLoading ? (
                          <span className="text-xs text-slate-500">Tillhub-Umsatz wird geladen…</span>
                        ) : null}
                        {tillhubRevenueError ? (
                          <span className="text-xs text-rose-600">{tillhubRevenueError}</span>
                        ) : null}
                        {!tillhubRevenueLoading && !tillhubRevenueError && tillhubUserId ? (
                          <span className="text-xs text-slate-500">Wert aus Tillhub kann übernommen werden, falls verfügbar.</span>
                        ) : null}
                      </label>
                    </section>
                  );
                }

                if (stepKey === 'note') {
                  return (
                    <section
                      key={stepKey}
                      aria-hidden={!active}
                      className={`${visibilityClass} space-y-4`}
                    >
                      <p className="text-sm text-slate-600">
                        Hast du besondere Hinweise für die Buchhaltung oder dein Team? Dann kannst du sie hier notieren.
                      </p>
                      <label className="flex flex-col gap-1 text-sm text-red-600">
                        <span>Bemerkung</span>
                        <textarea
                          name="bemerkungen"
                          rows={3}
                          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-900 placeholder:text-red-300"
                          value={formValues.bemerkungen}
                          onChange={handleInputChange('bemerkungen')}
                        />
                      </label>
                    </section>
                  );
                }

                  if (stepKey === 'summary') {
                    type SummaryRow = { label: string; value: string; tone?: 'danger' };
                    const summaryRows: SummaryRow[] = [
                      {
                        label: requiresRangeSelection ? 'Zeitraum' : 'Datum',
                        value: requiresRangeSelection
                          ? rangeSummary ?? '—'
                          : formValues.dayDate
                          ? formatIsoForDisplay(formValues.dayDate)
                          : '—',
                      },
                      {
                        label: 'Arbeitsstatus',
                        value: formValues.code || '—',
                      },
                    ];
                  if (stepFlow.includes('time')) {
                    summaryRows.push({ label: 'Kommt', value: formValues.kommt1 || '—' });
                    summaryRows.push({ label: 'Geht', value: formValues.geht1 || '—' });
                    if (formValues.kommt2 || formValues.geht2) {
                      summaryRows.push({ label: 'Kommt 2', value: formValues.kommt2 || '—' });
                      summaryRows.push({ label: 'Geht 2', value: formValues.geht2 || '—' });
                    }
                    summaryRows.push({ label: 'Pause', value: formValues.pause || 'Keine' });
                    if (requiresMealFlag) {
                      summaryRows.push({
                        label: 'Verpflegung',
                        value: formValues.mittag || '—',
                      });
                    }
                  }
                  if (stepFlow.includes('revenue')) {
                    summaryRows.push({
                      label: 'Brutto (€)',
                      value: formValues.brutto || '—',
                    });
                  }
                  if (stepFlow.includes('note')) {
                    summaryRows.push({
                      label: 'Bemerkung',
                      value: formValues.bemerkungen ? formValues.bemerkungen : '—',
                      tone: formValues.bemerkungen ? 'danger' : undefined,
                    } satisfies SummaryRow);
                  }
                  if (planMeta.hasPlan) {
                    summaryRows.push({
                      label: 'Plan (h)',
                      value: planMeta.spanHours.toFixed(2),
                    });
                    summaryRows.push({
                      label: 'Plan-Pause',
                      value: planMeta.pauseMinutes > 0 ? `${planMeta.pauseMinutes} Min` : 'Keine',
                    });
                  }

                  return (
                    <section
                      key={stepKey}
                      aria-hidden={!active}
                      className={`${visibilityClass} space-y-4`}
                    >
                      <p className="text-sm text-slate-600">
                        Prüfe deine Angaben. Bei Bedarf kannst du über die Navigation oben einen Schritt zurückspringen.
                      </p>
                      {normalizedCode === 'Ü' && overtimeMessages.length ? (
                        <div className="space-y-2">
                          {overtimeMessages.map((item, index) => (
                            <div
                              key={`overtime-summary-${index}`}
                              className={`rounded-md border px-3 py-2 text-sm ${overtimeToneClasses[item.tone]}`}
                            >
                              {item.text}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                        <dl className="divide-y divide-slate-200">
                          {summaryRows.map((row) => (
                            <div key={row.label} className="grid grid-cols-1 gap-2 px-4 py-3 text-sm sm:grid-cols-3">
                              <dt className="font-medium text-slate-600 sm:col-span-1">{row.label}</dt>
                              <dd className={`sm:col-span-2 ${row.tone === 'danger' ? 'text-red-600' : 'text-slate-900'}`}>{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                      {selectedMonthClosed ? (
                        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                          Der Monat {formatMonthKey(selectedMonthKey)} ist bereits abgeschlossen. Speichern ist deaktiviert.
                        </p>
                      ) : null}
                    </section>
                  );
                }

                return null;
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={handlePrevStep}
                disabled={!canGoBack}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Zurück
              </button>
              <div className="ml-auto flex flex-wrap gap-3">
                {currentStepKey !== 'summary' ? (
                  <button
                    type="button"
                    onClick={handleNextStep}
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    Weiter
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
                    disabled={selectedMonthClosed}
                  >
                    Eintrag speichern
                  </button>
                )}
              </div>
            </div>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">Erfasste Tage</h3>
          <span className="text-xs text-slate-500">
            {hasAnyEntries && displayEntries.length !== visibleEntries.length
              ? `${displayEntries.length} von ${visibleEntries.length} Einträgen`
              : `${displayEntries.length} Einträge`}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-700">
          <label className="flex items-center gap-2">
            <span>Jahr</span>
            <select
              value={selectedYear}
              onChange={(event) => setSelectedYear(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1"
              disabled={!yearOptions.length}
            >
              {yearOptions.map((year) => (
                <option key={year} value={String(year)}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span>Monat</span>
            <select
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1"
              disabled={!monthOptionsForSelectedYear.length}
            >
              {monthOptionsForSelectedYear.map((month) => {
                const value = String(month).padStart(2, '0');
                return (
                  <option key={month} value={value}>
                    {formatMonthKey(`${selectedYear}-${value}`)}
                  </option>
                );
              })}
            </select>
          </label>
        </div>

        {deleteState ? (
          <div
            className={`mt-3 rounded-md border px-3 py-2 text-sm ${
              deleteState.status === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-red-200 bg-red-50 text-red-600'
            }`}
          >
            {deleteState.message}
          </div>
        ) : null}

        {closedMonths.length ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Folgende Monate sind abgeschlossen und können nicht mehr bearbeitet werden:{' '}
            <strong>{closedMonthLabels.join(', ')}</strong>
          </div>
        ) : null}

        {displayEntries.length ? (
          <div className="mt-3 space-y-1.5 text-xs">
            {displayEntries.map((entry) => {
              const monthKey = entry.day_date.slice(0, 7);
              const lockedMonth = closedMonthSet.has(monthKey);
              const isSynthetic = entry.id < 0;
              const disableDelete = lockedMonth || isSynthetic;
              const codeInfo = buildCodeInfo(entry);
              const adminInfo = buildAdminChangeInfo(entry);
              const kuLikeCodes = new Set(['KU', 'UBF', 'FT']);
              const planHoursRawOriginal = Number(entry.plan_hours ?? 0);
              const istHoursRawOriginal = Number(entry.ist_hours ?? 0);
              const planHoursRaw = kuLikeCodes.has((entry.code ?? '').toUpperCase()) ? 0 : planHoursRawOriginal;
              const istHoursRaw = kuLikeCodes.has((entry.code ?? '').toUpperCase()) ? 0 : istHoursRawOriginal;
              const planHours = formatHours(planHoursRaw);
              const istHours = formatHours(istHoursRaw);
              const brutto = entry.brutto !== null && entry.brutto !== undefined ? entry.brutto.toFixed(2) : '—';
              const codeUpper = (entry.code ?? '').toUpperCase();
              const zeroTimeCodes = new Set(['U', 'UBF', 'K', 'KK', 'KU', 'FT']);
              const hideTimes = zeroTimeCodes.has(codeUpper);
              const primaryTime = hideTimes
                ? '—'
                : entry.kommt1 && entry.geht1
                  ? `${entry.kommt1} – ${entry.geht1}`
                  : entry.kommt1 || entry.geht1 || '—';
              const secondaryTime = hideTimes
                ? null
                : entry.kommt2 && entry.geht2
                  ? `${entry.kommt2} – ${entry.geht2}`
                  : entry.kommt2 || entry.geht2 || null;
              const dateObj = new Date(`${entry.day_date}T00:00:00`);
              const weekdayShort = Number.isNaN(dateObj.getTime())
                ? ''
                : dateObj.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '');
              const isNonCountingDay =
                nonCountingCodes.has((entry.code ?? '').toUpperCase()) &&
                Math.abs(planHoursRaw) < 0.01 &&
                Math.abs(istHoursRaw) < 0.01;
              const strongTextClass = isNonCountingDay ? 'text-slate-500' : 'text-slate-900';
              const mutedTextClass = isNonCountingDay ? 'text-slate-400' : 'text-slate-500';
              const rowClassNames = isSynthetic
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : isNonCountingDay
                  ? 'border-slate-200 bg-slate-50 text-slate-500'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-200 hover:shadow';
              return (
                <article
                  key={entry.id}
                  className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1 shadow-sm transition ${rowClassNames}`}
                >
                  <div className={`flex items-center gap-2 ${strongTextClass}`}>
                    <span className="text-sm font-semibold">
                      {weekdayShort ? `${weekdayShort}, ` : ''}
                      {new Date(entry.day_date).toLocaleDateString('de-DE')}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] uppercase tracking-wide text-slate-600">
                      {entry.code ?? '—'}
                    </span>
                    {lockedMonth ? (
                      <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                        Monat abgeschlossen
                      </span>
                    ) : null}
                    {isSynthetic ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                        Schichtplan
                      </span>
                    ) : null}
                    {isNonCountingDay ? (
                      <span className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Zählt nicht
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-baseline gap-1 min-w-[120px]">
                      <span className={`text-[10px] uppercase tracking-wide ${mutedTextClass}`}>Zeit</span>
                      <span className={strongTextClass}>
                        {hideTimes ? '—' : primaryTime}
                        {secondaryTime ? (
                          <span className={`ml-1 text-xs ${mutedTextClass}`}>/ {secondaryTime}</span>
                        ) : null}
                      </span>
                    </span>
                    <span className="inline-flex items-baseline gap-1 min-w-[110px]">
                      <span className={`text-[10px] uppercase tracking-wide ${mutedTextClass}`}>Pause</span>
                      <span className={strongTextClass}>
                        {entry.pause ? `${entry.pause}` : 'Keine'}
                        {requiresMealFlag ? (
                          <span className={`ml-1 text-xs ${mutedTextClass}`}>Verpflegung: {entry.mittag ?? '—'}</span>
                        ) : null}
                      </span>
                    </span>
                    {entry.schicht ? (
                      <span className="inline-flex items-baseline gap-1 min-w-[100px]">
                        <span className={`text-[10px] uppercase tracking-wide ${mutedTextClass}`}>Schicht</span>
                        <span className={strongTextClass}>{entry.schicht}</span>
                      </span>
                    ) : null}
                    <span className="inline-flex items-baseline gap-1 min-w-[110px]">
                      <span className={`text-[10px] uppercase tracking-wide ${mutedTextClass}`}>Soll/Ist</span>
                      <span className={strongTextClass}>
                        {planHours} h / {istHours} h
                      </span>
                    </span>
                    <span className="inline-flex items-baseline gap-1 min-w-[90px]">
                      <span className={`text-[10px] uppercase tracking-wide ${mutedTextClass}`}>Brutto</span>
                      <span className={strongTextClass}>{brutto} €</span>
                    </span>
                    <span className="inline-flex flex-1 min-w-[160px] items-baseline gap-1">
                      <span className="text-[10px] uppercase tracking-wide text-red-500">Hinweis</span>
                      <span className="font-semibold text-red-600 leading-snug">
                        {codeInfo}
                        {adminInfo ? (
                          <span className={`mt-1 block text-xs font-medium ${mutedTextClass}`}>{adminInfo}</span>
                        ) : null}
                      </span>
                    </span>
                    {entry.bemerkungen ? (
                      <span className="inline-flex flex-1 min-w-[140px] items-baseline gap-1">
                        <span className="text-[10px] uppercase tracking-wide text-red-500">Notiz</span>
                        <span className="font-semibold text-red-600 leading-snug">{entry.bemerkungen}</span>
                      </span>
                    ) : null}
                  </div>

                  {!isSynthetic ? (
                    <form action={deleteFormAction} className="ml-auto">
                      {Object.entries(hiddenFields).map(([name, value]) => (
                        <input key={name} type="hidden" name={name} value={value} />
                      ))}
                      <input type="hidden" name="dayDate" value={entry.day_date} />
                      <button
                        type="submit"
                        className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                        disabled={disableDelete}
                      >
                        Eintrag löschen
                      </button>
                    </form>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                      {hasAnyEntries
                        ? 'Für die ausgewählte Kombination aus Jahr und Monat liegen keine Einträge vor.'
                        : 'Es sind noch keine Einträge erfasst. Sobald du Zeiten speicherst, erscheinen sie hier in der Übersicht.'}
          </p>
        )}
      </section>
      {statusDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <h4 className="text-lg font-semibold text-slate-900">Arbeitsstatus anpassen</h4>
            <p className="mt-2 text-sm text-slate-600">
              Deine erfassten Zeiten weichen von deinem hinterlegten Schichtplan ab. Wähle einen passenden Arbeitsstatus
              oder stelle die Planzeiten wieder her.
            </p>
            <div className="mt-4 space-y-2">
              {alternativeStatusOptions.length ? (
                alternativeStatusOptions.map((option) => (
                  <label
                    key={option.value}
                    className={`flex items-start gap-3 rounded-md border px-3 py-2 text-sm transition ${
                      statusDialogCode === option.value
                        ? 'border-emerald-400 bg-emerald-50'
                        : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/50'
                    }`}
                  >
                    <input
                      type="radio"
                      className="mt-1"
                      name="status-change"
                      value={option.value}
                      checked={statusDialogCode === option.value}
                      onChange={() => setStatusDialogCode(option.value)}
                    />
                    <span>
                      <span className="font-semibold text-slate-900">{option.label}</span>
                      <span className="block text-xs text-slate-500">{option.description}</span>
                    </span>
                  </label>
                ))
              ) : (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  Es sind aktuell keine alternativen Arbeitsstatus hinterlegt. Bitte stelle die Planzeiten wieder her.
                </p>
              )}
            </div>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={handleStatusDialogRevert}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                Planzeiten wiederherstellen
              </button>
              <button
                type="button"
                onClick={handleStatusDialogConfirm}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
                disabled={!statusDialogCode || !alternativeStatusOptions.some((option) => option.value === statusDialogCode)}
              >
                Status übernehmen
              </button>
            </div>
          </div>
        </div>
      ) : null}

    {holidayDialog ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
        <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
          <h4 className="text-lg font-semibold text-slate-900">Feiertag erkannt</h4>
          <p className="mt-2 text-sm text-slate-600">
            Der {holidayDialog.label}
            {holidayDialog.description} ist ein Feiertag. Warst du an diesem Tag arbeiten?
          </p>
          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={handleHolidayNotWorked}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              Nein, war frei
            </button>
            <button
              type="button"
              onClick={handleHolidayWorked}
              className="rounded-md border border-emerald-200 bg-white px-4 py-2 text-sm font-medium text-emerald-700 shadow hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              Ja, gearbeitet
            </button>
          </div>
        </div>
      </div>
    ) : null}

    {showRangePicker ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
        <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl">
          <div className="flex items-center justify-between">
            <div>
                <h4 className="text-lg font-semibold text-slate-900">Zeitraum auswählen</h4>
                <p className="text-sm text-slate-500">
                  Erster Klick setzt „Von“, der zweite Klick setzt „Bis“.
                </p>
              </div>
              <button
                type="button"
                onClick={handleRangeCancel}
                className="rounded-full border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                ✕
              </button>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                onClick={handleRangePrevMonth}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                Zurück
              </button>
              <div className="text-sm font-medium text-slate-900">
                {MONTH_NAMES[pickerMeta.month - 1]} {pickerMeta.year}
              </div>
              <button
                type="button"
                onClick={handleRangeNextMonth}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                Weiter
              </button>
            </div>
            <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500">
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} className="py-1">
                  {label}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calendarCells.map((cell) => {
                const isStart = effectiveRangeStart === cell.isoDate && effectiveRangeStart !== null;
                const isEnd = effectiveRangeEnd === cell.isoDate && effectiveRangeEnd !== null;
                const inRange =
                  effectiveRangeStart &&
                  effectiveRangeEnd &&
                  compareIso(cell.isoDate, effectiveRangeStart) >= 0 &&
                  compareIso(cell.isoDate, effectiveRangeEnd) <= 0;

                const baseClasses =
                  'relative flex h-10 items-center justify-center rounded-md border text-sm transition';
                const monthClass = cell.inCurrentMonth ? 'border-slate-300 text-slate-900' : 'border-slate-200 text-slate-400';
                const rangeClass = inRange ? 'bg-emerald-100 border-emerald-200' : '';
                const endpointClass =
                  isStart || isEnd
                    ? 'bg-emerald-600 text-white border-emerald-600 font-semibold'
                    : '';

                return (
                  <button
                    type="button"
                    key={cell.isoDate}
                    onClick={() => handleRangeDayClick(cell.isoDate)}
                    className={`${baseClasses} ${monthClass} ${rangeClass} ${endpointClass}`}
                  >
                    {cell.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              <div>Von: {effectiveRangeStart ? formatIsoForDisplay(effectiveRangeStart) : '—'}</div>
              <div>Bis: {effectiveRangeEnd ? formatIsoForDisplay(effectiveRangeEnd) : '—'}</div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleRangeCancel}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleRangeApply}
                disabled={!rangeDraft.start}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow disabled:cursor-not-allowed disabled:bg-emerald-300"
              >
                Zeitraum übernehmen
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
