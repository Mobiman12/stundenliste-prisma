import { getPrisma } from '@/lib/prisma';

export interface EmployeeOvertimePayoutRow {
  payoutHours: number;
}

export interface EmployeeOvertimeHistoryEntry {
  year: number;
  month: number;
  payoutHours: number;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : (value as number);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalisePayoutHours(value: unknown): number {
  return Number(toNumber(value).toFixed(2));
}

export async function getEmployeeOvertimePayout(
  employeeId: number,
  year: number,
  month: number
): Promise<EmployeeOvertimePayoutRow | null> {
  const prisma = getPrisma();
  const row = await prisma.employeeOvertimePayout.findUnique({
    where: {
      employeeId_year_month: {
        employeeId,
        year,
        month,
      },
    },
    select: { payoutHours: true },
  });

  if (!row) {
    return null;
  }

  return {
    payoutHours: normalisePayoutHours(row.payoutHours),
  };
}

export async function upsertEmployeeOvertimePayout(
  employeeId: number,
  year: number,
  month: number,
  payoutHours: number
): Promise<void> {
  const prisma = getPrisma();
  const normalizedPayoutHours = normalisePayoutHours(payoutHours);

  await prisma.employeeOvertimePayout.upsert({
    where: {
      employeeId_year_month: {
        employeeId,
        year,
        month,
      },
    },
    update: {
      payoutHours: normalizedPayoutHours,
    },
    create: {
      employeeId,
      year,
      month,
      payoutHours: normalizedPayoutHours,
    },
  });
}

export async function sumEmployeeOvertimePayoutsUpTo(
  employeeId: number,
  year: number,
  month: number
): Promise<number> {
  const prisma = getPrisma();
  const row = await prisma.employeeOvertimePayout.aggregate({
    where: {
      employeeId,
      OR: [
        { year: { lt: year } },
        {
          year,
          month: { lte: month },
        },
      ],
    },
    _sum: {
      payoutHours: true,
    },
  });

  return normalisePayoutHours(row._sum.payoutHours);
}

export async function listEmployeeOvertimeHistory(
  employeeId: number,
  options: { limit?: number } = {}
): Promise<EmployeeOvertimeHistoryEntry[]> {
  const prisma = getPrisma();
  const limit = options.limit ?? 120;
  const rows = await prisma.employeeOvertimePayout.findMany({
    where: { employeeId },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    take: limit,
    select: {
      year: true,
      month: true,
      payoutHours: true,
    },
  });

  return rows.map((row) => ({
    year: Number(row.year ?? 0),
    month: Number(row.month ?? 0),
    payoutHours: normalisePayoutHours(row.payoutHours),
  }));
}
