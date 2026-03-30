import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LeaveRequestRow } from '@/lib/data/leave-requests';

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  getLeaveRequestById: vi.fn(),
  markLeaveRequestShiftPlanApplied: vi.fn(),
  replaceLeaveRequestShiftPlanBackups: vi.fn(),
  listLeaveRequestShiftPlanBackups: vi.fn(),
  deleteLeaveRequestShiftPlanBackups: vi.fn(),
  resolveLeaveRequestControlPlaneShiftSyncContext: vi.fn(),
  syncLeaveRequestDayToControlPlane: vi.fn(),
  syncLeaveRequestSegmentsToControlPlane: vi.fn(),
  listShiftPlanDays: vi.fn(),
  getLeaveRequestPlanHoursForDay: vi.fn(),
  getLeaveRequestWeeklyFallbackPlanHoursForDay: vi.fn(),
  recomputeLeaveRequestEmployeeOvertime: vi.fn(),
  saveLeaveRequestShiftPlanDay: vi.fn(),
  saveLeaveRequestShiftPlanSegments: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock('@/lib/data/leave-requests', () => ({
  getLeaveRequestById: mocks.getLeaveRequestById,
  markLeaveRequestShiftPlanApplied: mocks.markLeaveRequestShiftPlanApplied,
}));

vi.mock('@/lib/data/leave-request-shift-plan-backups', () => ({
  replaceLeaveRequestShiftPlanBackups: mocks.replaceLeaveRequestShiftPlanBackups,
  listLeaveRequestShiftPlanBackups: mocks.listLeaveRequestShiftPlanBackups,
  deleteLeaveRequestShiftPlanBackups: mocks.deleteLeaveRequestShiftPlanBackups,
}));

vi.mock('@/lib/services/leave-request-control-plane-sync', () => ({
  resolveLeaveRequestControlPlaneShiftSyncContext: mocks.resolveLeaveRequestControlPlaneShiftSyncContext,
  syncLeaveRequestDayToControlPlane: mocks.syncLeaveRequestDayToControlPlane,
  syncLeaveRequestSegmentsToControlPlane: mocks.syncLeaveRequestSegmentsToControlPlane,
}));

vi.mock('@/lib/data/shift-plan-days', () => ({
  listShiftPlanDays: mocks.listShiftPlanDays,
}));

vi.mock('@/lib/services/leave-request-plan-read', () => ({
  getLeaveRequestPlanHoursForDay: mocks.getLeaveRequestPlanHoursForDay,
  getLeaveRequestWeeklyFallbackPlanHoursForDay: mocks.getLeaveRequestWeeklyFallbackPlanHoursForDay,
}));

vi.mock('@/lib/services/leave-request-shift-sync', () => ({
  recomputeLeaveRequestEmployeeOvertime: mocks.recomputeLeaveRequestEmployeeOvertime,
  saveLeaveRequestShiftPlanDay: mocks.saveLeaveRequestShiftPlanDay,
  saveLeaveRequestShiftPlanSegments: mocks.saveLeaveRequestShiftPlanSegments,
}));

import {
  applyApprovedRequestToShiftPlan,
  removeApprovedRequestFromShiftPlan,
} from '@/lib/services/leave-request-shift-orchestrator';

function makeRow(overrides: Partial<LeaveRequestRow> = {}): LeaveRequestRow {
  return {
    id: 41,
    employee_id: 7,
    type: 'vacation',
    start_date: '2026-04-10',
    end_date: '2026-04-10',
    start_time: null,
    end_time: null,
    reason: null,
    status: 'approved',
    admin_note: null,
    decided_by: 3,
    decided_at: '2026-03-29T10:00:00.000Z',
    cancellation_requested: 0,
    cancellation_requested_at: null,
    cancellation_note: null,
    cancelled_at: null,
    applied_to_shift_plan: 0,
    is_unpaid: 0,
    unpaid_days: 0,
    created_at: '2026-03-29T09:00:00.000Z',
    updated_at: '2026-03-29T09:00:00.000Z',
    ...overrides,
  };
}

