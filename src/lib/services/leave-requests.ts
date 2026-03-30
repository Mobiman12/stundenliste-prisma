import { revalidatePath } from 'next/cache';

import {
  countPendingLeaveRequests as countPendingLeaveRequestsRows,
  createLeaveRequest,
  createLeaveRequestWithStatus,
  deleteLeaveRequestById,
  getLeaveRequestById,
  listLeaveRequests,
  listLeaveRequestsForEmployeesInDateRange,
  listLeaveRequestsForDateRange,
  listLeaveRequestsForEmployee,
  listLeaveRequestsForEmployeeInDateRange,
  markLeaveRequestCancellationRequested,
  clearLeaveRequestCancellation,
  cancelLeaveRequestRecord,
  type LeaveRequestRow,
  type LeaveRequestStatus,
  type LeaveRequestType,
  updateLeaveRequestDateRange,
  updateLeaveRequestStatus,
} from '@/lib/data/leave-requests';
import { findActiveVacationLockForEmployee } from '@/lib/data/vacation-locks';
import { fetchStaffShiftPlanSettings } from '@/lib/control-plane';
import {
  getEmployeeById,
  getEmployeeDisplayNamesByIds,
  getEmployeeSelfSummaryData,
} from '@/lib/data/employees';
import { listBranches, listBranchesForEmployee } from '@/lib/data/branches';
import { listShiftPlanDays } from '@/lib/data/shift-plan-days';
import { listDailyDayRecords } from '@/lib/data/daily-days';
import { isHolidayIsoDate, normalizeHolidayRegion } from '@/lib/services/holidays';
import { computeVacationBalance } from '@/lib/services/vacation-balance';
import { sendTextMail } from '@/lib/services/email';
import {
  applyApprovedRequestToShiftPlan,
  removeApprovedRequestFromShiftPlan,
} from '@/lib/services/leave-request-shift-orchestrator';

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
  cancellationRejected: boolean;
  cancellationRequestedAt: string | null;
  cancellationNote: string | null;
  cancelledAt: string | null;
  appliedToShiftPlan: boolean;
  isUnpaid: boolean;
  unpaidDays: number;
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
  allowUnpaid?: boolean;
};

export type DecideLeaveRequestInput = {
  requestId: number;
  status: Exclude<LeaveRequestStatus, 'pending'>;
  adminId: number;
  adminNote?: string | null;
};

export type DecideLeaveRequestRangeInput = {
  requestId: number;
  status: Exclude<LeaveRequestStatus, 'pending'>;
  adminId: number;
  rangeStart: string;
  rangeEnd: string;
  adminNote?: string | null;
};

export const UNPAID_CONFIRMATION_REQUIRED = 'UNPAID_CONFIRM_REQUIRED';

type UnpaidConfirmationPayload = {
  requestedDays: number;
  availableDays: number;
  unpaidDays: number;
};

function buildUnpaidConfirmationError(payload: UnpaidConfirmationPayload): Error {
  const requestedDays = Number(payload.requestedDays.toFixed(2));
  const availableDays = Number(payload.availableDays.toFixed(2));
  const unpaidDays = Number(payload.unpaidDays.toFixed(2));
  return new Error(
    `${UNPAID_CONFIRMATION_REQUIRED}|requested=${requestedDays}|available=${availableDays}|unpaid=${unpaidDays}`
  );
}

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
  const cancellationRejected =
    row.status === 'approved' &&
    row.cancellation_requested === 0 &&
    !row.cancelled_at &&
    Boolean(row.cancellation_requested_at);
  let statusLabel: string;
  if (row.status === 'pending') {
    statusLabel = 'Offen';
  } else if (row.status === 'approved') {
    statusLabel = row.cancellation_requested
      ? 'Storno angefragt'
      : cancellationRejected
      ? 'Stornierung abgelehnt'
      : 'Genehmigt';
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
    cancellationRejected,
    cancellationRequestedAt: row.cancellation_requested_at,
    cancellationNote: row.cancellation_note,
    cancelledAt: row.cancelled_at,
    appliedToShiftPlan: row.applied_to_shift_plan === 1,
    isUnpaid: row.is_unpaid === 1,
    unpaidDays: Number((row.unpaid_days ?? 0).toFixed(2)),
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

function weekdayIndexFromIso(isoDate: string): number {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) return 0;
  return (parsed.getUTCDay() + 6) % 7;
}

