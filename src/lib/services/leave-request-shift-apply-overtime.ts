import type { LeaveRequestRow } from '@/lib/data/leave-requests';
import type { LeaveRequestShiftPlanBackupInput } from '@/lib/data/leave-request-shift-plan-backups';
import {
  listShiftPlanDays,
  type ShiftPlanDayRecord,
} from '@/lib/data/shift-plan-days';
import {
  syncLeaveRequestSegmentsToControlPlane,
  type LeaveRequestControlPlaneShiftSegment,
  type LeaveRequestControlPlaneShiftSyncContext,
} from '@/lib/services/leave-request-control-plane-sync';
import {
  getLeaveRequestPlanHoursForDay,
  getLeaveRequestWeeklyFallbackPlanHoursForDay,
} from '@/lib/services/leave-request-plan-read';
import { saveLeaveRequestShiftPlanSegments } from '@/lib/services/leave-request-shift-sync';

type ShiftSegmentDraft = LeaveRequestControlPlaneShiftSegment;
type BackupRowsByDate = Map<string, LeaveRequestShiftPlanBackupInput[]>;

type ApplyOvertimeLeaveRequestToShiftPlanDateInput = {
  isoDate: string;
  label: string;
  normalizedStart: string;
  normalizedEnd: string;
  controlPlaneContext: LeaveRequestControlPlaneShiftSyncContext | null;
  backupRowsByDate: BackupRowsByDate;
};

type ParsedInterval = {
  startMinutes: number;
  endMinutes: number;
  branchId: number | null;
};

function timeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

function minutesToTime(value: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(value)));
  const hour = Math.floor(clamped / 60);
  const minute = clamped % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function segmentSignature(segment: ShiftSegmentDraft): string {
  return [
    segment.mode,
    segment.start ?? '',
    segment.end ?? '',
    (segment.label ?? '').trim().toLowerCase(),
    String(segment.branchId ?? ''),
    String(Math.max(0, Math.round(Number(segment.requiredPauseMinutes) || 0))),
  ].join('|');
}

function normalizeAndCompactSegments(segments: ShiftSegmentDraft[]): ShiftSegmentDraft[] {
  if (!segments.length) return [];
  const deduped: ShiftSegmentDraft[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    const signature = segmentSignature(segment);
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    deduped.push({
      mode: segment.mode === 'unavailable' ? 'unavailable' : 'available',
      start: segment.start ?? null,
      end: segment.end ?? null,
      requiredPauseMinutes: Math.max(0, Math.round(Number(segment.requiredPauseMinutes) || 0)),
      label: segment.label ?? null,
      branchId: segment.branchId ?? null,
    });
  }

  const sorted = deduped.sort((a, b) => {
    const aStart = timeToMinutes(a.start) ?? -1;
    const bStart = timeToMinutes(b.start) ?? -1;
    if (aStart !== bStart) return aStart - bStart;
    const aEnd = timeToMinutes(a.end) ?? -1;
    const bEnd = timeToMinutes(b.end) ?? -1;
    if (aEnd !== bEnd) return aEnd - bEnd;
    if (a.mode !== b.mode) return a.mode === 'available' ? -1 : 1;
    return 0;
  });

  const compacted: ShiftSegmentDraft[] = [];
  for (const segment of sorted) {
    const previous = compacted[compacted.length - 1];
    if (
      previous &&
      previous.mode === segment.mode &&
      (previous.label ?? null) === (segment.label ?? null) &&
      (previous.branchId ?? null) === (segment.branchId ?? null) &&
      (previous.requiredPauseMinutes ?? 0) === (segment.requiredPauseMinutes ?? 0) &&
      previous.end &&
      segment.start &&
      previous.end === segment.start
    ) {
      previous.end = segment.end ?? previous.end;
      continue;
    }
    compacted.push({ ...segment });
  }
  return compacted;
}

function mergeIntervals(intervals: ParsedInterval[]): ParsedInterval[] {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);
  const merged: ParsedInterval[] = [sorted[0]];
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = merged[merged.length - 1];
    if (current.startMinutes <= previous.endMinutes) {
      previous.endMinutes = Math.max(previous.endMinutes, current.endMinutes);
      if (previous.branchId == null) {
        previous.branchId = current.branchId ?? null;
      }
      continue;
    }
    merged.push(current);
  }
  return merged;
}

function normalizeSegmentIndices(segments: ShiftSegmentDraft[]): ShiftSegmentDraft[] {
  return segments.filter((segment) => segment.start || segment.end || segment.label || segment.requiredPauseMinutes > 0);
}

