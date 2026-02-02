import { revalidatePath } from 'next/cache';

import {
  countPendingLeaveRequests as countPendingLeaveRequestsRows,
  createLeaveRequest,
  getLeaveRequestById,
  listLeaveRequests,
  listLeaveRequestsForEmployee,
  markLeaveRequestCancellationRequested,
  markLeaveRequestShiftPlanApplied,
  clearLeaveRequestCancellation,
  cancelLeaveRequestRecord,
  type LeaveRequestRow,
  type LeaveRequestStatus,
  type LeaveRequestType,
  updateLeaveRequestStatus,
} from '@/lib/data/leave-requests';
import { getEmployeeById } from '@/lib/data/employees';
import { saveShiftPlanDay } from '@/lib/services/shift-plan';

const TYPE_LABEL: Record<LeaveRequestType, string> = {
  vacation: 'Urlaub',
  overtime: 'Überstundenabbau',
};

type NormalizedDateRange = {
  startIso: string;
  endIso: string;
  totalDays: number;
};

export type LeaveRequestView = {
  id: number;
  employeeId: number;
  employeeName: string | null;
  type: LeaveRequestType;
  typeLabel: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  totalDays: number;
  reason: string | null;
  status: LeaveRequestStatus;
  statusLabel: string;
  adminNote: string | null;
  decidedAt: string | null;
  cancellationRequested: boolean;
  cancellationRequestedAt: string | null;
  cancellationNote: string | null;
  cancelledAt: string | null;
  appliedToShiftPlan: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SubmitLeaveRequestInput = {
  employeeId: number;
  type: LeaveRequestType;
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  reason?: string | null;
};

export type DecideLeaveRequestInput = {
  requestId: number;
  status: Exclude<LeaveRequestStatus, 'pending'>;
  adminId: number;
  adminNote?: string | null;
};

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

function normalizeRange(startRaw: string, endRaw: string): NormalizedDateRange {
  const start = parseIsoDate(startRaw);
  const end = parseIsoDate(endRaw);
  if (!start || !end) {
    throw new Error('Bitte gültige Datumswerte im Format JJJJ-MM-TT wählen.');
  }
  const startTime = start.getTime();
  const endTime = end.getTime();
  const [from, to] = startTime <= endTime ? [start, end] : [end, start];

  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((to.getTime() - from.getTime()) / msPerDay) + 1;

  if (diffDays < 1) {
    throw new Error('Der Zeitraum muss mindestens einen Tag umfassen.');
  }
  if (diffDays > 31) {
    throw new Error('Zeiträume über 31 Tage müssen separat mit der Verwaltung abgestimmt werden.');
  }

  return {
    startIso: toIsoDate(from),
    endIso: toIsoDate(to),
    totalDays: diffDays,
  };
}

function mapRowToView(row: LeaveRequestRow, employeeName?: string | null): LeaveRequestView {
  const range = normalizeRange(row.start_date, row.end_date);
  const sanitizeTime = (value: string | null | undefined): string | null => {
    if (!value) return null;
    if (/^\d{1,2}:\d{2}$/.test(value)) {
      return value.padStart(5, '0');
    }
    return null;
  };
  let statusLabel: string;
  if (row.status === 'pending') {
    statusLabel = 'Offen';
  } else if (row.status === 'approved') {
    statusLabel = row.cancellation_requested ? 'Storno angefragt' : 'Genehmigt';
  } else {
    statusLabel = row.cancelled_at ? 'Storniert' : 'Abgelehnt';
  }
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: employeeName ?? null,
    type: row.type,
    typeLabel: TYPE_LABEL[row.type] ?? row.type,
    startDate: range.startIso,
    endDate: range.endIso,
    startTime: sanitizeTime(row.start_time),
    endTime: sanitizeTime(row.end_time),
    totalDays: range.totalDays,
    reason: row.reason,
    status: row.status,
    statusLabel,
    adminNote: row.admin_note,
    decidedAt: row.decided_at,
    cancellationRequested: row.cancellation_requested === 1,
    cancellationRequestedAt: row.cancellation_requested_at,
    cancellationNote: row.cancellation_note,
    cancelledAt: row.cancelled_at,
    appliedToShiftPlan: row.applied_to_shift_plan === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

async function applyApprovedRequestToShiftPlan(tenantId: string, row: LeaveRequestRow): Promise<void> {
  const label = row.type === 'vacation' ? 'Urlaub' : 'Überstundenabbau';
  const sanitizeTime = (value: string | null | undefined): string | null => {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
      return trimmed.padStart(5, '0');
    }
    return trimmed;
  };
  const normalizedStart = sanitizeTime(row.start_time);
  const normalizedEnd = sanitizeTime(row.end_time);
  const dates = enumerateDates(row.start_date, row.end_date);
  for (const isoDate of dates) {
    await saveShiftPlanDay(tenantId, row.employee_id, {
      isoDate,
      start: row.type === 'overtime' ? normalizedStart : null,
      end: row.type === 'overtime' ? normalizedEnd : null,
      requiredPauseMinutes: 0,
      label,
    });
  }
  await markLeaveRequestShiftPlanApplied(tenantId, row.id, true);
  revalidatePath('/mitarbeiter/schichtplan');
}

async function removeApprovedRequestFromShiftPlan(tenantId: string, row: LeaveRequestRow): Promise<void> {
  if (row.applied_to_shift_plan !== 1) {
    return;
  }
  const dates = enumerateDates(row.start_date, row.end_date);
  for (const isoDate of dates) {
    await saveShiftPlanDay(tenantId, row.employee_id, {
      isoDate,
      start: null,
      end: null,
      requiredPauseMinutes: 0,
      label: null,
    });
  }
  await markLeaveRequestShiftPlanApplied(tenantId, row.id, false);
  revalidatePath('/mitarbeiter/schichtplan');
}

export async function submitLeaveRequest(tenantId: string, input: SubmitLeaveRequestInput): Promise<LeaveRequestView> {
  const { employeeId, type } = input;
  if (!employeeId || !Number.isFinite(employeeId)) {
    throw new Error('Ungültige Mitarbeiterkennung.');
  }
  if (type !== 'vacation' && type !== 'overtime') {
    throw new Error('Unbekannter Antragstyp.');
  }

  const range = normalizeRange(input.startDate, input.endDate);

  const sanitizeTime = (value: string | null | undefined): string | null => {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
      return trimmed.padStart(5, '0');
    }
    return null;
  };

  const startTime = sanitizeTime(input.startTime);
  const endTime = sanitizeTime(input.endTime);

  if (type === 'overtime') {
    if (!startTime || !endTime) {
      throw new Error('Bitte Start- und Endzeit für den Überstundenabbau angeben.');
    }
  }

  const reason = input.reason?.trim() ?? null;
  if (reason && reason.length > 500) {
    throw new Error('Die Begründung darf maximal 500 Zeichen enthalten.');
  }

  const employee = await getEmployeeById(tenantId, employeeId);
  if (!employee) {
    throw new Error('Mitarbeiter wurde nicht gefunden.');
  }

  const id = await createLeaveRequest({
    employeeId,
    type,
    startDate: range.startIso,
    endDate: range.endIso,
    startTime: type === 'overtime' ? startTime : null,
    endTime: type === 'overtime' ? endTime : null,
    reason,
  });
  const row = await getLeaveRequestById(tenantId, id);
  if (!row) {
    throw new Error('Der Antrag konnte nicht gespeichert werden.');
  }
  return mapRowToView(row, `${employee.first_name} ${employee.last_name}`.trim());
}

