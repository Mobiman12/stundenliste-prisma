import { getPrisma } from '@/lib/prisma';

export type ShiftPlanDayRecord = {
  id: number;
  employee_id: number;
  day_date: string;
  segment_index: number;
  mode: 'available' | 'unavailable';
  start_time: string | null;
  end_time: string | null;
  required_pause_minutes: number;
  label: string | null;
  branch_id: number | null;
  branch_name?: string | null;
  created_at: string;
  updated_at: string;
};

export type ShiftPlanDayInput = {
  dayDate: string;
  segmentIndex?: number | null;
  mode?: 'available' | 'unavailable' | null;
  startTime: string | null;
  endTime: string | null;
  requiredPauseMinutes: number | null | undefined;
  label?: string | null;
  branchId?: number | null;
};

const sanitizeTime = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    return trimmed.padStart(5, '0');
  }
  return trimmed;
};

const sanitizePause = (value: number | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.round(value));
};

function mapRecord(row: any): ShiftPlanDayRecord {
  return {
    id: row.id,
    employee_id: row.employeeId,
    day_date: row.dayDate,
    segment_index: row.segmentIndex ?? 0,
    mode: row.mode === 'unavailable' ? 'unavailable' : 'available',
    start_time: row.startTime,
    end_time: row.endTime,
    required_pause_minutes: row.requiredPauseMinutes ?? 0,
    label: row.label,
    branch_id: row.branchId,
    branch_name: row.branch?.name ?? null,
    created_at: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updated_at: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

export async function listShiftPlanDays(employeeId: number, start?: string, end?: string): Promise<ShiftPlanDayRecord[]> {
  const prisma = getPrisma();
  const rows = await prisma.shiftPlanDay.findMany({
    where: {
      employeeId,
      ...(start ? { dayDate: { gte: start } } : {}),
      ...(end ? { dayDate: { lte: end } } : {}),
    },
    include: { branch: { select: { name: true } } },
    orderBy: [{ dayDate: 'asc' }, { segmentIndex: 'asc' }],
  });
  return rows.map(mapRecord);
}

export async function listShiftPlanDaysForEmployees(
  employeeIds: number[],
  start: string,
  end: string
): Promise<ShiftPlanDayRecord[]> {
  if (!employeeIds.length) return [];
  const prisma = getPrisma();
  const rows = await prisma.shiftPlanDay.findMany({
    where: {
      employeeId: { in: employeeIds },
      dayDate: { gte: start, lte: end },
    },
    include: { branch: { select: { name: true } } },
    orderBy: [{ employeeId: 'asc' }, { dayDate: 'asc' }, { segmentIndex: 'asc' }],
  });
  return rows.map(mapRecord);
}

export async function getShiftPlanDayRecord(employeeId: number, isoDate: string): Promise<ShiftPlanDayRecord | null> {
  const prisma = getPrisma();
  const row = await prisma.shiftPlanDay.findFirst({
    where: { employeeId, dayDate: isoDate, segmentIndex: 0 },
    include: { branch: { select: { name: true } } },
    orderBy: [{ segmentIndex: 'asc' }],
  });
  return row ? mapRecord(row) : null;
}

export async function upsertShiftPlanDays(employeeId: number, entries: ShiftPlanDayInput[]): Promise<void> {
  if (!entries.length) return;
  const prisma = getPrisma();

  const payloads = entries.map((entry) => ({
    employeeId,
    dayDate: entry.dayDate,
    segmentIndex: Math.max(0, Math.floor(Number(entry.segmentIndex ?? 0) || 0)),
    mode: entry.mode === 'unavailable' ? 'unavailable' : 'available',
    startTime: sanitizeTime(entry.startTime),
    endTime: sanitizeTime(entry.endTime),
    requiredPauseMinutes: sanitizePause(entry.requiredPauseMinutes),
    label: entry.label?.trim() || null,
    branchId: entry.branchId ?? null,
  }));

  await prisma.$transaction(async (tx) => {
    for (const payload of payloads) {
      await tx.shiftPlanDay.upsert({
        where: { employeeId_dayDate_segmentIndex: { employeeId, dayDate: payload.dayDate, segmentIndex: payload.segmentIndex } },
        update: {
          segmentIndex: payload.segmentIndex,
          mode: payload.mode,
          startTime: payload.startTime,
          endTime: payload.endTime,
          requiredPauseMinutes: payload.requiredPauseMinutes,
          label: payload.label,
          branchId: payload.branchId,
        },
        create: payload,
      });
    }
  });
}

export async function deleteShiftPlanDays(employeeId: number, start: string, end: string): Promise<void> {
  const prisma = getPrisma();
  await prisma.shiftPlanDay.deleteMany({
    where: { employeeId, dayDate: { gte: start, lte: end } },
  });
}

export async function deleteShiftPlanDay(employeeId: number, isoDate: string): Promise<void> {
  const prisma = getPrisma();
  await prisma.shiftPlanDay.deleteMany({ where: { employeeId, dayDate: isoDate } });
}
