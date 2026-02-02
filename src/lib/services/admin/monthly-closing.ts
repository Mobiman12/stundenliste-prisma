import {
  getMonthlyClosing,
  listMonthlyClosings,
  upsertMonthlyClosingStatus,
  type MonthlyClosingRow,
} from '@/lib/data/monthly-closings';

export interface MonthlyClosingState {
  status: 'open' | 'closed';
  closedAt: string | null;
  closedBy: string | null;
}

export type MonthlyClosingHistoryItem = MonthlyClosingRow;

export function getMonthlyClosingState(employeeId: number, year: number, month: number): MonthlyClosingState {
  const record = getMonthlyClosing(employeeId, year, month);
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

export function closeMonthlyClosing(
  employeeId: number,
  year: number,
  month: number,
  closedBy: string
): MonthlyClosingState {
  const timestamp = new Date().toISOString();
  upsertMonthlyClosingStatus(employeeId, year, month, 'closed', timestamp, closedBy);
  return {
    status: 'closed',
    closedAt: timestamp,
    closedBy,
  };
}

export function reopenMonthlyClosing(employeeId: number, year: number, month: number): MonthlyClosingState {
  upsertMonthlyClosingStatus(employeeId, year, month, 'open', null, null);
  return {
    status: 'open',
    closedAt: null,
    closedBy: null,
  };
}

export function getMonthlyClosingHistory(employeeId: number, limit = 12): MonthlyClosingHistoryItem[] {
  return listMonthlyClosings(employeeId, limit);
}
