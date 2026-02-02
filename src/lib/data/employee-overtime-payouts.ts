import { getDb } from '@/lib/db';

export interface EmployeeOvertimePayoutRow {
  payoutHours: number;
}

export interface EmployeeOvertimeHistoryEntry {
  year: number;
  month: number;
  payoutHours: number;
}

function ensureTable(): void {
  const db = getDb();
  db.prepare(
    `CREATE TABLE IF NOT EXISTS employee_overtime_payouts (
       employee_id INTEGER NOT NULL,
       year INTEGER NOT NULL,
       month INTEGER NOT NULL,
       payout_hours REAL NOT NULL DEFAULT 0,
       PRIMARY KEY (employee_id, year, month)
     )`
  ).run();
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : (value as number);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function getEmployeeOvertimePayout(
  employeeId: number,
  year: number,
  month: number
): EmployeeOvertimePayoutRow | null {
  ensureTable();
  const db = getDb();
  const row = db
    .prepare<[number, number, number], { payout_hours: number | null }>(
      `SELECT payout_hours
       FROM employee_overtime_payouts
       WHERE employee_id = ? AND year = ? AND month = ?`
    )
    .get(employeeId, year, month);

  if (!row) {
    return null;
  }

  return {
    payoutHours: Number(toNumber(row.payout_hours).toFixed(2)),
  };
}

export function upsertEmployeeOvertimePayout(
  employeeId: number,
  year: number,
  month: number,
  payoutHours: number
): void {
  ensureTable();
  const db = getDb();
  db.prepare(
    `INSERT INTO employee_overtime_payouts (employee_id, year, month, payout_hours)
       VALUES (?, ?, ?, ?)
     ON CONFLICT(employee_id, year, month) DO UPDATE SET
       payout_hours = excluded.payout_hours`
  ).run(employeeId, year, month, payoutHours);
}

export function sumEmployeeOvertimePayoutsUpTo(
  employeeId: number,
  year: number,
  month: number
): number {
  ensureTable();
  const db = getDb();
  const row = db
    .prepare<
      [number, number, number, number],
      { total: number | null }
    >(
      `SELECT SUM(payout_hours) AS total
       FROM employee_overtime_payouts
       WHERE employee_id = ?
         AND (year < ? OR (year = ? AND month <= ?))`
    )
    .get(employeeId, year, year, month);

  return Number(toNumber(row?.total).toFixed(2));
}

export function listEmployeeOvertimeHistory(
  employeeId: number,
  options: { limit?: number } = {}
): EmployeeOvertimeHistoryEntry[] {
  ensureTable();
  const db = getDb();
  const limit = options.limit ?? 120;
  const rows = db
    .prepare<
      [number, number],
      { year: number; month: number; payout_hours: number | null }[]
    >(
      `SELECT year, month, payout_hours
       FROM employee_overtime_payouts
       WHERE employee_id = ?
       ORDER BY year DESC, month DESC
       LIMIT ?`
    )
    .all(employeeId, limit);

  return rows.map((row) => ({
    year: Number(row.year ?? 0),
    month: Number(row.month ?? 0),
    payoutHours: Number(toNumber(row.payout_hours).toFixed(2)),
  }));
}
