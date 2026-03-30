import { getPrisma } from '@/lib/prisma';

export type MonthlyClosingStatus = 'open' | 'closed';

export interface MonthlyClosingRow {
  id: number | null;
  employeeId: number;
  year: number;
  month: number;
  status: MonthlyClosingStatus;
  closedAt: string | null;
  closedBy: string | null;
}

type MonthlyClosingRecord = {
  id: number;
  employeeId: number;
  year: number;
  month: number;
  status: string;
  closedAt: string | null;
  closedBy: string | null;
};

const MONTHLY_CLOSING_SELECT = {
  id: true,
  employeeId: true,
  year: true,
  month: true,
  status: true,
  closedAt: true,
  closedBy: true,
} as const;

function normaliseStatus(status: string | null | undefined): MonthlyClosingStatus {
  return typeof status === 'string' && status.toLowerCase() === 'closed' ? 'closed' : 'open';
}

function mapRow(row: MonthlyClosingRecord | null | undefined): MonthlyClosingRow | null {
  if (!row) {
    return null;
  }

  return {
    id: Number.isFinite(row.id) ? Number(row.id) : null,
    employeeId: Number(row.employeeId),
    year: Number(row.year),
    month: Number(row.month),
    status: normaliseStatus(row.status),
    closedAt: row.closedAt ?? null,
    closedBy: row.closedBy ?? null,
  };
}

export async function getMonthlyClosing(
  employeeId: number,
  year: number,
  month: number
): Promise<MonthlyClosingRow | null> {
  const prisma = getPrisma();
  const row = await prisma.monthlyClosing.findUnique({
    where: {
      employeeId_year_month: {
        employeeId,
        year,
        month,
      },
    },
    select: MONTHLY_CLOSING_SELECT,
  });

  return mapRow(row);
}

export async function upsertMonthlyClosingStatus(
  employeeId: number,
  year: number,
  month: number,
  status: MonthlyClosingStatus,
  closedAt: string | null,
  closedBy: string | null
): Promise<void> {
  const prisma = getPrisma();
  await prisma.monthlyClosing.upsert({
    where: {
      employeeId_year_month: {
        employeeId,
        year,
        month,
      },
    },
    update: {
      status,
      closedAt,
      closedBy,
    },
    create: {
      employeeId,
      year,
      month,
      status,
      closedAt,
      closedBy,
    },
  });
}

export async function listMonthlyClosings(
  employeeId: number,
  limit = 12
): Promise<MonthlyClosingRow[]> {
  const prisma = getPrisma();
  const rows = await prisma.monthlyClosing.findMany({
    where: { employeeId },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    take: limit,
    select: MONTHLY_CLOSING_SELECT,
  });

  return rows.map((row) => mapRow(row)!).filter((row): row is MonthlyClosingRow => !!row);
}

export async function listMonthlyClosingsForPeriod(
  employeeIds: number[],
  year: number,
  month: number
): Promise<MonthlyClosingRow[]> {
  if (!employeeIds.length) {
    return [];
  }

  const prisma = getPrisma();
  const rows = await prisma.monthlyClosing.findMany({
    where: {
      employeeId: { in: employeeIds },
      year,
      month,
    },
    orderBy: [{ employeeId: 'asc' }],
    select: MONTHLY_CLOSING_SELECT,
  });

  return rows.map((row) => mapRow(row)!).filter((row): row is MonthlyClosingRow => !!row);
}

export async function listClosingYears(): Promise<number[]> {
  const prisma = getPrisma();
  const rows = await prisma.monthlyClosing.findMany({
    select: { year: true },
    orderBy: [{ year: 'desc' }],
  });

  const years = Array.from(
    new Set(rows.map((row) => Number(row.year)).filter((year) => Number.isFinite(year)))
  );
  if (!years.length) {
    const now = new Date();
    return [now.getFullYear()];
  }

  return years;
}
