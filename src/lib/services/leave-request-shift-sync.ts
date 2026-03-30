import { recomputeEmployeeOvertime } from '@/lib/services/time-entry';
import {
  saveShiftPlanDay,
  saveShiftPlanDaySegments,
} from '@/lib/services/shift-plan';

type LeaveRequestShiftPlanSegmentInput = {
  segmentIndex?: number | null;
  mode?: 'available' | 'unavailable' | null;
  start?: string | null;
  end?: string | null;
  requiredPauseMinutes?: number | null | undefined;
  label?: string | null;
  branchId?: number | null;
};

export async function saveLeaveRequestShiftPlanSegments(
  tenantId: string,
  employeeId: number,
  input: {
    isoDate: string;
    segments: LeaveRequestShiftPlanSegmentInput[];
  },
): Promise<void> {
  await saveShiftPlanDaySegments(tenantId, employeeId, input);
}

export async function saveLeaveRequestShiftPlanDay(
  tenantId: string,
  employeeId: number,
  input: {
    isoDate: string;
    start?: string | null;
    end?: string | null;
    requiredPauseMinutes?: number | null | undefined;
    label?: string | null;
    branchId?: number | null;
    segmentIndex?: number | null;
    mode?: 'available' | 'unavailable' | null;
  },
): Promise<void> {
  await saveShiftPlanDay(tenantId, employeeId, input);
}

export async function recomputeLeaveRequestEmployeeOvertime(
  tenantId: string,
  employeeId: number,
): Promise<void> {
  await recomputeEmployeeOvertime(tenantId, employeeId);
}
