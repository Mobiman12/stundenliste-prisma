import type { LeaveRequestRow } from '@/lib/data/leave-requests';
import {
  syncLeaveRequestDayToControlPlane,
  type LeaveRequestControlPlaneShiftSyncContext,
} from '@/lib/services/leave-request-control-plane-sync';
import { saveLeaveRequestShiftPlanDay } from '@/lib/services/leave-request-shift-sync';

type ApplySimpleLeaveRequestToShiftPlanDateInput = {
  isoDate: string;
  label: string;
  normalizedStart: string | null;
  normalizedEnd: string | null;
  controlPlaneContext: LeaveRequestControlPlaneShiftSyncContext | null;
};

export async function applySimpleLeaveRequestToShiftPlanDate(
  tenantId: string,
  latestRow: LeaveRequestRow,
  input: ApplySimpleLeaveRequestToShiftPlanDateInput,
): Promise<void> {
  const start = latestRow.type === 'overtime' ? input.normalizedStart : null;
  const end = latestRow.type === 'overtime' ? input.normalizedEnd : null;

  await saveLeaveRequestShiftPlanDay(tenantId, latestRow.employee_id, {
    isoDate: input.isoDate,
    start,
    end,
    requiredPauseMinutes: 0,
    label: input.label,
    mode: 'unavailable',
  });

  await syncLeaveRequestDayToControlPlane(tenantId, input.controlPlaneContext, {
    isoDate: input.isoDate,
    start,
    end,
    label: input.label,
    mode: 'unavailable',
  });
}