export async function getLeaveRequestsForEmployee(
  tenantId: string,
  employeeId: number
): Promise<LeaveRequestView[]> {
  const rows = await listLeaveRequestsForEmployee(tenantId, employeeId);
  return rows.map((row) => mapRowToView(row));
}

export async function getLeaveRequestsForAdmin(
  tenantId: string,
  status: LeaveRequestStatus | 'all' = 'all'
): Promise<LeaveRequestView[]> {
  const rows = await listLeaveRequests(tenantId, status);
  const uniqueEmployeeIds = Array.from(new Set(rows.map((row) => row.employee_id)));
  const employeeNameMap = new Map<number, string>();
  for (const id of uniqueEmployeeIds) {
    const employee = await getEmployeeById(tenantId, id);
    if (employee) {
      employeeNameMap.set(id, `${employee.first_name} ${employee.last_name}`.trim());
    }
  }
  return rows.map((row) => mapRowToView(row, employeeNameMap.get(row.employee_id) ?? null));
}

export async function decideLeaveRequest(
  tenantId: string,
  input: DecideLeaveRequestInput
): Promise<LeaveRequestView> {
  const row = await getLeaveRequestById(tenantId, input.requestId);
  if (!row) {
    throw new Error('Der Antrag wurde nicht gefunden.');
  }
  if (row.status !== 'pending') {
    throw new Error('Nur offene Anträge können bearbeitet werden.');
  }

  await updateLeaveRequestStatus(tenantId, {
    id: row.id,
    status: input.status,
    adminNote: input.adminNote?.trim() ?? null,
    decidedBy: input.adminId,
  });

  if (input.status === 'approved') {
    await applyApprovedRequestToShiftPlan(tenantId, row);
  } else {
    revalidatePath('/mitarbeiter/schichtplan');
  }

  revalidatePath('/mitarbeiter/antraege');
  revalidatePath('/admin/antraege');

  const updated = await getLeaveRequestById(tenantId, row.id);
  const employee = await getEmployeeById(tenantId, row.employee_id);
  return mapRowToView(updated ?? row, employee ? `${employee.first_name} ${employee.last_name}`.trim() : null);
}

