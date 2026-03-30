import { getPrisma } from '@/lib/prisma';

export const SHIFT_PLAN_DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type ShiftPlanDayKey = typeof SHIFT_PLAN_DAY_KEYS[number];

export type ShiftPlanRow = {
  two_week_cycle: string | null;
  w1_mon_start: string | null;
  w1_mon_end: string | null;
  w1_tue_start: string | null;
  w1_tue_end: string | null;
  w1_wed_start: string | null;
  w1_wed_end: string | null;
  w1_thu_start: string | null;
  w1_thu_end: string | null;
  w1_fri_start: string | null;
  w1_fri_end: string | null;
  w1_sat_start: string | null;
  w1_sat_end: string | null;
  w1_sun_start: string | null;
  w1_sun_end: string | null;
  w2_mon_start: string | null;
  w2_mon_end: string | null;
  w2_tue_start: string | null;
  w2_tue_end: string | null;
  w2_wed_start: string | null;
  w2_wed_end: string | null;
  w2_thu_start: string | null;
  w2_thu_end: string | null;
  w2_fri_start: string | null;
  w2_fri_end: string | null;
  w2_sat_start: string | null;
  w2_sat_end: string | null;
  w2_sun_start: string | null;
  w2_sun_end: string | null;
  w1_mon_req_pause_min: number | null;
  w1_tue_req_pause_min: number | null;
  w1_wed_req_pause_min: number | null;
  w1_thu_req_pause_min: number | null;
  w1_fri_req_pause_min: number | null;
  w1_sat_req_pause_min: number | null;
  w1_sun_req_pause_min: number | null;
  w2_mon_req_pause_min: number | null;
  w2_tue_req_pause_min: number | null;
  w2_wed_req_pause_min: number | null;
  w2_thu_req_pause_min: number | null;
  w2_fri_req_pause_min: number | null;
  w2_sat_req_pause_min: number | null;
  w2_sun_req_pause_min: number | null;
};

type PgShiftPlanRow = {
  employeeId: number;
  twoWeekCycle: string | null;
  W1_mon_start: string | null;
  W1_mon_end: string | null;
  W1_tue_start: string | null;
  W1_tue_end: string | null;
  W1_wed_start: string | null;
  W1_wed_end: string | null;
  W1_thu_start: string | null;
  W1_thu_end: string | null;
  W1_fri_start: string | null;
  W1_fri_end: string | null;
  W1_sat_start: string | null;
  W1_sat_end: string | null;
  W1_sun_start: string | null;
  W1_sun_end: string | null;
  W2_mon_start: string | null;
  W2_mon_end: string | null;
  W2_tue_start: string | null;
  W2_tue_end: string | null;
  W2_wed_start: string | null;
  W2_wed_end: string | null;
  W2_thu_start: string | null;
  W2_thu_end: string | null;
  W2_fri_start: string | null;
  W2_fri_end: string | null;
  W2_sat_start: string | null;
  W2_sat_end: string | null;
  W2_sun_start: string | null;
  W2_sun_end: string | null;
  W1_mon_req_pause_min: number;
  W1_tue_req_pause_min: number;
  W1_wed_req_pause_min: number;
  W1_thu_req_pause_min: number;
  W1_fri_req_pause_min: number;
  W1_sat_req_pause_min: number;
  W1_sun_req_pause_min: number;
  W2_mon_req_pause_min: number;
  W2_tue_req_pause_min: number;
  W2_wed_req_pause_min: number;
  W2_thu_req_pause_min: number;
  W2_fri_req_pause_min: number;
  W2_sat_req_pause_min: number;
  W2_sun_req_pause_min: number;
};

function mapPgShiftPlanRow(row: PgShiftPlanRow): ShiftPlanRow {
  return {
    two_week_cycle: row.twoWeekCycle,
    w1_mon_start: row.W1_mon_start,
    w1_mon_end: row.W1_mon_end,
    w1_tue_start: row.W1_tue_start,
    w1_tue_end: row.W1_tue_end,
    w1_wed_start: row.W1_wed_start,
    w1_wed_end: row.W1_wed_end,
    w1_thu_start: row.W1_thu_start,
    w1_thu_end: row.W1_thu_end,
    w1_fri_start: row.W1_fri_start,
    w1_fri_end: row.W1_fri_end,
    w1_sat_start: row.W1_sat_start,
    w1_sat_end: row.W1_sat_end,
    w1_sun_start: row.W1_sun_start,
    w1_sun_end: row.W1_sun_end,
    w2_mon_start: row.W2_mon_start,
    w2_mon_end: row.W2_mon_end,
    w2_tue_start: row.W2_tue_start,
    w2_tue_end: row.W2_tue_end,
    w2_wed_start: row.W2_wed_start,
    w2_wed_end: row.W2_wed_end,
    w2_thu_start: row.W2_thu_start,
    w2_thu_end: row.W2_thu_end,
    w2_fri_start: row.W2_fri_start,
    w2_fri_end: row.W2_fri_end,
    w2_sat_start: row.W2_sat_start,
    w2_sat_end: row.W2_sat_end,
    w2_sun_start: row.W2_sun_start,
    w2_sun_end: row.W2_sun_end,
    w1_mon_req_pause_min: row.W1_mon_req_pause_min,
    w1_tue_req_pause_min: row.W1_tue_req_pause_min,
    w1_wed_req_pause_min: row.W1_wed_req_pause_min,
    w1_thu_req_pause_min: row.W1_thu_req_pause_min,
    w1_fri_req_pause_min: row.W1_fri_req_pause_min,
    w1_sat_req_pause_min: row.W1_sat_req_pause_min,
    w1_sun_req_pause_min: row.W1_sun_req_pause_min,
    w2_mon_req_pause_min: row.W2_mon_req_pause_min,
    w2_tue_req_pause_min: row.W2_tue_req_pause_min,
    w2_wed_req_pause_min: row.W2_wed_req_pause_min,
    w2_thu_req_pause_min: row.W2_thu_req_pause_min,
    w2_fri_req_pause_min: row.W2_fri_req_pause_min,
    w2_sat_req_pause_min: row.W2_sat_req_pause_min,
    w2_sun_req_pause_min: row.W2_sun_req_pause_min,
  };
}

export async function getShiftPlanRowPg(employeeId: number): Promise<ShiftPlanRow | null> {
  const prisma = getPrisma();
  const row = (await prisma.shiftPlan.findFirst({
    where: { employeeId },
  })) as PgShiftPlanRow | null;
  return row ? mapPgShiftPlanRow(row) : null;
}

export async function listShiftPlanRowsPg(employeeIds: number[]): Promise<Map<number, ShiftPlanRow>> {
  const ids = Array.from(new Set(employeeIds.filter((employeeId) => Number.isInteger(employeeId))));
  if (!ids.length) {
    return new Map();
  }

  const prisma = getPrisma();
  const rows = (await prisma.shiftPlan.findMany({
    where: { employeeId: { in: ids } },
  })) as PgShiftPlanRow[];

  return new Map(rows.map((row) => [row.employeeId, mapPgShiftPlanRow(row)]));
}
