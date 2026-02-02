import { getDb } from '@/lib/db';

export type MonthlyClosingStatus = 'open' | 'closed';

export interface MonthlyClosingRow {
  id: number | null;
  employeeId: number;
  year: number;
  month: number;
  status: MonthlyClosingStatus;
  closedAt: string | null;
  closedBy: string | null;
}

function mapRow(row: Record<string, unknown> | undefined): MonthlyClosingRow | null {
  if (!row) {
    return null;
  }

  const rawStatus = typeof row.status === 'string' ? row.status.toLowerCase() : 'open';
  const normalisedStatus: MonthlyClosingStatus = rawStatus === 'closed' ? 'closed' : 'open';

  return {
    id: row.id !== undefined && row.id !== null ? Number(row.id) : null,
    employeeId: Number(row.employee_id),
    year: Number(row.year),
    month: Number(row.month),
    status: normalisedStatus,
    closedAt: (row.closed_at as string) ?? null,
    closedBy: (row.closed_by as string) ?? null,
  };
}

export function getMonthlyClosing(employeeId: number, year: number, month: number): MonthlyClosingRow | null {
  const db = getDb();
  const row = db
    .prepare<
      [number, number, number],
      {
        id: number;
        employee_id: number;
        year: number;
        month: number;
        status: string;
        closed_at: string | null;
        closed_by: string | null;
      }
    >(
      `SELECT id, employee_id, year, month, status, closed_at, closed_by
       FROM monthly_closings
       WHERE employee_id = ? AND year = ? AND month = ?`
    )
    .get(employeeId, year, month);

  return mapRow(row);
}

export function upsertMonthlyClosingStatus(
  employeeId: number,
  year: number,
  month: number,
  status: MonthlyClosingStatus,
  closedAt: string | null,
  closedBy: string | null
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO monthly_closings (employee_id, year, month, status, closed_at, closed_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(employee_id, year, month) DO UPDATE SET
       status = excluded.status,
       closed_at = excluded.closed_at,
       closed_by = excluded.closed_by`
  ).run(employeeId, year, month, status, closedAt, closedBy);
}

export function listMonthlyClosings(employeeId: number, limit = 12): MonthlyClosingRow[] {
  const db = getDb();
  const rows = db
    .prepare<
      [number, number],
      {
        id: number;
        employee_id: number;
        year: number;
        month: number;
        status: string;
        closed_at: string | null;
        closed_by: string | null;
      }
    >(
      `SELECT id, employee_id, year, month, status, closed_at, closed_by
       FROM monthly_closings
       WHERE employee_id = ?
       ORDER BY year DESC, month DESC
       LIMIT ?`
    )
    .all(employeeId, limit);

  return rows.map((row) => mapRow(row)!).filter((row): row is MonthlyClosingRow => !!row);
}

export function listClosingYears(): number[] {
  const db = getDb();
  const rows = db
    .prepare<[], { year: number }>('SELECT DISTINCT year FROM monthly_closings ORDER BY year DESC')
    .all();

  const years = rows.map((row) => Number(row.year)).filter((year) => Number.isFinite(year));
  if (!years.length) {
    const now = new Date();
    return [now.getFullYear()];
  }

  return years;
}
