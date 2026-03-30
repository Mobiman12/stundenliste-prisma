import { revalidatePath } from 'next/cache';

import {
  markLeaveRequestShiftPlanApplied,
  type LeaveRequestRow,
} from '@/lib/data/leave-requests';
import { replaceLeaveRequestShiftPlanBackups } from '@/lib/data/leave-request-shift-plan-backups';
import { resolveLeaveRequestControlPlaneShiftSyncContext } from '@/lib/services/leave-request-control-plane-sync';
import { prepareLeaveRequestShiftPlanBackups } from '@/lib/services/leave-request-shift-apply-backups';
import { applySimpleLeaveRequestToShiftPlanDate } from '@/lib/services/leave-request-shift-apply-day';
import { applyOvertimeLeaveRequestToShiftPlanDate } from '@/lib/services/leave-request-shift-apply-overtime';
import { recomputeLeaveRequestEmployeeOvertime } from '@/lib/services/leave-request-shift-sync';

function sanitizeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    return trimmed.padStart(5, '0');
  }
  return trimmed;
}

function getLeaveLabel(row: LeaveRequestRow): string {
  if (row.type !== 'vacation') {
    return 'Überstundenabbau';
  }
  return row.is_unpaid === 1 ? 'Urlaub (unbezahlt)' : 'Urlaub';
}

export async function applyApprovedRequestToShiftPlanWorkflow(
  tenantId: string,
  latestRow: LeaveRequestRow,
  dates: string[],
): Promise<void> {
  const label = getLeaveLabel(latestRow);
  const normalizedStart = sanitizeTime(latestRow.start_time);
  const normalizedEnd = sanitizeTime(latestRow.end_time);
  const controlPlaneContext = await resolveLeaveRequestControlPlaneShiftSyncContext(tenantId, latestRow.employee_id);
  const { backupRows, backupRowsByDate } = await prepareLeaveRequestShiftPlanBackups(latestRow, dates);
  await replaceLeaveRequestShiftPlanBackups(tenantId, latestRow.id, backupRows);

  for (const isoDate of dates) {
    if (latestRow.type === 'overtime' && normalizedStart && normalizedEnd) {
      await applyOvertimeLeaveRequestToShiftPlanDate(tenantId, latestRow, {
        isoDate,
        label,
        normalizedStart,
        normalizedEnd,
        controlPlaneContext,
        backupRowsByDate,
      });
      continue;
    }

    await applySimpleLeaveRequestToShiftPlanDate(tenantId, latestRow, {
      isoDate,
      label,
      normalizedStart,
      normalizedEnd,
      controlPlaneContext,
    });
  }

  await markLeaveRequestShiftPlanApplied(tenantId, latestRow.id, true);
  await recomputeLeaveRequestEmployeeOvertime(tenantId, latestRow.employee_id);
  revalidatePath('/mitarbeiter/schichtplan');
}
