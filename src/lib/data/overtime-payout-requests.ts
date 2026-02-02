import { getDb } from '@/lib/db';

export type OvertimePayoutRequestStatus = 'pending' | 'approved' | 'rejected';

export interface OvertimePayoutRequestRow {
  id: number;
  employee_id: number;
  year: number;
  month: number;
  requested_hours: number;
  note: string | null;
  status: OvertimePayoutRequestStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateOvertimePayoutRequestInput {
  employeeId: number;
  year: number;
  month: number;
  hours: number;
  note?: string | null;
}

function ensureTable(): void {
  const db = getDb();
  db.prepare(
    `CREATE TABLE IF NOT EXISTS overtime_payout_requests (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       employee_id INTEGER NOT NULL,
       year INTEGER NOT NULL,
       month INTEGER NOT NULL,
       requested_hours REAL NOT NULL,
       note TEXT,
       status TEXT NOT NULL DEFAULT 'pending',
       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`
  ).run();
}

function mapRow(row: Record<string, unknown>): OvertimePayoutRequestRow {
  return {
    id: Number((row.id as number | string | null | undefined) ?? 0),
    employee_id: Number((row.employee_id as number | string | null | undefined) ?? 0),
    year: Number((row.year as number | string | null | undefined) ?? 0),
    month: Number((row.month as number | string | null | undefined) ?? 0),
    requested_hours: Number((row.requested_hours as number | string | null | undefined) ?? 0),
    note: (row.note as string | null | undefined) ?? null,
    status: ((row.status as string | null | undefined) ?? 'pending') as OvertimePayoutRequestStatus,
    created_at: (row.created_at as string | null | undefined) ?? '',
    updated_at: (row.updated_at as string | null | undefined) ?? '',
  };
}

export function createOvertimePayoutRequest(
  input: CreateOvertimePayoutRequestInput
): number {
  ensureTable();
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO overtime_payout_requests (employee_id, year, month, requested_hours, note)
     VALUES (?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.employeeId,
    input.year,
    input.month,
    input.hours,
    input.note ?? null
  );
  return Number(result.lastInsertRowid ?? 0);
}

export function listOvertimePayoutRequests(
  employeeId: number,
  year: number,
  month: number,
  limit = 5
): OvertimePayoutRequestRow[] {
  ensureTable();
  const db = getDb();
  const stmt = db.prepare(
    `SELECT id, employee_id, year, month, requested_hours, note, status, created_at, updated_at
     FROM overtime_payout_requests
     WHERE employee_id = ? AND year = ? AND month = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`
  );
  const rows = stmt.all(employeeId, year, month, limit) as Record<string, unknown>[];
  return rows.map(mapRow);
}