export async function countPendingLeaveRequests(tenantId: string): Promise<number> {
  return countPendingLeaveRequestsRows(tenantId);
}

export async function cancelLeaveRequestAsEmployee(
  tenantId: string,
  input: {
  employeeId: number;
  requestId: number;
  mode: 'cancel_pending' | 'request_cancellation';
  message?: string | null;
}): Promise<'cancelled' | 'requested'> {
  const row = await getLeaveRequestById(tenantId, input.requestId);
  if (!row || row.employee_id !== input.employeeId) {
    throw new Error('Antrag wurde nicht gefunden.');
  }

  const note = (input.message ?? '').trim() || null;

  if (row.status === 'pending') {
    if (input.mode !== 'cancel_pending') {
      throw new Error('Dieser Antrag ist noch nicht genehmigt.');
    }
    await cancelLeaveRequestRecord(tenantId, {
      id: row.id,
      cancellationNote: note,
      decidedBy: null,
    });
    revalidatePath('/mitarbeiter/antraege');
    revalidatePath('/admin/antraege');
    return 'cancelled';
  }

  if (row.status === 'approved') {
    if (input.mode !== 'request_cancellation') {
      throw new Error('Der Antrag ist bereits genehmigt.');
    }
    if (row.cancellation_requested === 1) {
      throw new Error('Eine Stornierung wurde bereits angefragt.');
    }
    await markLeaveRequestCancellationRequested(tenantId, row.id, note);
    revalidatePath('/mitarbeiter/antraege');
    revalidatePath('/admin/antraege');
    return 'requested';
  }

  if (row.cancelled_at) {
    throw new Error('Der Antrag wurde bereits storniert.');
  }

  throw new Error('Der Antrag befindet sich nicht in einem stornierbaren Status.');
}

export async function adminConfirmCancellation(
  tenantId: string,
  input: {
  requestId: number;
  adminId: number;
  adminNote?: string | null;
}): Promise<LeaveRequestView> {
  const row = await getLeaveRequestById(tenantId, input.requestId);
  if (!row) {
    throw new Error('Antrag wurde nicht gefunden.');
  }
  if (row.status !== 'approved' || row.cancellation_requested !== 1) {
    throw new Error('Für diesen Antrag liegt keine Stornoanfrage vor.');
  }

  await removeApprovedRequestFromShiftPlan(tenantId, row);
  await cancelLeaveRequestRecord(tenantId, {
    id: row.id,
    cancellationNote: row.cancellation_note ?? null,
    adminNote: input.adminNote,
    decidedBy: input.adminId,
    resetApplied: true,
  });

  revalidatePath('/mitarbeiter/antraege');
  revalidatePath('/admin/antraege');

  const updated = await getLeaveRequestById(tenantId, row.id);
  const employee = await getEmployeeById(tenantId, row.employee_id);
  return mapRowToView(updated ?? row, employee ? `${employee.first_name} ${employee.last_name}`.trim() : null);
}

export async function adminRejectCancellationRequest(
  tenantId: string,
  input: {
  requestId: number;
  adminId: number;
  adminNote?: string | null;
}): Promise<LeaveRequestView> {
  const row = await getLeaveRequestById(tenantId, input.requestId);
  if (!row) {
    throw new Error('Antrag wurde nicht gefunden.');
  }
  if (row.status !== 'approved' || row.cancellation_requested !== 1) {
    throw new Error('Für diesen Antrag liegt keine Stornoanfrage vor.');
  }

  await clearLeaveRequestCancellation(tenantId, row.id);
  await updateLeaveRequestStatus(tenantId, {
    id: row.id,
    status: 'approved',
    adminNote: input.adminNote,
    decidedBy: input.adminId,
  });

  revalidatePath('/mitarbeiter/antraege');
  revalidatePath('/admin/antraege');

  const updated = await getLeaveRequestById(tenantId, row.id);
  const employee = await getEmployeeById(tenantId, row.employee_id);
  return mapRowToView(updated ?? row, employee ? `${employee.first_name} ${employee.last_name}`.trim() : null);
}
