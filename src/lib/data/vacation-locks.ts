import type { VacationLock } from '@prisma/client';

import { getPrisma } from '@/lib/prisma';
import { listBranchesForEmployee } from '@/lib/data/branches';

export type VacationLockRow = {
  id: number;
  tenant_id: string;
  branch_id: number | null;
  branch_name: string | null;
  start_date: string;
  end_date: string;
  reason: string | null;
  created_by_admin_id: number | null;
  is_active: 0 | 1;
  created_at: string;
  updated_at: string;
};

export type CreateVacationLockInput = {
  tenantId: string;
  branchId?: number | null;
  startDate: string;
  endDate: string;
  reason?: string | null;
  createdByAdminId?: number | null;
};

function mapVacationLock(row: VacationLock & { branch?: { name: string } | null }): VacationLockRow {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    branch_id: row.branchId ?? null,
    branch_name: row.branch?.name ?? null,
    start_date: row.startDate,
    end_date: row.endDate,
    reason: row.reason ?? null,
    created_by_admin_id: row.createdByAdminId ?? null,
    is_active: Number(row.isActive ?? 0) === 1 ? 1 : 0,
    created_at: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? ''),
    updated_at: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt ?? ''),
  };
}

export async function createVacationLock(input: CreateVacationLockInput): Promise<number> {
  const prisma = getPrisma();
  if (input.branchId) {
    const exists = await prisma.branch.findFirst({
      where: { id: input.branchId, tenantId: input.tenantId },
      select: { id: true },
    });
    if (!exists) {
      throw new Error('Standort wurde nicht gefunden.');
    }
  }

  const created = await prisma.vacationLock.create({
    data: {
      tenantId: input.tenantId,
      branchId: input.branchId ?? null,
      startDate: input.startDate,
      endDate: input.endDate,
      reason: input.reason ?? null,
      createdByAdminId: input.createdByAdminId ?? null,
      isActive: 1,
    },
    select: { id: true },
  });

  return created.id;
}

export async function deactivateVacationLock(tenantId: string, id: number): Promise<void> {
  const prisma = getPrisma();
  const updated = await prisma.vacationLock.updateMany({
    where: { id, tenantId },
    data: { isActive: 0, updatedAt: new Date() },
  });
  if (updated.count === 0) {
    throw new Error('Urlaubssperre wurde nicht gefunden.');
  }
}

export async function listVacationLocksForDateRange(
  tenantId: string,
  startIso: string,
  endIso: string,
  branchId?: number | null,
): Promise<VacationLockRow[]> {
  const prisma = getPrisma();
  const rows = await prisma.vacationLock.findMany({
    where: {
      tenantId,
      ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
      startDate: { lte: endIso },
      endDate: { gte: startIso },
    },
    orderBy: [{ isActive: 'desc' }, { startDate: 'asc' }, { id: 'asc' }],
    include: {
      branch: { select: { name: true } },
    },
  });
  return rows.map(mapVacationLock);
}

export async function findActiveVacationLockForEmployee(
  tenantId: string,
  employeeId: number,
  startIso: string,
  endIso: string,
): Promise<VacationLockRow | null> {
  const prisma = getPrisma();
  const branches = await listBranchesForEmployee(tenantId, employeeId);
  const branchIds = branches.map((item) => item.id);

  const row = await prisma.vacationLock.findFirst({
    where: {
      tenantId,
      isActive: 1,
      startDate: { lte: endIso },
      endDate: { gte: startIso },
      OR: branchIds.length
        ? [{ branchId: null }, { branchId: { in: branchIds } }]
        : [{ branchId: null }],
    },
    orderBy: [{ branchId: 'desc' }, { startDate: 'asc' }, { id: 'asc' }],
    include: { branch: { select: { name: true } } },
  });

  return row ? mapVacationLock(row) : null;
}
