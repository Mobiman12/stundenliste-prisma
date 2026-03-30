import { getPrisma } from '@/lib/prisma';

export type OvertimePayoutRequestStatus = 'pending' | 'approved' | 'rejected';

export interface OvertimePayoutRequestRow {
  id: number;
  employee_id: number;
  year: number;
  month: number;
  requested_hours: number;
  note: string | null;
  status: OvertimePayoutRequestStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateOvertimePayoutRequestInput {
  employeeId: number;
  year: number;
  month: number;
  hours: number;
  note?: string | null;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : (value as number);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatTimestamp(value: Date): string {
  return value.toISOString().slice(0, 19).replace('T', ' ');
}

function mapRow(row: {
  id: number;
  employeeId: number;
  year: number;
  month: number;
  requestedHours: number;
  note: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): OvertimePayoutRequestRow {
  return {
    id: Number(row.id ?? 0),
    employee_id: Number(row.employeeId ?? 0),
    year: Number(row.year ?? 0),
    month: Number(row.month ?? 0),
    requested_hours: toNumber(row.requestedHours),
    note: row.note ?? null,
    status: ((row.status as OvertimePayoutRequestStatus | null | undefined) ?? 'pending'),
    created_at: formatTimestamp(row.createdAt),
    updated_at: formatTimestamp(row.updatedAt),
  };
}

export async function createOvertimePayoutRequest(input: CreateOvertimePayoutRequestInput): Promise<number> {
  const prisma = getPrisma();
  const created = await prisma.overtimePayoutRequest.create({
    data: {
      employeeId: input.employeeId,
      year: input.year,
      month: input.month,
      requestedHours: input.hours,
      note: input.note ?? null,
    },
    select: {
      id: true,
    },
  });

  return Number(created.id ?? 0);
}

export async function listOvertimePayoutRequests(
  employeeId: number,
  year: number,
  month: number,
  limit = 5
): Promise<OvertimePayoutRequestRow[]> {
  const prisma = getPrisma();
  const rows = await prisma.overtimePayoutRequest.findMany({
    where: {
      employeeId,
      year,
      month,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    select: {
      id: true,
      employeeId: true,
      year: true,
      month: true,
      requestedHours: true,
      note: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return rows.map(mapRow);
}