type VacationComputationContext = {
  holidayDates: Set<string>;
  shiftPlanEnabled: boolean;
  shiftPlanWorkDates: Set<string>;
  openingWeekdays: Set<number>;
};

async function buildVacationComputationContext(
  tenantId: string,
  employee: Awaited<ReturnType<typeof getEmployeeById>>,
  employeeId: number,
  startIso: string,
  endIso: string,
): Promise<VacationComputationContext> {
  const holidayDates = new Set<string>();
  const employeeBranches = await listBranchesForEmployee(tenantId, employeeId);
  const allBranches = await listBranches(tenantId);
  const branchById = new Map(allBranches.map((branch) => [branch.id, branch]));
  const assignedBranches = employeeBranches
    .map((item) => branchById.get(item.id))
    .filter((branch): branch is NonNullable<(typeof allBranches)[number]> => Boolean(branch));

  const holidayRegion =
    normalizeHolidayRegion(
      assignedBranches[0]?.federalState ?? assignedBranches[0]?.country ?? employee?.federal_state ?? null,
    ) ?? null;
  if (holidayRegion) {
    for (const isoDate of enumerateDates(startIso, endIso)) {
      if (isHolidayIsoDate(isoDate, holidayRegion).isHoliday) {
        holidayDates.add(isoDate);
      }
    }
  }

  let shiftPlanEnabled = false;
  if (employee) {
    try {
      const staffId = employee.control_plane_staff_id ?? employee.personnel_number ?? null;
      const settings = await fetchStaffShiftPlanSettings({
        tenantId,
        staffId,
        email: employee.email ?? employee.username ?? null,
        firstName: employee.first_name ?? null,
        lastName: employee.last_name ?? null,
        displayName: `${employee.first_name ?? ''} ${employee.last_name ?? ''}`.trim() || null,
      });
      shiftPlanEnabled = settings.allowEmployeeSelfPlan === true;
    } catch {
      shiftPlanEnabled = false;
    }
  }

  const shiftPlanWorkDates = new Set<string>();
  const shiftPlanDays = await listShiftPlanDays(employeeId, startIso, endIso);
  for (const day of shiftPlanDays) {
    const hasWorkingTime = Boolean(day.start_time && day.end_time);
    if (day.mode === 'available' && hasWorkingTime) {
      shiftPlanWorkDates.add(day.day_date);
    }
  }
  if (!shiftPlanEnabled && shiftPlanWorkDates.size > 0) {
    // Fallback: if module flag is not readable but concrete shift data exists, treat shift plan as active.
    shiftPlanEnabled = true;
  }

  const openingWeekdays = new Set<number>();
  if (!shiftPlanEnabled) {
    for (const branch of assignedBranches) {
      for (const segment of branch.schedule ?? []) {
        if (!segment.isActive) continue;
        const weekday = String(segment.weekday ?? '').toUpperCase();
        const index =
          weekday === 'MONDAY'
            ? 0
            : weekday === 'TUESDAY'
            ? 1
            : weekday === 'WEDNESDAY'
            ? 2
            : weekday === 'THURSDAY'
            ? 3
            : weekday === 'FRIDAY'
            ? 4
            : weekday === 'SATURDAY'
            ? 5
            : weekday === 'SUNDAY'
            ? 6
            : -1;
        if (index >= 0) {
          openingWeekdays.add(index);
        }
      }
    }
  }

  return {
    holidayDates,
    shiftPlanEnabled,
    shiftPlanWorkDates,
    openingWeekdays,
  };
}

function computeChargeableVacationDates(
  startIso: string,
  endIso: string,
  context: VacationComputationContext,
): string[] {
  const result: string[] = [];
  const allDates = enumerateDates(startIso, endIso);
  const useShiftPlanDates = context.shiftPlanEnabled && context.shiftPlanWorkDates.size > 0;
  for (const isoDate of allDates) {
    if (context.holidayDates.has(isoDate)) {
      continue;
    }
    if (useShiftPlanDates) {
      if (context.shiftPlanWorkDates.has(isoDate)) {
        result.push(isoDate);
      }
      continue;
    }
    if (context.openingWeekdays.size > 0) {
      const weekday = weekdayIndexFromIso(isoDate);
      if (context.openingWeekdays.has(weekday)) {
        result.push(isoDate);
      }
      continue;
    }
    result.push(isoDate);
  }
  return result;
}

