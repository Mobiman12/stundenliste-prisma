import { getDb } from '@/lib/db';

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

export function getShiftPlanRow(employeeId: number): ShiftPlanRow | null {
  const db = getDb();
  const stmt = db.prepare<
    [number],
    ShiftPlanRow
  >(
    `SELECT
      two_week_cycle,
      W1_mon_start AS w1_mon_start,
      W1_mon_end AS w1_mon_end,
      W1_tue_start AS w1_tue_start,
      W1_tue_end AS w1_tue_end,
      W1_wed_start AS w1_wed_start,
      W1_wed_end AS w1_wed_end,
      W1_thu_start AS w1_thu_start,
      W1_thu_end AS w1_thu_end,
      W1_fri_start AS w1_fri_start,
      W1_fri_end AS w1_fri_end,
      W1_sat_start AS w1_sat_start,
      W1_sat_end AS w1_sat_end,
      W1_sun_start AS w1_sun_start,
      W1_sun_end AS w1_sun_end,
      W2_mon_start AS w2_mon_start,
      W2_mon_end AS w2_mon_end,
      W2_tue_start AS w2_tue_start,
      W2_tue_end AS w2_tue_end,
      W2_wed_start AS w2_wed_start,
      W2_wed_end AS w2_wed_end,
      W2_thu_start AS w2_thu_start,
      W2_thu_end AS w2_thu_end,
      W2_fri_start AS w2_fri_start,
      W2_fri_end AS w2_fri_end,
      W2_sat_start AS w2_sat_start,
      W2_sat_end AS w2_sat_end,
      W2_sun_start AS w2_sun_start,
      W2_sun_end AS w2_sun_end,
      W1_mon_req_pause_min AS w1_mon_req_pause_min,
      W1_tue_req_pause_min AS w1_tue_req_pause_min,
      W1_wed_req_pause_min AS w1_wed_req_pause_min,
      W1_thu_req_pause_min AS w1_thu_req_pause_min,
      W1_fri_req_pause_min AS w1_fri_req_pause_min,
      W1_sat_req_pause_min AS w1_sat_req_pause_min,
      W1_sun_req_pause_min AS w1_sun_req_pause_min,
      W2_mon_req_pause_min AS w2_mon_req_pause_min,
      W2_tue_req_pause_min AS w2_tue_req_pause_min,
      W2_wed_req_pause_min AS w2_wed_req_pause_min,
      W2_thu_req_pause_min AS w2_thu_req_pause_min,
      W2_fri_req_pause_min AS w2_fri_req_pause_min,
      W2_sat_req_pause_min AS w2_sat_req_pause_min,
      W2_sun_req_pause_min AS w2_sun_req_pause_min
    FROM shift_plans
    WHERE employee_id = ?
    LIMIT 1`
  );

  const row = stmt.get(employeeId);
  return row ?? null;
}

export type ShiftPlanWriteDay = {
  start: string | null;
  end: string | null;
  requiredPauseMinutes: number;
};

export type ShiftPlanWriteInput = {
  employeeId: number;
  twoWeekCycle: boolean;
  week1: Record<ShiftPlanDayKey, ShiftPlanWriteDay>;
  week2: Record<ShiftPlanDayKey, ShiftPlanWriteDay>;
};

function sanitizeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function sanitizePause(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }

  const numeric =
    typeof value === 'number'
      ? value
      : Number.parseInt(String(value).trim(), 10);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.round(numeric));
}

