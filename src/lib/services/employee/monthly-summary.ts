import { createBonusPayoutRequest } from '@/lib/data/bonus-payout-requests';
import { listDailyDayRecords } from '@/lib/data/daily-days';
import { listLeaveRequestsForEmployee } from '@/lib/data/leave-requests';
import { hasSuccessfulVacationCarryNotificationBefore } from '@/lib/data/vacation-carry-notifications';
import {
  getEmployeeSelfSummaryData,
  type EmployeeSelfSummaryData,
} from '@/lib/data/employees';
import {
  getEmployeeBonusEntry,
  getPreviousEmployeeBonusEntry,
} from '@/lib/data/employee-bonus';
import { sumEmployeeOvertimePayoutsUpTo } from '@/lib/data/employee-overtime-payouts';
import { toLocalIsoDate } from '@/lib/date/local-iso';
import { getPlanHoursForDayFromPlan, getShiftPlan } from '@/lib/services/shift-plan';
import { computeVacationBalance } from '@/lib/services/vacation-balance';
import { sendVacationCarryExpiryNotification } from '@/lib/services/vacation-carry-notification';

import { getEmployeeMonthlyOverview, type EmployeeMonthlyOverview } from './monthly-overview';

const MONTH_NAMES = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

const DECIMAL_FACTOR = 100;

function roundTwo(value: number): number {
  return Math.round(value * DECIMAL_FACTOR) / DECIMAL_FACTOR;
}

function monthName(month: number): string {
  return MONTH_NAMES[Math.max(0, Math.min(11, month - 1))] ?? '';
}

function nextMonth(year: number, month: number): { year: number; month: number } {
  if (month === 12) {
    return { year: year + 1, month: 1 };
  }
  return { year, month: month + 1 };
}

