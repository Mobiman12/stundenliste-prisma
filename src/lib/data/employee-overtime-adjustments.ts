import { getPrisma } from '@/lib/prisma';

export interface EmployeeOvertimeAdjustmentInput {
  tenantId: string;
  employeeId: number;
  year: number;
  month: number;
  deltaHours: number;
  balanceBefore: number;
  balanceAfter: number;
  correctionBefore: number;
  correctionAfter: number;
  createdByAdminId: number | null;
  createdByAdminName: string | null;
  reason?: string | null;
}

export interface EmployeeOvertimeAdjustmentEntry {
  id: number;
  year: number;
  month: number;
  deltaHours: number;
  balanceBefore: number;
  balanceAfter: number;
  correctionBefore: number;
  correctionAfter: number;
  createdByAdminId: number | null;
  createdByAdminName: string | null;
  reason: string | null;
  createdAt: string;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function createEmployeeOvertimeAdjustment(
  input: EmployeeOvertimeAdjustmentInput
): Promise<void> {
  const prisma = getPrisma();
  await prisma.employeeOvertimeAdjustment.create({
    data: {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      year: input.year,
      month: input.month,
      deltaHours: roundTwo(input.deltaHours),
      balanceBefore: roundTwo(input.balanceBefore),
      balanceAfter: roundTwo(input.balanceAfter),
      correctionBefore: roundTwo(input.correctionBefore),
      correctionAfter: roundTwo(input.correctionAfter),
      createdByAdminId: input.createdByAdminId,
      createdByAdminName: input.createdByAdminName,
      reason: input.reason?.trim() || null,
    },
  });
}

export async function listEmployeeOvertimeAdjustments(
  tenantId: string,
  employeeId: number,
  options: { limit?: number } = {}
): Promise<EmployeeOvertimeAdjustmentEntry[]> {
  const prisma = getPrisma();
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(200, Math.floor(options.limit ?? 20))) : 20;

  const rows = await prisma.employeeOvertimeAdjustment.findMany({
    where: {
      tenantId,
      employeeId,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    select: {
      id: true,
      year: true,
      month: true,
      deltaHours: true,
      balanceBefore: true,
      balanceAfter: true,
      correctionBefore: true,
      correctionAfter: true,
      createdByAdminId: true,
      createdByAdminName: true,
      reason: true,
      createdAt: true,
    },
  });

  return rows.map((row) => ({
    id: Number(row.id),
    year: Number(row.year),
    month: Number(row.month),
    deltaHours: roundTwo(Number(row.deltaHours ?? 0)),
    balanceBefore: roundTwo(Number(row.balanceBefore ?? 0)),
    balanceAfter: roundTwo(Number(row.balanceAfter ?? 0)),
    correctionBefore: roundTwo(Number(row.correctionBefore ?? 0)),
    correctionAfter: roundTwo(Number(row.correctionAfter ?? 0)),
    createdByAdminId: Number.isFinite(Number(row.createdByAdminId)) ? Number(row.createdByAdminId) : null,
    createdByAdminName: row.createdByAdminName?.trim() || null,
    reason: row.reason?.trim() || null,
    createdAt: row.createdAt.toISOString(),
  }));
}