function buildOvertimeAdjustedSegments(
  existingSegments: ShiftPlanDayRecord[],
  overtimeStart: string,
  overtimeEnd: string,
  overtimeLabel: string,
  options?: {
    planStart?: string | null;
    planEnd?: string | null;
  },
): ShiftSegmentDraft[] {
  const overtimeStartMinutes = timeToMinutes(overtimeStart);
  const overtimeEndMinutes = timeToMinutes(overtimeEnd);
  if (
    overtimeStartMinutes === null ||
    overtimeEndMinutes === null ||
    overtimeEndMinutes <= overtimeStartMinutes
  ) {
    return [
      {
        mode: 'unavailable',
        start: overtimeStart,
        end: overtimeEnd,
        requiredPauseMinutes: 0,
        label: overtimeLabel,
        branchId: existingSegments[0]?.branch_id ?? null,
      },
    ];
  }

  const normalizedOvertimeStart = overtimeStart.trim();
  const normalizedOvertimeEnd = overtimeEnd.trim();
  const overtimeLabelNormalized = overtimeLabel.trim().toLowerCase();
  const planStartMinutes = timeToMinutes(options?.planStart ?? null);
  const planEndMinutes = timeToMinutes(options?.planEnd ?? null);
  const hasPlanBounds =
    planStartMinutes !== null &&
    planEndMinutes !== null &&
    planEndMinutes > planStartMinutes;
  const sorted = [...existingSegments]
    .sort((a, b) => (a.segment_index ?? 0) - (b.segment_index ?? 0))
    .filter((segment) => {
      if (segment.mode !== 'unavailable') return true;
      const label = (segment.label ?? '').trim().toLowerCase();
      if (label !== overtimeLabelNormalized) return true;
      const start = (segment.start_time ?? '').trim();
      const end = (segment.end_time ?? '').trim();
      return !(start === normalizedOvertimeStart && end === normalizedOvertimeEnd);
    });
  const result: ShiftSegmentDraft[] = [];
  const availableIntervals = mergeIntervals(
    sorted
      .filter((segment) => segment.mode !== 'unavailable')
      .map((segment) => {
        const startMinutes = timeToMinutes(segment.start_time);
        const endMinutes = timeToMinutes(segment.end_time);
        if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
          return null;
        }
        const clampedStart = hasPlanBounds ? Math.max(startMinutes, planStartMinutes) : startMinutes;
        const clampedEnd = hasPlanBounds ? Math.min(endMinutes, planEndMinutes) : endMinutes;
        if (clampedEnd <= clampedStart) {
          return null;
        }
        return {
          startMinutes: clampedStart,
          endMinutes: clampedEnd,
          branchId: segment.branch_id ?? null,
        } satisfies ParsedInterval;
      })
      .filter((segment): segment is ParsedInterval => segment !== null),
  );

  let overlappedAnyAvailableSegment = false;
  for (const interval of availableIntervals) {
    const overlapStart = Math.max(interval.startMinutes, overtimeStartMinutes);
    const overlapEnd = Math.min(interval.endMinutes, overtimeEndMinutes);
    if (overlapEnd <= overlapStart) {
      result.push({
        mode: 'available',
        start: minutesToTime(interval.startMinutes),
        end: minutesToTime(interval.endMinutes),
        requiredPauseMinutes: 0,
        label: null,
        branchId: interval.branchId ?? null,
      });
      continue;
    }
    overlappedAnyAvailableSegment = true;
    if (interval.startMinutes < overlapStart) {
      result.push({
        mode: 'available',
        start: minutesToTime(interval.startMinutes),
        end: minutesToTime(overlapStart),
        requiredPauseMinutes: 0,
        label: null,
        branchId: interval.branchId ?? null,
      });
    }
    result.push({
      mode: 'unavailable',
      start: minutesToTime(overlapStart),
      end: minutesToTime(overlapEnd),
      requiredPauseMinutes: 0,
      label: overtimeLabel,
      branchId: interval.branchId ?? null,
    });
    if (overlapEnd < interval.endMinutes) {
      result.push({
        mode: 'available',
        start: minutesToTime(overlapEnd),
        end: minutesToTime(interval.endMinutes),
        requiredPauseMinutes: 0,
        label: null,
        branchId: interval.branchId ?? null,
      });
    }
  }

  if (!overlappedAnyAvailableSegment) {
    const fallbackBranchId =
      sorted.find((segment) => segment.mode === 'available')?.branch_id ??
      sorted[0]?.branch_id ??
      null;
    result.push({
      mode: 'unavailable',
      start: overtimeStart,
      end: overtimeEnd,
      requiredPauseMinutes: 0,
      label: overtimeLabel,
      branchId: fallbackBranchId ?? null,
    });
  }

  return normalizeAndCompactSegments(normalizeSegmentIndices(result));
}

