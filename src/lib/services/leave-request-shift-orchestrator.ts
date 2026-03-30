import {
  getLeaveRequestById,
  type LeaveRequestRow,
} from '@/lib/data/leave-requests';
import { applyApprovedRequestToShiftPlanWorkflow } from '@/lib/services/leave-request-shift-apply';
import { removeApprovedRequestFromShiftPlanWorkflow } from '@/lib/services/leave-request-shift-undo';

function parseIsoDate(raw: string): Date | null {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null;
  }
  const [year, month, day] = raw.split('-').map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function toIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function enumerateDates(startIso: string, endIso: string): string[] {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  if (!start || !end) {
    return [];
  }
  const dates: string[] = [];
  for (
    let cursor = new Date(start);
    cursor.getTime() <= end.getTime();
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    dates.push(toIsoDate(cursor));
  }
  return dates;
}

export async function applyApprovedRequestToShiftPlan(tenantId: string, row: LeaveRequestRow): Promise<void> {
  const latestRow = await getLeaveRequestById(tenantId, row.id);
  if (!latestRow) {
    return;
  }
  if (latestRow.applied_to_shift_plan === 1) {
    return;
  }

  await applyApprovedRequestToShiftPlanWorkflow(
    tenantId,
    latestRow,
    enumerateDates(latestRow.start_date, latestRow.end_date),
  );
}

export async function removeApprovedRequestFromShiftPlan(tenantId: string, row: LeaveRequestRow): Promise<void> {
  if (row.applied_to_shift_plan !== 1) {
    return;
  }

  await removeApprovedRequestFromShiftPlanWorkflow(
    tenantId,
    row,
    enumerateDates(row.start_date, row.end_date),
  );
}
