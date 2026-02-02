import { getDb } from '@/lib/db';

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

function ensureTable(): void {
  const db = getDb();
  db.prepare(
    `CREATE TABLE IF NOT EXISTS employee_bonus (
       employee_id INTEGER NOT NULL,
       year INTEGER NOT NULL,
       month INTEGER NOT NULL,
       auszahlung REAL DEFAULT 0,
       uebertrag REAL DEFAULT 0,
       PRIMARY KEY (employee_id, year, month)
     )`
  ).run();
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : (value as number);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function getEmployeeBonusEntry(employeeId: number, year: number, month: number): EmployeeBonusRow | null {
  ensureTable();
  const db = getDb();
  const row = db
    .prepare<
      [number, number, number],
      { auszahlung: number | null; uebertrag: number | null }
    >(
      `SELECT auszahlung, uebertrag
       FROM employee_bonus
       WHERE employee_id = ? AND year = ? AND month = ?`
    )
    .get(employeeId, year, month);

  if (!row) {
    return null;
  }

  return {
    payout: Number(toNumber(row.auszahlung).toFixed(2)),
    carryOver: Number(toNumber(row.uebertrag).toFixed(2)),
  };
}

export function upsertEmployeeBonusEntry(
  employeeId: number,
  year: number,
  month: number,
  payout: number,
  carryOver: number
): void {
  ensureTable();
  const db = getDb();
  db.prepare(
    `INSERT INTO employee_bonus (employee_id, year, month, auszahlung, uebertrag)
       VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(employee_id, year, month) DO UPDATE SET
       auszahlung = excluded.auszahlung,
       uebertrag = excluded.uebertrag`
  ).run(employeeId, year, month, payout, carryOver);
}

export function getPreviousEmployeeBonusEntry(
  employeeId: number,
  year: number,
  month: number
): EmployeeBonusRow | null {
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

export function listEmployeeBonusHistory(
  employeeId: number,
  options: { limit?: number } = {}
): EmployeeBonusHistoryEntry[] {
  ensureTable();
  const db = getDb();
  const limit = options.limit ?? 120;
  const rows = db
    .prepare<
      [number, number],
      { year: number; month: number; auszahlung: number | null; uebertrag: number | null }[]
    >(
      `SELECT year, month, auszahlung, uebertrag
       FROM employee_bonus
       WHERE employee_id = ?
       ORDER BY year DESC, month DESC
       LIMIT ?`
    )
    .all(employeeId, limit);

  return rows.map((row) => ({
    year: Number(row.year ?? 0),
    month: Number(row.month ?? 0),
    payout: Number(toNumber(row.auszahlung).toFixed(2)),
    carryOver: Number(toNumber(row.uebertrag).toFixed(2)),
  }));
}
