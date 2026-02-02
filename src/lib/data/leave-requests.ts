import { getPrisma } from '@/lib/prisma';

export type LeaveRequestType = 'vacation' | 'overtime';
export type LeaveRequestStatus = 'pending' | 'approved' | 'rejected';

export type LeaveRequestRow = {
  id: number;
  employee_id: number;
  type: LeaveRequestType;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  status: LeaveRequestStatus;
  admin_note: string | null;
  decided_by: number | null;
  decided_at: string | null;
  cancellation_requested: 0 | 1;
  cancellation_requested_at: string | null;
  cancellation_note: string | null;
  cancelled_at: string | null;
  applied_to_shift_plan: 0 | 1;
  created_at: string;
  updated_at: string;
};

export type CreateLeaveRequestInput = {
  employeeId: number;
  type: LeaveRequestType;
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  reason?: string | null;
};

export type UpdateLeaveRequestStatusInput = {
  id: number;
  status: LeaveRequestStatus;
  adminNote?: string | null;
  decidedBy?: number | null;
};

function mapPrismaRow(row: any): LeaveRequestRow {
  return {
    id: row.id,
    employee_id: row.employeeId,
    type: row.type as LeaveRequestType,
    start_date: row.startDate,
    end_date: row.endDate,
    start_time: row.startTime ?? null,
    end_time: row.endTime ?? null,
    reason: row.reason ?? null,
    status: row.status as LeaveRequestStatus,
    admin_note: row.adminNote ?? null,
    decided_by: row.decidedBy ?? null,
    decided_at: row.decidedAt ?? null,
    cancellation_requested: Number(row.cancellationRequested ?? 0) === 1 ? 1 : 0,
    cancellation_requested_at: row.cancellationRequestedAt ?? null,
    cancellation_note: row.cancellationNote ?? null,
    cancelled_at: row.cancelledAt ?? null,
    applied_to_shift_plan: Number(row.appliedToShiftPlan ?? 0) === 1 ? 1 : 0,
    created_at: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? ''),
    updated_at: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt ?? ''),
  };
}

export async function createLeaveRequest(input: CreateLeaveRequestInput): Promise<number> {
  const prisma = getPrisma();
  const created = await prisma.leaveRequest.create({
    data: {
      employeeId: input.employeeId,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      startTime: input.startTime ?? null,
      endTime: input.endTime ?? null,
      reason: input.reason ?? null,
    },
    select: { id: true },
  });
  return created.id;
}

export async function listLeaveRequestsForEmployee(
  tenantId: string,
  employeeId: number,
  limit = 50
): Promise<LeaveRequestRow[]> {
  const prisma = getPrisma();
  const rows = await prisma.leaveRequest.findMany({
    where: { employeeId, employee: { tenantId } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
  return rows.map(mapPrismaRow);
}

export async function listLeaveRequests(
  tenantId: string,
  status: LeaveRequestStatus | 'all' = 'pending',
  limit = 100
): Promise<LeaveRequestRow[]> {
  const prisma = getPrisma();
  const rows = await prisma.leaveRequest.findMany({
    where:
      status === 'all'
        ? { employee: { tenantId } }
        : { status, employee: { tenantId } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
  // Emuliere vorherige Sortierung: offene/Storno zuerst, dann nach createdAt desc, id desc
  return rows
    .map(mapPrismaRow)
    .sort((a, b) => {
      const weightA = a.status === 'pending' || a.cancellation_requested === 1 ? 0 : 1;
      const weightB = b.status === 'pending' || b.cancellation_requested === 1 ? 0 : 1;
      if (weightA !== weightB) return weightA - weightB;
      if (a.created_at !== b.created_at) return a.created_at > b.created_at ? -1 : 1;
      return b.id - a.id;
    });
}

export async function getLeaveRequestById(
  tenantId: string,
  id: number
): Promise<LeaveRequestRow | null> {
  const prisma = getPrisma();
  const row = await prisma.leaveRequest.findFirst({ where: { id, employee: { tenantId } } });
  return row ? mapPrismaRow(row) : null;
}

export async function updateLeaveRequestStatus(
  tenantId: string,
  input: UpdateLeaveRequestStatusInput
): Promise<void> {
  const prisma = getPrisma();
  const updated = await prisma.leaveRequest.updateMany({
    where: { id: input.id, employee: { tenantId } },
    data: {
      status: input.status,
      adminNote: input.adminNote ?? null,
      decidedBy: input.decidedBy ?? null,
      decidedAt: input.status === 'pending' ? null : new Date().toISOString(),
      cancellationRequested: input.status === 'pending' ? undefined : 0,
      cancellationRequestedAt: input.status === 'pending' ? undefined : null,
      updatedAt: new Date(),
    },
  });
  if (updated.count === 0) {
    throw new Error('Antrag wurde nicht gefunden.');
  }
}

export async function countPendingLeaveRequests(tenantId: string): Promise<number> {
  const prisma = getPrisma();
  return prisma.leaveRequest.count({
    where: {
      employee: { tenantId },
      OR: [{ status: 'pending' }, { cancellationRequested: 1 }],
    },
  });
}

export async function markLeaveRequestShiftPlanApplied(
  tenantId: string,
  id: number,
  applied: boolean
): Promise<void> {
  const prisma = getPrisma();
  const updated = await prisma.leaveRequest.updateMany({
    where: { id, employee: { tenantId } },
    data: { appliedToShiftPlan: applied ? 1 : 0, updatedAt: new Date() },
  });
  if (updated.count === 0) {
    throw new Error('Antrag wurde nicht gefunden.');
  }
}

export async function markLeaveRequestCancellationRequested(
  tenantId: string,
  id: number,
  note: string | null
): Promise<void> {
  const prisma = getPrisma();
  const updated = await prisma.leaveRequest.updateMany({
    where: { id, employee: { tenantId } },
    data: {
      cancellationRequested: 1,
      cancellationRequestedAt: new Date().toISOString(),
      cancellationNote: note ?? null,
      updatedAt: new Date(),
    },
  });
  if (updated.count === 0) {
    throw new Error('Antrag wurde nicht gefunden.');
  }
}

export async function clearLeaveRequestCancellation(tenantId: string, id: number): Promise<void> {
  const prisma = getPrisma();
  const updated = await prisma.leaveRequest.updateMany({
    where: { id, employee: { tenantId } },
    data: {
      cancellationRequested: 0,
      cancellationRequestedAt: null,
      cancellationNote: null,
      updatedAt: new Date(),
    },
  });
  if (updated.count === 0) {
    throw new Error('Antrag wurde nicht gefunden.');
  }
}

export async function cancelLeaveRequestRecord(tenantId: string, input: {
  id: number;
  cancellationNote?: string | null;
  adminNote?: string | null;
  decidedBy?: number | null;
  resetApplied?: boolean;
}): Promise<void> {
  const prisma = getPrisma();
  const updated = await prisma.leaveRequest.updateMany({
    where: { id: input.id, employee: { tenantId } },
    data: {
      status: 'rejected',
      adminNote: input.adminNote !== undefined ? input.adminNote ?? null : undefined,
      cancellationNote: input.cancellationNote !== undefined ? input.cancellationNote ?? null : undefined,
      cancellationRequested: 0,
      cancellationRequestedAt: null,
      cancelledAt: new Date().toISOString(),
      decidedBy: input.decidedBy !== undefined ? input.decidedBy ?? null : undefined,
      appliedToShiftPlan: input.resetApplied ? 0 : undefined,
      updatedAt: new Date(),
    },
  });
  if (updated.count === 0) {
    throw new Error('Antrag wurde nicht gefunden.');
  }
}
