import {
  getMonthlyClosing,
  listMonthlyClosings,
  listMonthlyClosingsForPeriod,
  upsertMonthlyClosingStatus,
  type MonthlyClosingRow,
} from '@/lib/data/monthly-closings';

export interface MonthlyClosingState {
  status: 'open' | 'closed';
  closedAt: string | null;
  closedBy: string | null;
}

export type MonthlyClosingHistoryItem = MonthlyClosingRow;

export function assertMonthlyClosingAllowed(year: number, month: number, now = new Date()): void {
  // Timesheet months are treated as calendar months. We must never allow closing a month
  // too early. The current month may be closed starting on the *last day of that month*
  // (e.g. February 2026 is closable on 28.02.2026), but not before.
  // We intentionally use UTC day boundaries to be conservative: this can delay by up to
  // the timezone offset, but it will not allow premature closing.
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('Ungültiger Monat für den Monatsabschluss.');
  }
  const monthEndUtc = new Date(Date.UTC(year, month, 0, 0, 0, 0)); // day 0 = last day of requested month
  const lastDayStartUtc = new Date(Date.UTC(year, month - 1, monthEndUtc.getUTCDate(), 0, 0, 0));
  if (now.getTime() < lastDayStartUtc.getTime()) {
    throw new Error('Dieser Monat ist noch nicht vorbei und kann noch nicht abgeschlossen werden.');
  }
}

export async function getMonthlyClosingState(
  employeeId: number,
  year: number,
  month: number
): Promise<MonthlyClosingState> {
  const record = await getMonthlyClosing(employeeId, year, month);
  if (!record) {
    return {
      status: 'open',
      closedAt: null,
      closedBy: null,
    };
  }

  return {
    status: record.status,
    closedAt: record.closedAt,
    closedBy: record.closedBy,
  };
}

export async function getMonthlyClosingStates(
  employeeIds: number[],
  year: number,
  month: number
): Promise<Map<number, MonthlyClosingState>> {
  const states = new Map<number, MonthlyClosingState>();
  for (const employeeId of employeeIds) {
    states.set(employeeId, {
      status: 'open',
      closedAt: null,
      closedBy: null,
    });
  }

  const rows = await listMonthlyClosingsForPeriod(employeeIds, year, month);
  for (const row of rows) {
    states.set(row.employeeId, {
      status: row.status,
      closedAt: row.closedAt,
      closedBy: row.closedBy,
    });
  }

  return states;
}

export async function closeMonthlyClosing(
  employeeId: number,
  year: number,
  month: number,
  closedBy: string
): Promise<MonthlyClosingState> {
  assertMonthlyClosingAllowed(year, month);
  const timestamp = new Date().toISOString();
  await upsertMonthlyClosingStatus(employeeId, year, month, 'closed', timestamp, closedBy);
  return {
    status: 'closed',
    closedAt: timestamp,
    closedBy,
  };
}

export async function reopenMonthlyClosing(
  employeeId: number,
  year: number,
  month: number
): Promise<MonthlyClosingState> {
  await upsertMonthlyClosingStatus(employeeId, year, month, 'open', null, null);
  return {
    status: 'open',
    closedAt: null,
    closedBy: null,
  };
}

export async function getMonthlyClosingHistory(
  employeeId: number,
  limit = 12
): Promise<MonthlyClosingHistoryItem[]> {
  return listMonthlyClosings(employeeId, limit);
}
