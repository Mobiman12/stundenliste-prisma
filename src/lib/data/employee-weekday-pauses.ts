import { getPrisma } from '@/lib/prisma';

export interface EmployeeWeekdayPauseRecord {
  employee_id: number;
  weekday: number;
  minutes: number;
  updated_at: string;
}

export interface EmployeeWeekdayPauseInput {
  weekday: number;
  minutes: number;
}

export async function listEmployeeWeekdayPauses(employeeId: number): Promise<EmployeeWeekdayPauseRecord[]> {
  const prisma = getPrisma();
  const rows = await prisma.employeeWeekdayPause.findMany({
    where: { employeeId },
    orderBy: { weekday: 'asc' },
  });
  return rows.map((row) => ({
    employee_id: row.employeeId,
    weekday: row.weekday,
    minutes: row.minutes,
    updated_at: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  }));
}

export async function replaceEmployeeWeekdayPauses(
  employeeId: number,
  entries: EmployeeWeekdayPauseInput[]
): Promise<void> {
  const prisma = getPrisma();
  const sanitized = entries
    .filter((entry) => Number.isInteger(entry.weekday) && entry.weekday >= 0 && entry.weekday <= 6)
    .map((entry) => ({
      employeeId,
      weekday: entry.weekday,
      minutes: Math.max(0, Math.round(entry.minutes)),
    }));

  await prisma.$transaction(async (tx) => {
    await tx.employeeWeekdayPause.deleteMany({ where: { employeeId } });
    if (sanitized.length) {
      await tx.employeeWeekdayPause.createMany({ data: sanitized, skipDuplicates: true });
    }
  });
}