function previousMonth(year: number, month: number): { year: number; month: number } {
  if (month === 1) {
    return { year: year - 1, month: 12 };
  }
  return { year, month: month - 1 };
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return 0;
  if (Number.isNaN(min) || Number.isNaN(max)) return value;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number.parseInt(match[1] ?? '', 10);
  const minutes = Number.parseInt(match[2] ?? '', 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function toDurationHours(startTime: string | null | undefined, endTime: string | null | undefined): number {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return 0;
  return roundTwo((endMinutes - startMinutes) / 60);
}

function enumerateIsoDates(startIso: string, endIso: string): string[] {
  const startDate = parseIsoDate(startIso);
  const endDate = parseIsoDate(endIso);
  if (!startDate || !endDate || startDate > endDate) return [];
  const result: string[] = [];
  for (const cursor = new Date(startDate.getTime()); cursor <= endDate; cursor.setDate(cursor.getDate() + 1)) {
    result.push(toLocalIsoDate(cursor));
  }
  return result;
}

function getOpeningAnchorDate(meta: EmployeeSelfSummaryData | null): Date | null {
  return parseIsoDate(meta?.openingEffectiveDate ?? meta?.entryDate ?? null);
}

function isYearMonthAfterDate(year: number, month: number, anchorDate: Date | null): boolean {
  if (!anchorDate) return true;
  const y = anchorDate.getUTCFullYear();
  const m = anchorDate.getUTCMonth() + 1;
  if (year > y) return true;
  if (year < y) return false;
  return month > m;
}

async function computeWorkdays(employeeId: number, year: number, month: number): Promise<number> {
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const start = `${monthKey}-01`;
  const end = `${monthKey}-${String(daysInMonth).padStart(2, '0')}`;
  const plan = await getShiftPlan(employeeId, { from: start, to: end });

  let count = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${monthKey}-${String(day).padStart(2, '0')}`;
    const planInfo = getPlanHoursForDayFromPlan(plan, iso);
    if (planInfo && planInfo.sollHours > 0) {
      count += 1;
    }
  }

  return count;
}

async function computeCurrentBalance(
  overview: EmployeeMonthlyOverview,
  employeeId: number,
  meta: EmployeeSelfSummaryData | null
): Promise<number> {
  const allRecords = await listDailyDayRecords(employeeId);
  const year = overview.selectedYear;
  const month = overview.selectedMonth;
  const monthEnd = new Date(Date.UTC(year, month, 0));
  const openingAnchorDate = getOpeningAnchorDate(meta);

  const overtimeUpToMonth = roundTwo(
    allRecords
      .map((record) => {
        const date = parseIsoDate(record.day_date);
        return { record, date };
      })
      .filter((entry): entry is { record: typeof allRecords[number]; date: Date } => !!entry.date)
      .filter(({ date }) => (openingAnchorDate ? date > openingAnchorDate : true))
      .filter(({ date }) => date <= monthEnd)
      .reduce((acc, entry) => acc + Number(entry.record.overtime_delta ?? 0), 0)
  );

  const totalOvertimePayouts = roundTwo(
    openingAnchorDate
      ? isYearMonthAfterDate(year, month, openingAnchorDate)
        ? (await sumEmployeeOvertimePayoutsUpTo(employeeId, year, month)) -
          (await sumEmployeeOvertimePayoutsUpTo(
            employeeId,
            openingAnchorDate.getUTCFullYear(),
            openingAnchorDate.getUTCMonth() + 1
          ))
        : 0
      : await sumEmployeeOvertimePayoutsUpTo(employeeId, year, month)
  );

  const openingBalance = roundTwo(meta?.openingOvertimeBalance ?? 0);
  const manualCorrection = roundTwo(meta?.overtimeBalance ?? 0);

  const maxMinus = Number(meta?.maxMinusHours ?? 0) || 0;
  const maxOvertime = Number(meta?.maxOvertimeHours ?? 0) || 0;

  return clamp(
    roundTwo(openingBalance + overtimeUpToMonth - totalOvertimePayouts + manualCorrection),
    -maxMinus,
    maxOvertime
  );
}

export interface EmployeeMonthlySummary {
  sales: {
    monthlyTarget: number;
    monthlyRevenue: number;
    workdays: number;
    recordedDays: number;
    missingDays: number;
    restRevenue: number;
    monthLabel: string;
  };
  bonus: {
    calculated: number;
    previousCarry: number;
    paid: number;
    carry: number;
    available: number;
    monthLabel: string;
    previousMonthLabel: string;
    nextMonthLabel: string;
  };
  worktime: {
    soll: number;
    ist: number;
    difference: number;
    overtimeDelta: number;
    forcedOverflow: number;
    currentBalance: number;
    payout: number;
    availableForPayout: number;
    remaining: number;
    plannedOvertimeReduction: number;
    remainingAfterPlanned: number;
  };
  vacation: {
    totalDays: number;
    takenDays: number;
    carryRemainingDays: number;
    remainingDays: number;
    carryExpiryEnabled: boolean;
    carryExpiryDate: string | null;
  };
}

export interface RequestEmployeeBonusPayoutInput {
  tenantId: string;
  employeeId: number;
  year: number;
  month: number;
  amount: number;
  note?: string | null;
}

export async function getEmployeeMonthlySummary(
  tenantId: string,
  employeeId: number,
  overview: EmployeeMonthlyOverview
): Promise<EmployeeMonthlySummary> {
  const meta = await getEmployeeSelfSummaryData(tenantId, employeeId);
  const year = overview.selectedYear;
  const month = overview.selectedMonth;
  const monthEndIso = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;

  const allRecords = await listDailyDayRecords(employeeId);

  const monthlyTarget = roundTwo(((meta?.mindJahresumsatz ?? 0) || 0) / 12);
  const monthlyRevenue = roundTwo(overview.totals.brutto ?? 0);
  const restRevenue = roundTwo(monthlyTarget - monthlyRevenue);
  const workdays = await computeWorkdays(employeeId, year, month);
  const recordedDays = overview.entries.length;
  const missingDays = Math.max(workdays - recordedDays, 0);

  const monthlySoll = roundTwo(overview.totals.sollHours ?? 0);
  const monthlyIst = roundTwo(overview.totals.istHours ?? 0);
  const monthlyDifference = roundTwo(monthlyIst - monthlySoll);
  const overtimeDelta = roundTwo(overview.totals.overtimeDelta ?? 0);
  const forcedOverflow = roundTwo(overview.breakdown.forcedOverflow ?? 0);
  const currentBalance = await computeCurrentBalance(overview, employeeId, meta);
  const monthlyOvertimePayout = roundTwo(overview.breakdown.overtimePayoutHours ?? 0);
  const remainingOvertime = roundTwo(Math.max(currentBalance, 0));
  const availableForPayout = roundTwo(remainingOvertime + monthlyOvertimePayout);
  const leaveRequests = await listLeaveRequestsForEmployee(tenantId, employeeId, 5000);
  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowIso = toLocalIsoDate(tomorrow);
  const approvedFutureOvertimeRequests = leaveRequests.filter((request) => {
    if (request.type !== 'overtime') return false;
    if (request.status !== 'approved') return false;
    if (request.cancelled_at) return false;
    return request.end_date >= tomorrowIso;
  });
  const futurePlanStartIso = approvedFutureOvertimeRequests
    .map((request) => request.start_date)
    .sort((a, b) => (a < b ? -1 : 1))[0] ?? tomorrowIso;
  const futurePlanEndIso = approvedFutureOvertimeRequests
    .map((request) => request.end_date)
    .sort((a, b) => (a > b ? -1 : 1))[0] ?? tomorrowIso;
  const futureShiftPlan = approvedFutureOvertimeRequests.length
    ? await getShiftPlan(employeeId, { from: futurePlanStartIso, to: futurePlanEndIso })
    : null;
  let plannedOvertimeReduction = 0;
  for (const request of approvedFutureOvertimeRequests) {
    const explicitDurationHours = toDurationHours(request.start_time, request.end_time);
    if (explicitDurationHours > 0) {
      for (const isoDate of enumerateIsoDates(request.start_date, request.end_date)) {
        if (isoDate >= tomorrowIso) {
          plannedOvertimeReduction += explicitDurationHours;
        }
      }
      continue;
    }
    for (const isoDate of enumerateIsoDates(request.start_date, request.end_date)) {
      if (isoDate < tomorrowIso) continue;
      const planInfo = futureShiftPlan ? getPlanHoursForDayFromPlan(futureShiftPlan, isoDate, request.reason ?? '') : null;
      plannedOvertimeReduction += Number(planInfo?.sollHours ?? 0);
    }
  }
  plannedOvertimeReduction = roundTwo(plannedOvertimeReduction);
  const remainingAfterPlanned = roundTwo(currentBalance - plannedOvertimeReduction);

  const openingAnchorDate = getOpeningAnchorDate(meta);
  const openingTakenDaysForYear =
    openingAnchorDate && openingAnchorDate.getUTCFullYear() === year
      ? roundTwo(meta?.openingVacationTakenYtd ?? 0)
      : 0;

  const vacationBalance = computeVacationBalance({
    carryExpiryNotified:
      meta?.vacationCarryExpiryEnabled && meta?.vacationCarryExpiryDate
        ? await hasSuccessfulVacationCarryNotificationBefore({
            tenantId,
            employeeId,
            year,
            expiryValue: meta.vacationCarryExpiryDate,
          })
        : false,
    annualDays: roundTwo(meta?.vacationDaysTotal ?? 0),
    importedCarryDays: roundTwo(meta?.openingVacationCarryDays ?? meta?.vacationDaysLastYear ?? 0),
    openingTakenDays: openingTakenDaysForYear,
    entryDate: meta?.openingEffectiveDate ?? meta?.entryDate ?? null,
    exitDate: meta?.exitDate ?? null,
    asOfDate: monthEndIso,
    carryExpiryEnabled: Boolean(meta?.vacationCarryExpiryEnabled),
    carryExpiryDate: meta?.vacationCarryExpiryDate ?? null,
    year,
    records: allRecords,
  });

  if (meta?.vacationCarryExpiryEnabled && meta.vacationCarryExpiryDate) {
    await sendVacationCarryExpiryNotification({
      tenantId,
      employeeId,
      year,
      carryDays: vacationBalance.carryStartDays,
      expiryDate: meta.vacationCarryExpiryDate,
    });
  }

  const bonusPercent = Number(meta?.monatlicherBonusProzent ?? 0);
  const revenueDelta = monthlyRevenue - monthlyTarget;
  const mehrUmsatzNetto = revenueDelta > 0 ? roundTwo(revenueDelta * (100 / 119)) : 0;
  const calculatedBonus = roundTwo((mehrUmsatzNetto * bonusPercent) / 100);

  let previousCarry = 0;
  const previousEntry = await getPreviousEmployeeBonusEntry(employeeId, year, month);
  if (previousEntry) {
    previousCarry = roundTwo(previousEntry.carryOver ?? 0);
  } else {
    const openingAnchorDate = getOpeningAnchorDate(meta);
    if (isYearMonthAfterDate(year, month, openingAnchorDate)) {
      previousCarry = roundTwo(meta?.openingBonusCarry ?? meta?.importedBonusEarned ?? 0);
    }
  }

  const availableBonus = roundTwo(previousCarry + calculatedBonus);
  const currentEntry = await getEmployeeBonusEntry(employeeId, year, month);
  const paidBonus = roundTwo(currentEntry?.payout ?? 0);
  const carryBonus =
    currentEntry !== null && currentEntry !== undefined
      ? roundTwo(currentEntry.carryOver ?? 0)
      : roundTwo(Math.max(availableBonus - paidBonus, 0));

  const { year: nextYear, month: nextMonthValue } = nextMonth(year, month);
  const { year: prevYear, month: prevMonthValue } = previousMonth(year, month);

  return {
    sales: {
      monthlyTarget,
      monthlyRevenue,
      restRevenue,
      workdays,
      recordedDays,
      missingDays,
      monthLabel: `${monthName(month)} ${year}`,
    },
    bonus: {
      calculated: calculatedBonus,
      previousCarry,
      paid: paidBonus,
      carry: carryBonus,
      available: roundTwo(Math.max(availableBonus - paidBonus, 0)),
      monthLabel: `${monthName(month)} ${year}`,
      previousMonthLabel: `${monthName(prevMonthValue)} ${prevYear}`,
      nextMonthLabel: `${monthName(nextMonthValue)} ${nextYear}`,
    },
    worktime: {
      soll: monthlySoll,
      ist: monthlyIst,
      difference: monthlyDifference,
      overtimeDelta,
      forcedOverflow,
      currentBalance,
      payout: monthlyOvertimePayout,
      availableForPayout,
      remaining: remainingOvertime,
      plannedOvertimeReduction,
      remainingAfterPlanned,
    },
    vacation: {
      totalDays: roundTwo(vacationBalance.annualDays + vacationBalance.carryStartDays),
      takenDays: vacationBalance.takenDays,
      carryRemainingDays: vacationBalance.carryRemainingDays,
      remainingDays: vacationBalance.remainingDays,
      carryExpiryEnabled: Boolean(meta?.vacationCarryExpiryEnabled),
      carryExpiryDate: meta?.vacationCarryExpiryDate ?? null,
    },
  };
}

export async function requestEmployeeBonusPayout(
  input: RequestEmployeeBonusPayoutInput
): Promise<{ status: 'success' | 'error'; message: string }> {
  if (!Number.isFinite(input.year) || !Number.isFinite(input.month)) {
    return { status: 'error', message: 'Zeitraum konnte nicht gelesen werden.' };
  }

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { status: 'error', message: 'Bitte gib einen positiven Betrag ein.' };
  }

  const overview = await getEmployeeMonthlyOverview(input.employeeId, input.year, input.month);
  const summary = await getEmployeeMonthlySummary(input.tenantId, input.employeeId, overview);

  if (input.amount > summary.bonus.available + 0.01) {
    return {
      status: 'error',
      message: 'Der gewünschte Betrag übersteigt den verfügbaren Bonus.',
    };
  }

  await createBonusPayoutRequest({
    employeeId: input.employeeId,
    year: input.year,
    month: input.month,
    amount: input.amount,
    note: input.note ?? null,
  });

  return {
    status: 'success',
    message: 'Auszahlungswunsch wurde gespeichert und an die Verwaltung übermittelt.',
  };
}
