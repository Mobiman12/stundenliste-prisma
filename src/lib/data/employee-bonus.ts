import { getPrisma } from '@/lib/prisma';

export interface EmployeeBonusRow {
  payout: number;
  carryOver: number;
}

export interface EmployeeBonusHistoryEntry {
  year: number;
  month: number;
  payout: number;
  carryOver: number;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : (value as number);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normaliseMoney(value: unknown): number {
  return Number(toNumber(value).toFixed(2));
}

export async function getEmployeeBonusEntry(
  employeeId: number,
  year: number,
  month: number
): Promise<EmployeeBonusRow | null> {
  const prisma = getPrisma();
  const row = await prisma.employeeBonus.findUnique({
    where: {
      employeeId_year_month: {
        employeeId,
        year,
        month,
      },
    },
    select: {
      auszahlung: true,
      uebertrag: true,
    },
  });

  if (!row) {
    return null;
  }

  return {
    payout: normaliseMoney(row.auszahlung),
    carryOver: normaliseMoney(row.uebertrag),
  };
}

export async function upsertEmployeeBonusEntry(
  employeeId: number,
  year: number,
  month: number,
  payout: number,
  carryOver: number
): Promise<void> {
  const prisma = getPrisma();
  const normalizedPayout = normaliseMoney(payout);
  const normalizedCarryOver = normaliseMoney(carryOver);

  await prisma.employeeBonus.upsert({
    where: {
      employeeId_year_month: {
        employeeId,
        year,
        month,
      },
    },
    update: {
      auszahlung: normalizedPayout,
      uebertrag: normalizedCarryOver,
    },
    create: {
      employeeId,
      year,
      month,
      auszahlung: normalizedPayout,
      uebertrag: normalizedCarryOver,
    },
  });
}

export async function getPreviousEmployeeBonusEntry(
  employeeId: number,
  year: number,
  month: number
): Promise<EmployeeBonusRow | null> {
  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear -= 1;
  }

  if (prevYear <= 0) {
    return null;
  }

  return getEmployeeBonusEntry(employeeId, prevYear, prevMonth);
}

export async function listEmployeeBonusHistory(
  employeeId: number,
  options: { limit?: number } = {}
): Promise<EmployeeBonusHistoryEntry[]> {
  const prisma = getPrisma();
  const limit = options.limit ?? 120;
  const rows = await prisma.employeeBonus.findMany({
    where: { employeeId },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    take: limit,
    select: {
      year: true,
      month: true,
      auszahlung: true,
      uebertrag: true,
    },
  });

  return rows.map((row) => ({
    year: Number(row.year ?? 0),
    month: Number(row.month ?? 0),
    payout: normaliseMoney(row.auszahlung),
    carryOver: normaliseMoney(row.uebertrag),
  }));
}
