import { revalidatePath } from 'next/cache';

import {
  markLeaveRequestShiftPlanApplied,
  type LeaveRequestRow,
} from '@/lib/data/leave-requests';
import {
  deleteLeaveRequestShiftPlanBackups,
  listLeaveRequestShiftPlanBackups,
} from '@/lib/data/leave-request-shift-plan-backups';
import {
  resolveLeaveRequestControlPlaneShiftSyncContext,
  syncLeaveRequestDayToControlPlane,
  syncLeaveRequestSegmentsToControlPlane,
  type LeaveRequestControlPlaneShiftSegment,
} from '@/lib/services/leave-request-control-plane-sync';
import {
  recomputeLeaveRequestEmployeeOvertime,
  saveLeaveRequestShiftPlanSegments,
} from '@/lib/services/leave-request-shift-sync';

type LeaveRequestShiftPlanBackupRow = Awaited<ReturnType<typeof listLeaveRequestShiftPlanBackups>>[number];

type LeaveRequestShiftPlanSegment = {
  segmentIndex: number;
  mode: 'available' | 'unavailable';
  start: string | null;
  end: string | null;
  requiredPauseMinutes: number;
  label: string | null;
  branchId: number | null;
};

function groupBackupsByDate(
  backups: LeaveRequestShiftPlanBackupRow[],
): Map<string, LeaveRequestShiftPlanBackupRow[]> {
  const backupsByDate = new Map<string, LeaveRequestShiftPlanBackupRow[]>();
  for (const backup of backups) {
    const grouped = backupsByDate.get(backup.day_date) ?? [];
    grouped.push(backup);
    backupsByDate.set(backup.day_date, grouped);
  }
  return backupsByDate;
}

function mapBackupToShiftPlanSegment(segment: LeaveRequestShiftPlanBackupRow): LeaveRequestShiftPlanSegment {
  return {
    segmentIndex: segment.segment_index ?? 0,
    mode: segment.mode === 'unavailable' ? 'unavailable' : 'available',
    start: segment.start_time ?? null,
    end: segment.end_time ?? null,
    requiredPauseMinutes: Number(segment.required_pause_minutes ?? 0),
    label: segment.label ?? null,
    branchId: segment.branch_id ?? null,
  };
}

function mapBackupToControlPlaneSegment(segment: LeaveRequestShiftPlanBackupRow): LeaveRequestControlPlaneShiftSegment {
  return {
    mode: segment.mode === 'unavailable' ? 'unavailable' : 'available',
    start: segment.start_time ?? null,
    end: segment.end_time ?? null,
    requiredPauseMinutes: Number(segment.required_pause_minutes ?? 0),
    label: segment.label ?? null,
    branchId: segment.branch_id ?? null,
  };
}

export async function removeApprovedRequestFromShiftPlanWorkflow(
  tenantId: string,
  row: LeaveRequestRow,
  dates: string[],
): Promise<void> {
  const controlPlaneContext = await resolveLeaveRequestControlPlaneShiftSyncContext(tenantId, row.employee_id);
  const backupsByDate = groupBackupsByDate(await listLeaveRequestShiftPlanBackups(tenantId, row.id));

  for (const isoDate of dates) {
    const dayBackups = backupsByDate.get(isoDate) ?? [];
    if (dayBackups.length > 0) {
      await saveLeaveRequestShiftPlanSegments(tenantId, row.employee_id, {
        isoDate,
        segments: dayBackups.map(mapBackupToShiftPlanSegment),
      });
      await syncLeaveRequestSegmentsToControlPlane(
        tenantId,
        controlPlaneContext,
        isoDate,
        dayBackups.map(mapBackupToControlPlaneSegment),
      );
      continue;
    }

    await saveLeaveRequestShiftPlanSegments(tenantId, row.employee_id, {
      isoDate,
      segments: [],
    });
    await syncLeaveRequestDayToControlPlane(tenantId, controlPlaneContext, {
      isoDate,
      start: null,
      end: null,
      label: null,
      mode: 'available',
    });
  }

  await deleteLeaveRequestShiftPlanBackups(tenantId, row.id);
  await markLeaveRequestShiftPlanApplied(tenantId, row.id, false);
  await recomputeLeaveRequestEmployeeOvertime(tenantId, row.employee_id);
  revalidatePath('/mitarbeiter/schichtplan');
}
