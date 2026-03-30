import { getShiftPlanDayRecord } from '@/lib/data/shift-plan-days';
import {
  getShiftPlanRowPg,
  SHIFT_PLAN_DAY_KEYS,
  type ShiftPlanRow,
} from '@/lib/data/shift-plans';
import { calculateLegalPauseHours, parseTimeString } from '@/lib/services/time-calculations';

export type PlanHoursInfo = {
  rawHours: number;
  sollHours: number;
  requiredPauseMinutes: number;
  start: string | null;
  end: string | null;
};

type ShiftPlanLikeDay = {
  start: string | null;
  end: string | null;
  requiredPauseMinutes: number;
  label: string | null;
};

type ShiftPlanLike = {
  days: Record<string, ShiftPlanLikeDay>;
  fallbackRow?: ShiftPlanRow | null;
};

const PLAN_LABEL_CODE_MAP: Array<{ keyword: string; code: string }> = [
  { keyword: 'feiertag', code: 'FT' },
  { keyword: 'urlaub', code: 'U' },
  { keyword: 'krank', code: 'K' },
  { keyword: 'kurzarbeit', code: 'KU' },
  { keyword: 'überstunden', code: 'Ü' },
  { keyword: 'ueberstunden', code: 'Ü' },
  { keyword: 'abbau', code: 'Ü' },
];

function sanitizeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    return trimmed.padStart(5, '0');
  }
  return trimmed;
}

export function deriveCodeFromPlanLabel(label: string | null | undefined): string | null {
  const normalized = (label ?? '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  for (const entry of PLAN_LABEL_CODE_MAP) {
    if (normalized.includes(entry.keyword)) {
      return entry.code;
    }
  }
  return null;
}

export function buildPlanHours(start: string | null, end: string | null, requiredPauseMinutes: number): PlanHoursInfo | null {
  const startTime = parseTimeString(start ?? undefined);
  const endTime = parseTimeString(end ?? undefined);

  if (!startTime || !endTime) {
    return {
      rawHours: 0,
      sollHours: 0,
      requiredPauseMinutes,
      start,
      end,
    };
  }

  const raw = Math.max(
    0,
    (endTime.hour + endTime.minute / 60) - (startTime.hour + startTime.minute / 60)
  );

  if (raw <= 0.01) {
    return {
      rawHours: 0,
      sollHours: 0,
      requiredPauseMinutes,
      start,
      end,
    };
  }

  const legalPause = calculateLegalPauseHours(raw);
  const requiredPauseHours = (requiredPauseMinutes ?? 0) / 60;
  const soll = Math.max(raw - Math.max(legalPause, requiredPauseHours), 0);

  return {
    rawHours: Number(raw.toFixed(2)),
    sollHours: Number(soll.toFixed(2)),
    requiredPauseMinutes,
    start,
    end,
  };
}

export function getWeeklyFallbackDayFromRow(
  row: ShiftPlanRow | null,
  isoDate: string,
  schicht: string | null | undefined
): ShiftPlanLikeDay | null {
  if (!row) return null;

  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;

  const weekDayIndex = (date.getDay() + 6) % 7;
  const dayKey = SHIFT_PLAN_DAY_KEYS[weekDayIndex];

  const getEntry = (prefix: 'w1' | 'w2'): ShiftPlanLikeDay => {
    const startKey = `${prefix}_${dayKey}_start` as keyof typeof row;
    const endKey = `${prefix}_${dayKey}_end` as keyof typeof row;
    const pauseKey = `${prefix}_${dayKey}_req_pause_min` as keyof typeof row;
    return {
      start: sanitizeTime(row?.[startKey] as string | null | undefined),
      end: sanitizeTime(row?.[endKey] as string | null | undefined),
      requiredPauseMinutes: Number(row?.[pauseKey] ?? 0) || 0,
      label: null,
    };
  };

  const twoWeek = (row.two_week_cycle ?? '').toLowerCase() === 'yes';
  if (!twoWeek) {
    return getEntry('w1');
  }
  const normalizedSchicht = (schicht ?? '').trim().toLowerCase();
  return normalizedSchicht === 'spät' ? getEntry('w2') : getEntry('w1');
}

function weeklyFallbackFromRow(
  row: ShiftPlanRow | null,
  isoDate: string,
  schicht: string | null | undefined
): PlanHoursInfo | null {
  const entry = getWeeklyFallbackDayFromRow(row, isoDate, schicht);
  if (!entry) {
    return null;
  }
  return buildPlanHours(entry.start, entry.end, entry.requiredPauseMinutes);
}

async function weeklyFallback(
  employeeId: number,
  isoDate: string,
  schicht: string | null | undefined
): Promise<PlanHoursInfo | null> {
  const row = await getShiftPlanRowPg(employeeId);
  return weeklyFallbackFromRow(row, isoDate, schicht);
}

export async function getPlanHoursForDay(
  employeeId: number,
  isoDate: string,
  schicht: string | null | undefined = null
): Promise<PlanHoursInfo | null> {
  const record = await getShiftPlanDayRecord(employeeId, isoDate);
  if (record) {
    const direct = buildPlanHours(
      sanitizeTime(record.start_time),
      sanitizeTime(record.end_time),
      record.required_pause_minutes ?? 0
    );
    if (direct && direct.rawHours > 0.001) {
      return direct;
    }

    const fallbackLabel = record.label?.trim() || schicht || null;
    if (deriveCodeFromPlanLabel(fallbackLabel)) {
      const fallback = await weeklyFallback(employeeId, isoDate, fallbackLabel);
      if (fallback && fallback.rawHours > 0.001) {
        return fallback;
      }
    }

    return direct;
  }
  return await weeklyFallback(employeeId, isoDate, schicht);
}

export async function getWeeklyFallbackPlanHoursForDay(
  employeeId: number,
  isoDate: string,
  schicht: string | null | undefined = null
): Promise<PlanHoursInfo | null> {
  return await weeklyFallback(employeeId, isoDate, schicht);
}

export function getPlanHoursForDayFromPlan(
  plan: ShiftPlanLike,
  isoDate: string,
  schicht: string | null | undefined = null
): PlanHoursInfo | null {
  const entry = plan.days[isoDate];
  if (entry) {
    const direct = buildPlanHours(entry.start, entry.end, entry.requiredPauseMinutes);
    if (direct && direct.rawHours > 0.001) {
      return direct;
    }

    const fallbackLabel = entry.label?.trim() || schicht || null;
    if (deriveCodeFromPlanLabel(fallbackLabel)) {
      const fallback = weeklyFallbackFromRow(plan.fallbackRow ?? null, isoDate, fallbackLabel);
      if (fallback && fallback.rawHours > 0.001) {
        return fallback;
      }
    }

    return direct;
  }
  const hasDailyEntries = Object.keys(plan.days).length > 0;
  if (!hasDailyEntries) {
    return weeklyFallbackFromRow(plan.fallbackRow ?? null, isoDate, schicht);
  }
  return null;
}
