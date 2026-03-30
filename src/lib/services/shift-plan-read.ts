import { listShiftPlanDays } from '@/lib/data/shift-plan-days';
import {
  getShiftPlanRowPg,
  type ShiftPlanRow,
} from '@/lib/data/shift-plans';

export type ShiftPlanDay = {
  start: string | null;
  end: string | null;
  requiredPauseMinutes: number;
  label: string | null;
  branchId?: number | null;
  branchName?: string | null;
};

export type ShiftPlan = {
  employeeId: number;
  days: Record<string, ShiftPlanDay>;
  fallbackRow?: ShiftPlanRow | null;
};

function sanitizeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    return trimmed.padStart(5, '0');
  }
  return trimmed;
}

export async function getShiftPlan(
  employeeId: number,
  options?: { from?: string; to?: string },
): Promise<ShiftPlan> {
  const [records, fallbackRow] = await Promise.all([
    listShiftPlanDays(employeeId, options?.from, options?.to),
    getShiftPlanRowPg(employeeId),
  ]);
  const days: Record<string, ShiftPlanDay> = {};

  const grouped = new Map<string, typeof records>();
  for (const record of records) {
    const bucket = grouped.get(record.day_date) ?? [];
    bucket.push(record);
    grouped.set(record.day_date, bucket);
  }

  for (const [dayDate, dayRecords] of grouped.entries()) {
    dayRecords.sort((a, b) => (a.segment_index ?? 0) - (b.segment_index ?? 0));
    const available = dayRecords.filter((record) => record.mode !== 'unavailable');
    const unavailable = dayRecords.filter((record) => record.mode === 'unavailable');

    if (available.length > 0) {
      const firstAvailable = available[0];
      const lastAvailable = available[available.length - 1];
      days[dayDate] = {
        start: sanitizeTime(firstAvailable.start_time),
        end: sanitizeTime(lastAvailable.end_time),
        requiredPauseMinutes: firstAvailable.required_pause_minutes ?? 0,
        label: null,
        branchId: firstAvailable.branch_id ?? null,
        branchName: firstAvailable.branch_name ?? null,
      };
      continue;
    }

    const firstUnavailable = unavailable[0];
    if (firstUnavailable) {
      days[dayDate] = {
        start: sanitizeTime(firstUnavailable.start_time),
        end: sanitizeTime(firstUnavailable.end_time),
        requiredPauseMinutes: firstUnavailable.required_pause_minutes ?? 0,
        label: firstUnavailable.label?.trim() || null,
        branchId: firstUnavailable.branch_id ?? null,
        branchName: firstUnavailable.branch_name ?? null,
      };
    }
  }

  return {
    employeeId,
    days,
    fallbackRow,
  };
}
