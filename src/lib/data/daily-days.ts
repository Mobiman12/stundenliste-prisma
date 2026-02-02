import { getPrisma } from '@/lib/prisma';
import { calculateIstHours as calculateIstHoursService } from '@/lib/services/time-calculations';

export interface DailyDayRecord {
  id: number;
  employee_id: number;
  day_date: string;
  brutto: number | null;
  kommt1: string | null;
  geht1: string | null;
  kommt2: string | null;
  geht2: string | null;
  pause: string | null;
  code: string | null;
  bemerkungen: string | null;
  mittag: string | null;
  schicht: string | null;
  sick_hours: number;
  child_sick_hours: number;
  short_work_hours: number;
  vacation_hours: number;
  holiday_hours: number;
  overtime_delta: number;
  plan_hours: number;
  forced_overflow: number;
  forced_overflow_real: number;
  required_pause_under6_minutes: number;
  admin_last_change_at: string | null;
  admin_last_change_by: string | null;
  admin_last_change_type: string | null;
  admin_last_change_summary: string | null;
}

export interface DailyDaySummary extends DailyDayRecord {
  ist_hours: number;
}

export interface UpsertDailyDayInput {
  id?: number;
  employeeId: number;
  dayDate: string; // ISO YYYY-MM-DD
  brutto?: number | null;
  kommt1?: string | null;
  geht1?: string | null;
  kommt2?: string | null;
  geht2?: string | null;
  pause?: string | null;
  code?: string | null;
  bemerkungen?: string | null;
  mittag?: string | null;
  schicht?: string | null;
  sickHours?: number | null;
  childSickHours?: number | null;
  shortWorkHours?: number | null;
  vacationHours?: number | null;
  holidayHours?: number | null;
  overtimeDelta?: number | null;
  planHours?: number | null;
  forcedOverflow?: number | null;
  forcedOverflowReal?: number | null;
  requiredPauseUnder6Minutes?: number | null;
}

function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const num = typeof value === 'string' ? Number.parseFloat(value) : (value as number);
  return Number.isFinite(num) ? num : fallback;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'string' ? Number.parseFloat(value) : (value as number);
  return Number.isFinite(num) ? num : null;
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value);
  return str.length ? str : null;
}

function mapRow(row: any): DailyDayRecord {
  return {
    id: row.id,
    employee_id: row.employeeId,
    day_date: row.dayDate,
    brutto: toNumberOrNull(row.brutto),
    kommt1: toStringOrNull(row.kommt1),
    geht1: toStringOrNull(row.geht1),
    kommt2: toStringOrNull(row.kommt2),
    geht2: toStringOrNull(row.geht2),
    pause: toStringOrNull(row.pause),
    code: toStringOrNull(row.code),
    bemerkungen: toStringOrNull(row.bemerkungen),
    mittag: toStringOrNull(row.mittag),
    schicht: toStringOrNull(row.schicht),
    sick_hours: toNumber(row.sickHours),
    child_sick_hours: toNumber(row.childSickHours),
    short_work_hours: toNumber(row.shortWorkHours),
    vacation_hours: toNumber(row.vacationHours),
    holiday_hours: toNumber(row.holidayHours),
    overtime_delta: toNumber(row.overtimeDelta),
    plan_hours: toNumber(row.planHours),
    forced_overflow: toNumber(row.forcedOverflow),
    forced_overflow_real: toNumber(row.forcedOverflowReal),
    required_pause_under6_minutes: toNumber(row.requiredPauseUnder6Minutes),
    admin_last_change_at: toStringOrNull(row.adminLastChangeAt),
    admin_last_change_by: toStringOrNull(row.adminLastChangeBy),
    admin_last_change_type: toStringOrNull(row.adminLastChangeType),
    admin_last_change_summary: toStringOrNull(row.adminLastChangeSummary),
  };
}

function computeIstHours(row: DailyDayRecord): number {
  const code = (row.code ?? '').toLowerCase();
  if (code === 'u' || code === 'ubf') {
    return 0;
  }
  const result = calculateIstHoursService(
    row.kommt1 ?? '',
    row.geht1 ?? '',
    row.kommt2 ?? '',
    row.geht2 ?? '',
    row.pause ?? 'Keine'
  );
  return Number(result.netHours.toFixed(2));
}

export async function listDailyDays(employeeId: number, limit = 60): Promise<DailyDaySummary[]> {
  const prisma = getPrisma();
  const rows = await prisma.dailyDay.findMany({
    where: { employeeId },
    orderBy: [{ dayDate: 'desc' }, { id: 'desc' }],
    take: limit,
  });
  return rows.map((row) => {
    const mapped = mapRow(row);
    return { ...mapped, ist_hours: computeIstHours(mapped) };
  });
}