export function upsertShiftPlan(input: ShiftPlanWriteInput): void {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM shift_plans WHERE employee_id = ? LIMIT 1')
    .get(input.employeeId) as { id: number } | undefined;

  const cycleValue = input.twoWeekCycle ? 'yes' : 'no';

  const timesForWeek = (week: Record<ShiftPlanDayKey, ShiftPlanWriteDay>) => {
    const values: (string | null)[] = [];
    for (const day of SHIFT_PLAN_DAY_KEYS) {
      const entry = week[day] ?? { start: null, end: null, requiredPauseMinutes: 0 };
      values.push(sanitizeTime(entry.start));
      values.push(sanitizeTime(entry.end));
    }
    return values;
  };

  const pausesForWeek = (week: Record<ShiftPlanDayKey, ShiftPlanWriteDay>) => {
    const values: number[] = [];
    for (const day of SHIFT_PLAN_DAY_KEYS) {
      const entry = week[day] ?? { start: null, end: null, requiredPauseMinutes: 0 };
      values.push(sanitizePause(entry.requiredPauseMinutes));
    }
    return values;
  };

  const params = [
    input.employeeId,
    cycleValue,
    ...timesForWeek(input.week1),
    ...timesForWeek(input.week2),
    ...pausesForWeek(input.week1),
    ...pausesForWeek(input.week2),
  ];

  if (!existing) {
    const insertSql = `
      INSERT INTO shift_plans (
        employee_id, two_week_cycle,
        W1_mon_start, W1_mon_end, W1_tue_start, W1_tue_end,
        W1_wed_start, W1_wed_end, W1_thu_start, W1_thu_end,
        W1_fri_start, W1_fri_end, W1_sat_start, W1_sat_end,
        W1_sun_start, W1_sun_end,
        W2_mon_start, W2_mon_end, W2_tue_start, W2_tue_end,
        W2_wed_start, W2_wed_end, W2_thu_start, W2_thu_end,
        W2_fri_start, W2_fri_end, W2_sat_start, W2_sat_end,
        W2_sun_start, W2_sun_end,
        W1_mon_req_pause_min, W1_tue_req_pause_min, W1_wed_req_pause_min,
        W1_thu_req_pause_min, W1_fri_req_pause_min, W1_sat_req_pause_min, W1_sun_req_pause_min,
        W2_mon_req_pause_min, W2_tue_req_pause_min, W2_wed_req_pause_min,
        W2_thu_req_pause_min, W2_fri_req_pause_min, W2_sat_req_pause_min, W2_sun_req_pause_min
      ) VALUES (
        ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
      )
    `;
    db.prepare(insertSql).run(...params);
  } else {
    const updateSql = `
      UPDATE shift_plans SET
        two_week_cycle = ?,
        W1_mon_start = ?, W1_mon_end = ?,
        W1_tue_start = ?, W1_tue_end = ?,
        W1_wed_start = ?, W1_wed_end = ?,
        W1_thu_start = ?, W1_thu_end = ?,
        W1_fri_start = ?, W1_fri_end = ?,
        W1_sat_start = ?, W1_sat_end = ?,
        W1_sun_start = ?, W1_sun_end = ?,
        W2_mon_start = ?, W2_mon_end = ?,
        W2_tue_start = ?, W2_tue_end = ?,
        W2_wed_start = ?, W2_wed_end = ?,
        W2_thu_start = ?, W2_thu_end = ?,
        W2_fri_start = ?, W2_fri_end = ?,
        W2_sat_start = ?, W2_sat_end = ?,
        W2_sun_start = ?, W2_sun_end = ?,
        W1_mon_req_pause_min = ?, W1_tue_req_pause_min = ?, W1_wed_req_pause_min = ?,
        W1_thu_req_pause_min = ?, W1_fri_req_pause_min = ?, W1_sat_req_pause_min = ?, W1_sun_req_pause_min = ?,
        W2_mon_req_pause_min = ?, W2_tue_req_pause_min = ?, W2_wed_req_pause_min = ?,
        W2_thu_req_pause_min = ?, W2_fri_req_pause_min = ?, W2_sat_req_pause_min = ?, W2_sun_req_pause_min = ?
      WHERE employee_id = ?
    `;
    const updateParams = [
      cycleValue,
      ...timesForWeek(input.week1),
      ...timesForWeek(input.week2),
      ...pausesForWeek(input.week1),
      ...pausesForWeek(input.week2),
      input.employeeId,
    ];
    db.prepare(updateSql).run(...updateParams);
  }
}