function hasUnavailableLabel(segments: ShiftPlanDayRecord[], needle: string): boolean {
  return segments.some(
    (segment) =>
      segment.mode === 'unavailable' &&
      (segment.label ?? '').trim().toLowerCase().includes(needle),
  );
}

function mapBackupRowsToExistingSegments(fallbackBackups: LeaveRequestShiftPlanBackupInput[]): ShiftPlanDayRecord[] {
  return fallbackBackups
    .map((segment) => ({
      id: 0,
      employee_id: segment.employeeId,
      day_date: segment.dayDate,
      segment_index: segment.segmentIndex,
      mode: segment.mode,
      start_time: segment.startTime ?? null,
      end_time: segment.endTime ?? null,
      required_pause_minutes: segment.requiredPauseMinutes ?? 0,
      label: segment.label ?? null,
      branch_id: segment.branchId ?? null,
      branch_name: null,
      created_at: '',
      updated_at: '',
    }))
    .filter((segment) => segment.mode !== 'unavailable' || segment.start_time || segment.end_time);
}

async function resolveExistingSegmentsForOvertime(
  row: LeaveRequestRow,
  isoDate: string,
  backupRowsByDate: BackupRowsByDate,
): Promise<ShiftPlanDayRecord[]> {
  let existingSegments = await listShiftPlanDays(row.employee_id, isoDate, isoDate);
  const hasAvailableSegment = existingSegments.some((segment) => segment.mode !== 'unavailable');
  const hasUrlaubBlocker = hasUnavailableLabel(existingSegments, 'urlaub');
  const hasOvertimeBlocker = hasUnavailableLabel(existingSegments, 'überstundenabbau');

  if (!hasAvailableSegment && hasUrlaubBlocker && !hasOvertimeBlocker) {
    const fallbackSegments = mapBackupRowsToExistingSegments(backupRowsByDate.get(isoDate) ?? []);
    if (fallbackSegments.some((segment) => segment.mode !== 'unavailable')) {
      existingSegments = fallbackSegments;
    }
  }

  if (!existingSegments.some((segment) => segment.mode !== 'unavailable')) {
    const fallbackPlanHours = await getLeaveRequestPlanHoursForDay(row.employee_id, isoDate);
    if (fallbackPlanHours?.start && fallbackPlanHours?.end) {
      existingSegments = [
        {
          id: 0,
          employee_id: row.employee_id,
          day_date: isoDate,
          segment_index: 0,
          mode: 'available',
          start_time: fallbackPlanHours.start,
          end_time: fallbackPlanHours.end,
          required_pause_minutes: Number(fallbackPlanHours.requiredPauseMinutes ?? 0),
          label: null,
          branch_id: existingSegments[0]?.branch_id ?? null,
          branch_name: null,
          created_at: '',
          updated_at: '',
        },
      ];
    }
  }

  return existingSegments;
}

export async function applyOvertimeLeaveRequestToShiftPlanDate(
  tenantId: string,
  row: LeaveRequestRow,
  input: ApplyOvertimeLeaveRequestToShiftPlanDateInput,
): Promise<void> {
  const existingSegments = await resolveExistingSegmentsForOvertime(row, input.isoDate, input.backupRowsByDate);
  const fallbackPlanHours = await getLeaveRequestWeeklyFallbackPlanHoursForDay(
    row.employee_id,
    input.isoDate,
  );
  const adjustedSegments = buildOvertimeAdjustedSegments(
    existingSegments,
    input.normalizedStart,
    input.normalizedEnd,
    input.label,
    {
      planStart: fallbackPlanHours?.start ?? null,
      planEnd: fallbackPlanHours?.end ?? null,
    },
  );

  await saveLeaveRequestShiftPlanSegments(tenantId, row.employee_id, {
    isoDate: input.isoDate,
    segments: adjustedSegments.map((segment, segmentIndex) => ({
      segmentIndex,
      mode: segment.mode,
      start: segment.start,
      end: segment.end,
      requiredPauseMinutes: segment.requiredPauseMinutes,
      label: segment.label,
      branchId: segment.branchId,
    })),
  });
  await syncLeaveRequestSegmentsToControlPlane(
    tenantId,
    input.controlPlaneContext,
    input.isoDate,
    adjustedSegments,
  );
}