export async function listDailyDayRecords(employeeId: number): Promise<DailyDayRecord[]> {
  const prisma = getPrisma();
  const rows = await prisma.dailyDay.findMany({
    where: { employeeId },
    orderBy: [{ dayDate: 'desc' }, { id: 'desc' }],
  });
  return rows.map(mapRow);
}

export async function upsertDailyDay(payload: UpsertDailyDayInput): Promise<number> {
  const prisma = getPrisma();
  const bruttoValue = toNumber(payload.brutto, 0);
  const result = await prisma.dailyDay.upsert({
    where: { employeeId_dayDate: { employeeId: payload.employeeId, dayDate: payload.dayDate } },
    update: {
      brutto: bruttoValue,
      kommt1: payload.kommt1 ?? null,
      geht1: payload.geht1 ?? null,
      kommt2: payload.kommt2 ?? null,
      geht2: payload.geht2 ?? null,
      pause: payload.pause ?? null,
      code: payload.code ?? null,
      bemerkungen: payload.bemerkungen ?? null,
      mittag: payload.mittag ?? 'Nein',
      schicht: payload.schicht ?? '',
      sickHours: toNumber(payload.sickHours, 0),
      childSickHours: toNumber(payload.childSickHours, 0),
      shortWorkHours: toNumber(payload.shortWorkHours, 0),
      vacationHours: toNumber(payload.vacationHours, 0),
      holidayHours: toNumber(payload.holidayHours, 0),
      overtimeDelta: toNumber(payload.overtimeDelta, 0),
      planHours: toNumber(payload.planHours, 0),
      forcedOverflow: toNumber(payload.forcedOverflow, 0),
      forcedOverflowReal: toNumber(payload.forcedOverflowReal ?? payload.forcedOverflow, 0),
      requiredPauseUnder6Minutes: toNumber(payload.requiredPauseUnder6Minutes, 0),
    },
    create: {
      employee: { connect: { id: payload.employeeId } },
      dayDate: payload.dayDate,
      brutto: bruttoValue,
      kommt1: payload.kommt1 ?? null,
      geht1: payload.geht1 ?? null,
      kommt2: payload.kommt2 ?? null,
      geht2: payload.geht2 ?? null,
      pause: payload.pause ?? null,
      code: payload.code ?? null,
      bemerkungen: payload.bemerkungen ?? null,
      mittag: payload.mittag ?? 'Nein',
      schicht: payload.schicht ?? '',
      sickHours: toNumber(payload.sickHours, 0),
      childSickHours: toNumber(payload.childSickHours, 0),
      shortWorkHours: toNumber(payload.shortWorkHours, 0),
      vacationHours: toNumber(payload.vacationHours, 0),
      holidayHours: toNumber(payload.holidayHours, 0),
      overtimeDelta: toNumber(payload.overtimeDelta, 0),
      planHours: toNumber(payload.planHours, 0),
      forcedOverflow: toNumber(payload.forcedOverflow, 0),
      forcedOverflowReal: toNumber(payload.forcedOverflowReal ?? payload.forcedOverflow, 0),
      requiredPauseUnder6Minutes: toNumber(payload.requiredPauseUnder6Minutes, 0),
    },
  });
  return result.id;
}

export async function getDailyDay(employeeId: number, dayDate: string): Promise<DailyDayRecord | null> {
  const prisma = getPrisma();
  const row = await prisma.dailyDay.findUnique({
    where: { employeeId_dayDate: { employeeId, dayDate } },
  });
  return row ? mapRow(row) : null;
}

export async function updateAdminChangeMeta(
  employeeId: number,
  dayDate: string,
  meta: { at: string; by: string; type: string; summary: string }
): Promise<void> {
  const prisma = getPrisma();
  await prisma.dailyDay.updateMany({
    where: { employeeId, dayDate },
    data: {
      adminLastChangeAt: meta.at,
      adminLastChangeBy: meta.by,
      adminLastChangeType: meta.type,
      adminLastChangeSummary: meta.summary,
    },
  });
}

export async function clearAdminChangeMeta(employeeId: number, dayDate: string): Promise<void> {
  const prisma = getPrisma();
  await prisma.dailyDay.updateMany({
    where: { employeeId, dayDate },
    data: {
      adminLastChangeAt: null,
      adminLastChangeBy: null,
      adminLastChangeType: null,
      adminLastChangeSummary: null,
    },
  });
}

export async function deleteDailyDay(id: number, employeeId: number): Promise<void> {
  const prisma = getPrisma();
  await prisma.dailyDay.deleteMany({ where: { id, employeeId } });
}

export async function deleteDailyDayByDate(employeeId: number, dayDate: string): Promise<void> {
  const prisma = getPrisma();
  await prisma.dailyDay.deleteMany({ where: { employeeId, dayDate } });
}
