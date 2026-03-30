import { getPrisma } from '@/lib/prisma';

export type BonusPayoutRequestStatus = 'pending' | 'approved' | 'rejected';

export interface BonusPayoutRequestRow {
  id: number;
  employee_id: number;
  year: number;
  month: number;
  requested_amount: number;
  note: string | null;
  status: BonusPayoutRequestStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateBonusPayoutRequestInput {
  employeeId: number;
  year: number;
  month: number;
  amount: number;
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
  requestedAmount: number;
  note: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): BonusPayoutRequestRow {
  return {
    id: Number(row.id ?? 0),
    employee_id: Number(row.employeeId ?? 0),
    year: Number(row.year ?? 0),
    month: Number(row.month ?? 0),
    requested_amount: toNumber(row.requestedAmount),
    note: row.note ?? null,
    status: ((row.status as BonusPayoutRequestStatus | null | undefined) ?? 'pending'),
    created_at: formatTimestamp(row.createdAt),
    updated_at: formatTimestamp(row.updatedAt),
  };
}

export async function createBonusPayoutRequest(input: CreateBonusPayoutRequestInput): Promise<number> {
  const prisma = getPrisma();
  const created = await prisma.bonusPayoutRequest.create({
    data: {
      employeeId: input.employeeId,
      year: input.year,
      month: input.month,
      requestedAmount: input.amount,
      note: input.note ?? null,
    },
    select: {
      id: true,
    },
  });

  return Number(created.id ?? 0);
}

export async function listBonusPayoutRequests(
  employeeId: number,
  year: number,
  month: number,
  limit = 5
): Promise<BonusPayoutRequestRow[]> {
  const prisma = getPrisma();
  const rows = await prisma.bonusPayoutRequest.findMany({
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
      requestedAmount: true,
      note: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return rows.map(mapRow);
}