function formatIsoDateForMail(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function buildRangeLabel(startIso: string, endIso: string): string {
  const start = formatIsoDateForMail(startIso);
  const end = formatIsoDateForMail(endIso);
  return start === end ? start : `${start} bis ${end}`;
}

type LeaveDecisionMailType =
  | 'approved'
  | 'rejected'
  | 'cancellation_approved'
  | 'cancellation_rejected';

const TENANT_MAIL_CONTEXT_CACHE = new Map<string, string>();

async function getTenantMailDisplayName(tenantId: string): Promise<string> {
  const cached = TENANT_MAIL_CONTEXT_CACHE.get(tenantId);
  if (cached) return cached;

  const fallback = process.env.TENANT_NAME?.trim() || 'Timevex';
  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  if (!baseUrl) {
    TENANT_MAIL_CONTEXT_CACHE.set(tenantId, fallback);
    return fallback;
  }

  try {
    const url = new URL('/api/internal/tenant/info', baseUrl);
    url.searchParams.set('tenantId', tenantId);
    const secret = process.env.PROVISION_SECRET?.trim();
    const response = await fetch(url.toString(), {
      headers: secret ? { 'x-provision-secret': secret } : undefined,
      cache: 'no-store',
    });
    if (!response.ok) {
      TENANT_MAIL_CONTEXT_CACHE.set(tenantId, fallback);
      return fallback;
    }

    const payload = (await response.json().catch(() => null)) as { tenantName?: string | null } | null;
    const tenantName = payload?.tenantName?.trim() || fallback;
    TENANT_MAIL_CONTEXT_CACHE.set(tenantId, tenantName);
    return tenantName;
  } catch {
    TENANT_MAIL_CONTEXT_CACHE.set(tenantId, fallback);
    return fallback;
  }
}

async function notifyEmployeeAboutLeaveDecision(
  tenantId: string,
  row: LeaveRequestRow,
  decision: LeaveDecisionMailType,
  adminNote?: string | null
): Promise<void> {
  const employee = await getEmployeeById(tenantId, row.employee_id);
  const recipient = employee?.email?.trim();
  if (!employee || !recipient) {
    return;
  }
  const companyName = await getTenantMailDisplayName(tenantId);

  const employeeName = `${employee.first_name} ${employee.last_name}`.trim() || 'Mitarbeiter';
  const typeLabel = row.type === 'vacation' ? 'Urlaubsantrag' : 'Antrag auf Überstundenabbau';
  const range = buildRangeLabel(row.start_date, row.end_date);
  const noteLine = adminNote?.trim() ? `\nHinweis der Verwaltung: ${adminNote.trim()}\n` : '\n';

  let subject = `${companyName}: Update zu deinem Antrag`;
  let statusLine = 'Es gibt ein Update zu deinem Antrag.';

  if (decision === 'approved') {
    subject = `${companyName}: Antrag genehmigt`;
    statusLine = 'Dein Antrag wurde genehmigt.';
  } else if (decision === 'rejected') {
    subject = `${companyName}: Antrag abgelehnt`;
    statusLine = 'Dein Antrag wurde abgelehnt.';
  } else if (decision === 'cancellation_approved') {
    subject = `${companyName}: Stornierung bestätigt`;
    statusLine = 'Deine Stornierung wurde bestätigt.';
  } else if (decision === 'cancellation_rejected') {
    subject = `${companyName}: Stornierung abgelehnt`;
    statusLine = 'Deine Stornierungsanfrage wurde abgelehnt.';
  }

  const body = [
    `Hallo ${employeeName},`,
    '',
    statusLine,
    '',
    `Antrag: ${typeLabel}`,
    `Zeitraum: ${range}`,
    noteLine.trimEnd(),
    '',
    'Viele Grüße',
    companyName,
  ]
    .filter((line, index, all) => !(line === '' && all[index - 1] === ''))
    .join('\n');

  try {
    await sendTextMail(recipient, subject, body, { fromName: companyName });
  } catch (error) {
    console.error('[leave-requests] failed to send decision mail', {
      requestId: row.id,
      employeeId: row.employee_id,
      recipient,
      decision,
      error,
    });
  }
}

async function validateVacationRequestAndResolveUnpaid(params: {
  tenantId: string;
  employeeId: number;
  startIso: string;
  endIso: string;
  allowUnpaid: boolean;
  excludeRequestId?: number | null;
}): Promise<{ chargeableDates: string[]; unpaidDays: number }> {
  const employee = await getEmployeeById(params.tenantId, params.employeeId);
  if (!employee) {
    throw new Error('Mitarbeiter wurde nicht gefunden.');
  }
  const context = await buildVacationComputationContext(
    params.tenantId,
    employee,
    params.employeeId,
    params.startIso,
    params.endIso,
  );
  const chargeableDates = computeChargeableVacationDates(params.startIso, params.endIso, context);
  if (!chargeableDates.length) {
    throw new Error('Im gewählten Zeitraum liegen keine abrechenbaren Urlaubstage.');
  }

  const existing = await listLeaveRequestsForEmployeeInDateRange(
    params.tenantId,
    params.employeeId,
    params.startIso,
    params.endIso,
    5000,
  );
  const requestedSet = new Set(chargeableDates);
  for (const row of existing) {
    if (row.type !== 'vacation') continue;
    if (row.status !== 'pending' && row.status !== 'approved') continue;
    if (row.cancelled_at) continue;
    if (params.excludeRequestId && row.id === params.excludeRequestId) continue;
    const existingChargeable = computeChargeableVacationDates(row.start_date, row.end_date, context);
    const overlap = existingChargeable.find((isoDate) => requestedSet.has(isoDate));
    if (overlap) {
      throw new Error(`Für ${overlap} existiert bereits ein Urlaubseintrag für diesen Mitarbeiter.`);
    }
  }

  const years = Array.from(new Set(chargeableDates.map((iso) => Number.parseInt(iso.slice(0, 4), 10)))).sort();
  const minYear = years[0] ?? Number.parseInt(params.startIso.slice(0, 4), 10);
  const maxYear = years[years.length - 1] ?? Number.parseInt(params.endIso.slice(0, 4), 10);
  const yearRequests = await listLeaveRequestsForEmployeeInDateRange(
    params.tenantId,
    params.employeeId,
    `${minYear}-01-01`,
    `${maxYear}-12-31`,
    5000,
  );

  const paidRequestedByYear = new Map<number, number>();
  const approvedPaidByYear = new Map<number, number>();
  const now = new Date();
  const currentYear = now.getFullYear();
  for (const row of yearRequests) {
    if (row.type !== 'vacation') continue;
    if (row.cancelled_at) continue;
    if (params.excludeRequestId && row.id === params.excludeRequestId) continue;
    const requestDates = computeChargeableVacationDates(row.start_date, row.end_date, context);
    if (!requestDates.length) continue;
    if (row.status === 'pending' && row.is_unpaid !== 1) {
      for (const isoDate of requestDates) {
        const year = Number.parseInt(isoDate.slice(0, 4), 10);
        paidRequestedByYear.set(year, Number((paidRequestedByYear.get(year) ?? 0) + 1));
      }
    }
    if (row.status === 'approved' && row.is_unpaid !== 1) {
      for (const isoDate of requestDates) {
        const year = Number.parseInt(isoDate.slice(0, 4), 10);
        const asOfIso =
          year === currentYear
            ? `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
            : `${year}-12-31`;
        if (isoDate > asOfIso) {
          approvedPaidByYear.set(year, Number((approvedPaidByYear.get(year) ?? 0) + 1));
        }
      }
    }
  }

  const employeeSummary = await getEmployeeSelfSummaryData(params.tenantId, params.employeeId);
  const openingAnchorDate = parseIsoDate(
    employeeSummary?.openingEffectiveDate ??
      employeeSummary?.entryDate ??
      employee.entry_date ??
      '',
  );
  const allDailyRecords = await listDailyDayRecords(params.employeeId);
  const requestedByYear = new Map<number, number>();
  for (const isoDate of chargeableDates) {
    const year = Number.parseInt(isoDate.slice(0, 4), 10);
    requestedByYear.set(year, Number((requestedByYear.get(year) ?? 0) + 1));
  }

  let availableTotal = 0;
  let unpaidDays = 0;
  for (const [year, requestedDays] of requestedByYear.entries()) {
    const asOfIso =
      year === currentYear
        ? `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        : `${year}-12-31`;
    const openingTakenDaysForYear =
      openingAnchorDate && openingAnchorDate.getUTCFullYear() === year
        ? Number(employeeSummary?.openingVacationTakenYtd ?? 0)
        : 0;
    const balance = computeVacationBalance({
      annualDays: Number(employeeSummary?.vacationDaysTotal ?? employee.vacation_days_total ?? 0),
      importedCarryDays: Number(employeeSummary?.openingVacationCarryDays ?? 0),
      openingTakenDays: openingTakenDaysForYear,
      entryDate: employeeSummary?.entryDate ?? employee.entry_date ?? null,
      exitDate: employeeSummary?.exitDate ?? employee.exit_date ?? null,
      asOfDate: asOfIso,
      carryExpiryEnabled: Boolean(employeeSummary?.vacationCarryExpiryEnabled ?? false),
      carryExpiryDate: employeeSummary?.vacationCarryExpiryDate ?? null,
      year,
      records: allDailyRecords,
    });
    const pendingPaidDays = Number(paidRequestedByYear.get(year) ?? 0);
    const approvedPaidDays = Number(approvedPaidByYear.get(year) ?? 0);
    const availablePaidDays = Math.max(0, Number(balance.remainingDays) - pendingPaidDays - approvedPaidDays);
    availableTotal += availablePaidDays;
    if (requestedDays > availablePaidDays) {
      unpaidDays += requestedDays - availablePaidDays;
    }
  }

  unpaidDays = Number(unpaidDays.toFixed(2));
  if (unpaidDays > 0 && !params.allowUnpaid) {
    throw buildUnpaidConfirmationError({
      requestedDays: Number(chargeableDates.length.toFixed(2)),
      availableDays: Number(availableTotal.toFixed(2)),
      unpaidDays,
    });
  }

  return { chargeableDates, unpaidDays };
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
  let unpaidDays = 0;
  if (type === 'vacation') {
    const lock = await findActiveVacationLockForEmployee(tenantId, employeeId, range.startIso, range.endIso);
    if (lock) {
      const branchLabel = lock.branch_name ? ` (${lock.branch_name})` : '';
      const reasonLabel = lock.reason?.trim() ? ` Grund: ${lock.reason.trim()}` : '';
      throw new Error(
        `Für diesen Zeitraum besteht eine Urlaubssperre${branchLabel} (${lock.start_date} bis ${lock.end_date}).${reasonLabel}`
      );
    }

    const validation = await validateVacationRequestAndResolveUnpaid({
      tenantId,
      employeeId,
      startIso: range.startIso,
      endIso: range.endIso,
      allowUnpaid: input.allowUnpaid === true,
    });
    unpaidDays = validation.unpaidDays;
  }

  const id = await createLeaveRequest({
    employeeId,
    type,
    startDate: range.startIso,
    endDate: range.endIso,
    startTime: type === 'overtime' ? startTime : null,
    endTime: type === 'overtime' ? endTime : null,
    reason,
    isUnpaid: type === 'vacation' ? unpaidDays > 0 : false,
    unpaidDays: type === 'vacation' ? unpaidDays : 0,
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
  const employeeNameMap = await getEmployeeDisplayNamesByIds(
    tenantId,
    rows.map((row) => row.employee_id)
  );
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
  if (row.status === 'approved' && input.status === 'approved') {
    throw new Error('Der Antrag ist bereits genehmigt.');
  }
  if (row.status === 'rejected' && row.cancelled_at) {
    throw new Error('Stornierte Anträge können nicht erneut genehmigt werden.');
  }
  if (row.status === 'approved' && input.status === 'rejected') {
    throw new Error('Für bereits genehmigte Einträge bitte die Storno-Funktion verwenden.');
  }
  if (input.status === 'approved' && row.type === 'vacation') {
    await validateVacationRequestAndResolveUnpaid({
      tenantId,
      employeeId: row.employee_id,
      startIso: row.start_date,
      endIso: row.end_date,
      // Existing pending requests are already user/admin-decided. Here we only enforce no duplicates.
      allowUnpaid: true,
      excludeRequestId: row.id,
    });
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
  await notifyEmployeeAboutLeaveDecision(tenantId, row, input.status, input.adminNote);

  revalidatePath('/mitarbeiter/antraege');
  revalidatePath('/admin/antraege');

  const updated = await getLeaveRequestById(tenantId, row.id);
  const employee = await getEmployeeById(tenantId, row.employee_id);
  return mapRowToView(updated ?? row, employee ? `${employee.first_name} ${employee.last_name}`.trim() : null);
}

function rangeIncludes(range: NormalizedDateRange, dateIso: string): boolean {
  return dateIso >= range.startIso && dateIso <= range.endIso;
}

function splitBySubset(original: NormalizedDateRange, subset: NormalizedDateRange): Array<{
  startIso: string;
  endIso: string;
  isTarget: boolean;
}> {
  if (!rangeIncludes(original, subset.startIso) || !rangeIncludes(original, subset.endIso)) {
    throw new Error('Der ausgewählte Teilbereich liegt außerhalb des ursprünglichen Antrags.');
  }
  const dates = enumerateDates(original.startIso, original.endIso);
  const chunks: Array<{ startIso: string; endIso: string; isTarget: boolean }> = [];
  let cursorStart: string | null = null;
  let cursorTarget = false;

  for (const isoDate of dates) {
    const isTarget = rangeIncludes(subset, isoDate);
    if (cursorStart === null) {
      cursorStart = isoDate;
      cursorTarget = isTarget;
      continue;
    }
    if (cursorTarget !== isTarget) {
      chunks.push({
        startIso: cursorStart,
        endIso: dates[dates.indexOf(isoDate) - 1] ?? isoDate,
        isTarget: cursorTarget,
      });
      cursorStart = isoDate;
      cursorTarget = isTarget;
    }
  }
  if (cursorStart !== null) {
    chunks.push({
      startIso: cursorStart,
      endIso: dates[dates.length - 1] ?? cursorStart,
      isTarget: cursorTarget,
    });
  }
  return chunks;
}

export async function decideLeaveRequestRange(
  tenantId: string,
  input: DecideLeaveRequestRangeInput
): Promise<LeaveRequestView> {
  const request = await getLeaveRequestById(tenantId, input.requestId);
  if (!request) {
    throw new Error('Der Antrag wurde nicht gefunden.');
  }

  const original = normalizeRange(request.start_date, request.end_date);
  const subset = normalizeRange(input.rangeStart, input.rangeEnd);

  if (original.startIso === subset.startIso && original.endIso === subset.endIso) {
    return decideLeaveRequest(tenantId, {
      requestId: request.id,
      status: input.status,
      adminId: input.adminId,
      adminNote: input.adminNote,
    });
  }

  if (request.status !== 'pending') {
    throw new Error('Teilentscheidungen sind nur bei offenen Anträgen möglich.');
  }

  const chunks = splitBySubset(original, subset);
  const targetChunk = chunks.find((item) => item.isTarget);
  if (!targetChunk) {
    throw new Error('Der gewählte Teilbereich ist ungültig.');
  }

  let targetRequestId = request.id;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) continue;
    if (index === 0) {
      await updateLeaveRequestDateRange(tenantId, {
        id: request.id,
        startDate: chunk.startIso,
        endDate: chunk.endIso,
      });
      if (chunk.isTarget) {
        targetRequestId = request.id;
      }
      continue;
    }

    const id = await createLeaveRequestWithStatus(tenantId, {
      employeeId: request.employee_id,
      type: request.type,
      startDate: chunk.startIso,
      endDate: chunk.endIso,
      startTime: request.start_time,
      endTime: request.end_time,
      reason: request.reason,
      status: 'pending',
      isUnpaid: request.is_unpaid === 1,
      unpaidDays: request.unpaid_days ?? 0,
    });
    if (chunk.isTarget) {
      targetRequestId = id;
    }
  }

  return decideLeaveRequest(tenantId, {
    requestId: targetRequestId,
    status: input.status,
    adminId: input.adminId,
    adminNote: input.adminNote,
  });
}

export async function createManualApprovedVacation(
  tenantId: string,
  input: {
    employeeId: number;
    startDate: string;
    endDate: string;
    adminId: number;
    adminNote?: string | null;
    allowUnpaid?: boolean;
  }
): Promise<LeaveRequestView> {
  const range = normalizeRange(input.startDate, input.endDate);
  const employee = await getEmployeeById(tenantId, input.employeeId);
  if (!employee) {
    throw new Error('Mitarbeiter wurde nicht gefunden.');
  }

  const lock = await findActiveVacationLockForEmployee(tenantId, input.employeeId, range.startIso, range.endIso);
  if (lock) {
    throw new Error('Der Zeitraum ist durch eine Urlaubssperre blockiert.');
  }

  const validation = await validateVacationRequestAndResolveUnpaid({
    tenantId,
    employeeId: input.employeeId,
    startIso: range.startIso,
    endIso: range.endIso,
    allowUnpaid: input.allowUnpaid === true,
  });
  const unpaidDays = validation.unpaidDays;

  const id = await createLeaveRequestWithStatus(tenantId, {
    employeeId: input.employeeId,
    type: 'vacation',
    startDate: range.startIso,
    endDate: range.endIso,
    status: 'approved',
    adminNote: input.adminNote?.trim() || 'Manuell im Urlaubsplan eingetragen.',
    decidedBy: input.adminId,
    decidedAt: new Date().toISOString(),
    appliedToShiftPlan: false,
    isUnpaid: unpaidDays > 0,
    unpaidDays,
  });
  const row = await getLeaveRequestById(tenantId, id);
  if (!row) {
    throw new Error('Urlaubseintrag konnte nicht erstellt werden.');
  }
  await applyApprovedRequestToShiftPlan(tenantId, row);
  revalidatePath('/mitarbeiter/antraege');
  revalidatePath('/admin/antraege');
  revalidatePath('/admin/urlaubsplan');
  return mapRowToView(row, `${employee.first_name} ${employee.last_name}`.trim());
}

export async function getLeaveRequestsForYear(
  tenantId: string,
  year: number
): Promise<LeaveRequestView[]> {
  const startIso = `${year}-01-01`;
  const endIso = `${year}-12-31`;
  const rows = await listLeaveRequestsForDateRange(tenantId, startIso, endIso, 5000);
  const employeeNameMap = await getEmployeeDisplayNamesByIds(
    tenantId,
    rows.map((row) => row.employee_id)
  );
  return rows.map((row) => mapRowToView(row, employeeNameMap.get(row.employee_id) ?? null));
}

export async function getLeaveRequestsForYearByEmployees(
  tenantId: string,
  year: number,
  employeeIds: number[]
): Promise<LeaveRequestView[]> {
  const startIso = `${year}-01-01`;
  const endIso = `${year}-12-31`;
  const rows = await listLeaveRequestsForEmployeesInDateRange(
    tenantId,
    employeeIds,
    startIso,
    endIso,
    5000
  );
  const employeeNameMap = await getEmployeeDisplayNamesByIds(
    tenantId,
    rows.map((row) => row.employee_id)
  );
  return rows.map((row) => mapRowToView(row, employeeNameMap.get(row.employee_id) ?? null));
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
    const todayIso = toIsoDate(new Date());
    if (row.end_date < todayIso) {
      throw new Error('Für vergangene, genehmigte Anträge ist keine Stornierung mehr möglich.');
    }
    if (row.cancellation_requested === 1) {
      throw new Error('Eine Stornierung wurde bereits angefragt.');
    }
    if (row.cancellation_requested_at && !row.cancelled_at) {
      throw new Error('Die Stornierung wurde bereits abgelehnt und kann nicht erneut angefragt werden.');
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
  await notifyEmployeeAboutLeaveDecision(tenantId, row, 'cancellation_approved', input.adminNote);

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

  await clearLeaveRequestCancellation(tenantId, row.id, { keepHistory: true });
  await updateLeaveRequestStatus(tenantId, {
    id: row.id,
    status: 'approved',
    adminNote: input.adminNote,
    decidedBy: input.adminId,
  });
  await notifyEmployeeAboutLeaveDecision(tenantId, row, 'cancellation_rejected', input.adminNote);

  revalidatePath('/mitarbeiter/antraege');
  revalidatePath('/admin/antraege');

  const updated = await getLeaveRequestById(tenantId, row.id);
  const employee = await getEmployeeById(tenantId, row.employee_id);
  return mapRowToView(updated ?? row, employee ? `${employee.first_name} ${employee.last_name}`.trim() : null);
}

export async function adminDeleteLeaveRequest(
  tenantId: string,
  input: {
    requestId: number;
  }
): Promise<void> {
  const row = await getLeaveRequestById(tenantId, input.requestId);
  if (!row) {
    throw new Error('Antrag wurde nicht gefunden.');
  }

  if (row.applied_to_shift_plan === 1) {
    await removeApprovedRequestFromShiftPlan(tenantId, row);
  }

  await deleteLeaveRequestById(tenantId, row.id);

  revalidatePath('/mitarbeiter/antraege');
  revalidatePath('/admin/antraege');
  revalidatePath('/admin/urlaubsplan');
  revalidatePath('/mitarbeiter/schichtplan');
}
