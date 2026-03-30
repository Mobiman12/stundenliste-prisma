import type { LeaveRequestRow } from '@/lib/data/leave-requests';
import type { LeaveRequestShiftPlanBackupInput } from '@/lib/data/leave-request-shift-plan-backups';
import { listShiftPlanDays } from '@/lib/data/shift-plan-days';
import { getLeaveRequestPlanHoursForDay } from '@/lib/services/leave-request-plan-read';

export type LeaveRequestShiftPlanBackupRowsByDate = Map<string, LeaveRequestShiftPlanBackupInput[]>;

async function buildBackupRowsForDates(
  latestRow: LeaveRequestRow,
  dates: string[],
): Promise<LeaveRequestShiftPlanBackupInput[]> {
  const backupRows: LeaveRequestShiftPlanBackupInput[] = [];
  for (const isoDate of dates) {
    const existingSegments = await listShiftPlanDays(latestRow.employee_id, isoDate, isoDate);
    if (existingSegments.length === 0) {
      const fallbackPlanHours = await getLeaveRequestPlanHoursForDay(latestRow.employee_id, isoDate);
      if (fallbackPlanHours && fallbackPlanHours.start && fallbackPlanHours.end) {
        backupRows.push({
          leaveRequestId: latestRow.id,
          employeeId: latestRow.employee_id,
          dayDate: isoDate,
          segmentIndex: 0,
          mode: 'available',
          startTime: fallbackPlanHours.start,
          endTime: fallbackPlanHours.end,
          requiredPauseMinutes: Number(fallbackPlanHours.requiredPauseMinutes ?? 0),
          label: null,
          branchId: null,
        });
      }
    }
    for (const segment of existingSegments) {
      backupRows.push({
        leaveRequestId: latestRow.id,
        employeeId: latestRow.employee_id,
        dayDate: isoDate,
        segmentIndex: segment.segment_index ?? 0,
        mode: segment.mode === 'unavailable' ? 'unavailable' : 'available',
        startTime: segment.start_time ?? null,
        endTime: segment.end_time ?? null,
        requiredPauseMinutes: Number(segment.required_pause_minutes ?? 0),
        label: segment.label ?? null,
        branchId: segment.branch_id ?? null,
      });
    }
  }
  return backupRows;
}

function groupBackupRowsByDate(
  backupRows: LeaveRequestShiftPlanBackupInput[],
): LeaveRequestShiftPlanBackupRowsByDate {
  const backupRowsByDate = new Map<string, LeaveRequestShiftPlanBackupInput[]>();
  for (const backup of backupRows) {
    const list = backupRowsByDate.get(backup.dayDate) ?? [];
    list.push(backup);
    backupRowsByDate.set(backup.dayDate, list);
  }
  return backupRowsByDate;
}

export async function prepareLeaveRequestShiftPlanBackups(
  latestRow: LeaveRequestRow,
  dates: string[],
): Promise<{
  backupRows: LeaveRequestShiftPlanBackupInput[];
  backupRowsByDate: LeaveRequestShiftPlanBackupRowsByDate;
}> {
  const backupRows = await buildBackupRowsForDates(latestRow, dates);
  return {
    backupRows,
    backupRowsByDate: groupBackupRowsByDate(backupRows),
  };
}
