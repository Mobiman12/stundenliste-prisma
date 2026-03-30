import { fetchStaffShiftPlanSettings, pushShiftPlanDayToControlPlane } from '@/lib/control-plane';
import { getEmployeeById, updateEmployeeControlPlaneStaffId } from '@/lib/data/employees';

export type LeaveRequestControlPlaneShiftSyncContext = {
  staffId: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
};

export type LeaveRequestControlPlaneShiftSegment = {
  mode: 'available' | 'unavailable';
  start: string | null;
  end: string | null;
  requiredPauseMinutes: number;
  label: string | null;
  branchId: number | null;
};

export async function resolveLeaveRequestControlPlaneShiftSyncContext(
  tenantId: string,
  employeeId: number,
): Promise<LeaveRequestControlPlaneShiftSyncContext | null> {
  const employee = await getEmployeeById(tenantId, employeeId);
  if (!employee) return null;

  const existingStaffId = employee.control_plane_staff_id ?? employee.personnel_number ?? null;
  const displayName = `${employee.first_name ?? ''} ${employee.last_name ?? ''}`.trim() || employee.username;
  const settings = await fetchStaffShiftPlanSettings({
    tenantId,
    staffId: existingStaffId,
    email: employee.email ?? employee.username ?? null,
    firstName: employee.first_name ?? null,
    lastName: employee.last_name ?? null,
    displayName,
  });
  const resolvedStaffId = settings.staffId ?? existingStaffId ?? null;

  if (settings.staffId && settings.staffId !== existingStaffId) {
    await updateEmployeeControlPlaneStaffId(tenantId, employee.id, settings.staffId);
  }

  return {
    staffId: resolvedStaffId,
    email: employee.email ?? employee.username ?? null,
    firstName: employee.first_name ?? null,
    lastName: employee.last_name ?? null,
    displayName: displayName || null,
  };
}

export async function syncLeaveRequestDayToControlPlane(
  tenantId: string,
  context: LeaveRequestControlPlaneShiftSyncContext | null,
  input: {
    isoDate: string;
    start?: string | null;
    end?: string | null;
    label?: string | null;
    mode?: 'available' | 'unavailable';
  },
): Promise<void> {
  if (!context) return;

  // Replace day in Control Plane: clear all existing segments first, then write current state.
  await pushShiftPlanDayToControlPlane({
    tenantId,
    staffId: context.staffId,
    email: context.email,
    firstName: context.firstName,
    lastName: context.lastName,
    displayName: context.displayName,
    isoDate: input.isoDate,
    start: null,
    end: null,
    pause: 0,
    label: null,
    branchId: null,
    segmentIndex: null,
    mode: 'available',
  });

  await pushShiftPlanDayToControlPlane({
    tenantId,
    staffId: context.staffId,
    email: context.email,
    firstName: context.firstName,
    lastName: context.lastName,
    displayName: context.displayName,
    isoDate: input.isoDate,
    start: input.start ?? null,
    end: input.end ?? null,
    pause: 0,
    label: input.label ?? null,
    branchId: null,
    segmentIndex: 0,
    mode: input.mode ?? 'available',
  });
}

export async function syncLeaveRequestSegmentsToControlPlane(
  tenantId: string,
  context: LeaveRequestControlPlaneShiftSyncContext | null,
  isoDate: string,
  segments: LeaveRequestControlPlaneShiftSegment[],
): Promise<void> {
  if (!context) return;

  // Replace day in Control Plane: remove stale segment indices before writing fresh segments.
  await pushShiftPlanDayToControlPlane({
    tenantId,
    staffId: context.staffId,
    email: context.email,
    firstName: context.firstName,
    lastName: context.lastName,
    displayName: context.displayName,
    isoDate,
    start: null,
    end: null,
    pause: 0,
    label: null,
    branchId: null,
    segmentIndex: null,
    mode: 'available',
  });

  if (!segments.length) {
    return;
  }

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    await pushShiftPlanDayToControlPlane({
      tenantId,
      staffId: context.staffId,
      email: context.email,
      firstName: context.firstName,
      lastName: context.lastName,
      displayName: context.displayName,
      isoDate,
      start: segment.start,
      end: segment.end,
      pause: segment.requiredPauseMinutes,
      label: segment.label,
      branchId: segment.branchId,
      segmentIndex: index,
      mode: segment.mode,
    });
  }
}