describe('leave-request shift orchestrator', () => {
  let callLog: string[];

  beforeEach(() => {
    callLog = [];
    vi.clearAllMocks();

    mocks.getLeaveRequestById.mockResolvedValue(null);
    mocks.markLeaveRequestShiftPlanApplied.mockImplementation(
      async (_tenantId: string, _requestId: number, applied: boolean) => {
        callLog.push(`mark:${applied}`);
      },
    );
    mocks.replaceLeaveRequestShiftPlanBackups.mockImplementation(async () => {
      callLog.push('replaceBackups');
    });
    mocks.listLeaveRequestShiftPlanBackups.mockResolvedValue([]);
    mocks.deleteLeaveRequestShiftPlanBackups.mockImplementation(async () => {
      callLog.push('deleteBackups');
    });
    mocks.resolveLeaveRequestControlPlaneShiftSyncContext.mockResolvedValue(null);
    mocks.syncLeaveRequestDayToControlPlane.mockImplementation(async () => {
      callLog.push('syncDay');
    });
    mocks.syncLeaveRequestSegmentsToControlPlane.mockImplementation(async () => {
      callLog.push('syncSegments');
    });
    mocks.listShiftPlanDays.mockResolvedValue([]);
    mocks.getLeaveRequestPlanHoursForDay.mockResolvedValue(null);
    mocks.getLeaveRequestWeeklyFallbackPlanHoursForDay.mockResolvedValue(null);
    mocks.recomputeLeaveRequestEmployeeOvertime.mockImplementation(async () => {
      callLog.push('recompute');
    });
    mocks.saveLeaveRequestShiftPlanDay.mockImplementation(async () => {
      callLog.push('saveDay');
    });
    mocks.saveLeaveRequestShiftPlanSegments.mockImplementation(async () => {
      callLog.push('saveSegments');
    });
    mocks.revalidatePath.mockImplementation((path: string) => {
      callLog.push(`revalidate:${path}`);
    });
  });

  it('applies a vacation request, writes the shift-plan day, marks the request and recomputes overtime', async () => {
    const row = makeRow();
    mocks.getLeaveRequestById.mockResolvedValue(row);
    mocks.listShiftPlanDays.mockResolvedValue([]);
    mocks.getLeaveRequestPlanHoursForDay.mockResolvedValue({
      rawHours: 8,
      sollHours: 7.5,
      requiredPauseMinutes: 30,
      start: '08:00',
      end: '16:00',
    });

    await applyApprovedRequestToShiftPlan('tenant-a', row);

    expect(mocks.replaceLeaveRequestShiftPlanBackups).toHaveBeenCalledWith('tenant-a', row.id, [
      {
        leaveRequestId: row.id,
        employeeId: row.employee_id,
        dayDate: row.start_date,
        segmentIndex: 0,
        mode: 'available',
        startTime: '08:00',
        endTime: '16:00',
        requiredPauseMinutes: 30,
        label: null,
        branchId: null,
      },
    ]);
    expect(mocks.saveLeaveRequestShiftPlanDay).toHaveBeenCalledWith('tenant-a', row.employee_id, {
      isoDate: row.start_date,
      start: null,
      end: null,
      requiredPauseMinutes: 0,
      label: 'Urlaub',
      mode: 'unavailable',
    });
    expect(mocks.saveLeaveRequestShiftPlanSegments).not.toHaveBeenCalled();
    expect(mocks.syncLeaveRequestDayToControlPlane).toHaveBeenCalledWith('tenant-a', null, {
      isoDate: row.start_date,
      start: null,
      end: null,
      label: 'Urlaub',
      mode: 'unavailable',
    });
    expect(mocks.markLeaveRequestShiftPlanApplied).toHaveBeenCalledWith('tenant-a', row.id, true);
    expect(mocks.recomputeLeaveRequestEmployeeOvertime).toHaveBeenCalledWith('tenant-a', row.employee_id);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/mitarbeiter/schichtplan');
    expect(callLog.indexOf('replaceBackups')).toBeLessThan(callLog.indexOf('saveDay'));
    expect(callLog.indexOf('saveDay')).toBeLessThan(callLog.indexOf('syncDay'));
    expect(callLog.indexOf('syncDay')).toBeLessThan(callLog.indexOf('mark:true'));
    expect(callLog.indexOf('mark:true')).toBeLessThan(callLog.indexOf('recompute'));
  });

  it('applies an overtime request via segments and keeps the overtime block in the shift plan', async () => {
    const row = makeRow({
      id: 42,
      type: 'overtime',
      start_time: '10:00',
      end_time: '12:00',
    });
    const existingSegments = [
      {
        id: 1,
        employee_id: row.employee_id,
        day_date: row.start_date,
        segment_index: 0,
        mode: 'available',
        start_time: '08:00',
        end_time: '16:00',
        required_pause_minutes: 0,
        label: null,
        branch_id: 5,
        branch_name: 'HQ',
        created_at: '2026-03-29T00:00:00.000Z',
        updated_at: '2026-03-29T00:00:00.000Z',
      },
    ];
    mocks.getLeaveRequestById.mockResolvedValue(row);
    mocks.listShiftPlanDays.mockResolvedValue(existingSegments);
    mocks.getLeaveRequestWeeklyFallbackPlanHoursForDay.mockResolvedValue({
      rawHours: 8,
      sollHours: 8,
      requiredPauseMinutes: 0,
      start: '08:00',
      end: '16:00',
    });

    await applyApprovedRequestToShiftPlan('tenant-a', row);

    expect(mocks.saveLeaveRequestShiftPlanSegments).toHaveBeenCalledWith('tenant-a', row.employee_id, {
      isoDate: row.start_date,
      segments: [
        {
          segmentIndex: 0,
          mode: 'available',
          start: '08:00',
          end: '10:00',
          requiredPauseMinutes: 0,
          label: null,
          branchId: 5,
        },
        {
          segmentIndex: 1,
          mode: 'unavailable',
          start: '10:00',
          end: '12:00',
          requiredPauseMinutes: 0,
          label: 'Überstundenabbau',
          branchId: 5,
        },
        {
          segmentIndex: 2,
          mode: 'available',
          start: '12:00',
          end: '16:00',
          requiredPauseMinutes: 0,
          label: null,
          branchId: 5,
        },
      ],
    });
    expect(mocks.syncLeaveRequestSegmentsToControlPlane).toHaveBeenCalledWith(
      'tenant-a',
      null,
      row.start_date,
      [
        {
          mode: 'available',
          start: '08:00',
          end: '10:00',
          requiredPauseMinutes: 0,
          label: null,
          branchId: 5,
        },
        {
          mode: 'unavailable',
          start: '10:00',
          end: '12:00',
          requiredPauseMinutes: 0,
          label: 'Überstundenabbau',
          branchId: 5,
        },
        {
          mode: 'available',
          start: '12:00',
          end: '16:00',
          requiredPauseMinutes: 0,
          label: null,
          branchId: 5,
        },
      ],
    );
    expect(mocks.saveLeaveRequestShiftPlanDay).not.toHaveBeenCalled();
    expect(mocks.markLeaveRequestShiftPlanApplied).toHaveBeenCalledWith('tenant-a', row.id, true);
    expect(mocks.recomputeLeaveRequestEmployeeOvertime).toHaveBeenCalledWith('tenant-a', row.employee_id);
    expect(callLog.indexOf('saveSegments')).toBeLessThan(callLog.indexOf('syncSegments'));
    expect(callLog.indexOf('syncSegments')).toBeLessThan(callLog.indexOf('mark:true'));
  });

  it('restores backed up segments on undo, clears the applied flag and recomputes overtime', async () => {
    const row = makeRow({ id: 43, applied_to_shift_plan: 1 });
    mocks.listLeaveRequestShiftPlanBackups.mockResolvedValue([
      {
        id: 9,
        leave_request_id: row.id,
        employee_id: row.employee_id,
        day_date: row.start_date,
        segment_index: 0,
        mode: 'available',
        start_time: '08:00',
        end_time: '16:00',
        required_pause_minutes: 30,
        label: null,
        branch_id: 4,
      },
    ]);

    await removeApprovedRequestFromShiftPlan('tenant-a', row);

    expect(mocks.saveLeaveRequestShiftPlanSegments).toHaveBeenCalledWith('tenant-a', row.employee_id, {
      isoDate: row.start_date,
      segments: [
        {
          segmentIndex: 0,
          mode: 'available',
          start: '08:00',
          end: '16:00',
          requiredPauseMinutes: 30,
          label: null,
          branchId: 4,
        },
      ],
    });
    expect(mocks.syncLeaveRequestSegmentsToControlPlane).toHaveBeenCalledWith(
      'tenant-a',
      null,
      row.start_date,
      [
        {
          mode: 'available',
          start: '08:00',
          end: '16:00',
          requiredPauseMinutes: 30,
          label: null,
          branchId: 4,
        },
      ],
    );
    expect(mocks.deleteLeaveRequestShiftPlanBackups).toHaveBeenCalledWith('tenant-a', row.id);
    expect(mocks.markLeaveRequestShiftPlanApplied).toHaveBeenCalledWith('tenant-a', row.id, false);
    expect(mocks.recomputeLeaveRequestEmployeeOvertime).toHaveBeenCalledWith('tenant-a', row.employee_id);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/mitarbeiter/schichtplan');
    expect(callLog.indexOf('saveSegments')).toBeLessThan(callLog.indexOf('syncSegments'));
    expect(callLog.indexOf('syncSegments')).toBeLessThan(callLog.indexOf('deleteBackups'));
    expect(callLog.indexOf('deleteBackups')).toBeLessThan(callLog.indexOf('mark:false'));
    expect(callLog.indexOf('mark:false')).toBeLessThan(callLog.indexOf('recompute'));
  });
});
