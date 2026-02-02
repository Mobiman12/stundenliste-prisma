import { listDailyDayRecords, type DailyDayRecord } from '@/lib/data/daily-days';
import {
  getEmployeeSelfSummaryData,
  type EmployeeSelfSummaryData,
} from '@/lib/data/employees';
import {
  getEmployeeBonusEntry,
  getPreviousEmployeeBonusEntry,
} from '@/lib/data/employee-bonus';
import { sumEmployeeOvertimePayoutsUpTo } from '@/lib/data/employee-overtime-payouts';
import { getPlanHoursForDayFromPlan, getShiftPlan } from '@/lib/services/shift-plan';

import type { EmployeeMonthlyOverview } from './monthly-overview';

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

function calculateVacationDayFraction(row: DailyDayRecord): number {
  const vacationHours = Number(row.vacation_hours ?? 0);
  if (vacationHours <= 0) {
    return 0;
  }
  const planHours = Number(row.plan_hours ?? 0);
  const denominator = planHours > 0 ? planHours : 8;
  if (denominator <= 0) {
    return 0;
  }
  return vacationHours / denominator;
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

  const overtimeUpToMonth = roundTwo(
    allRecords
      .map((record) => {
        const date = parseIsoDate(record.day_date);
        return { record, date };
      })
      .filter((entry): entry is { record: typeof allRecords[number]; date: Date } => !!entry.date)
      .filter(({ date }) => date <= monthEnd)
      .reduce((acc, entry) => acc + Number(entry.record.overtime_delta ?? 0), 0)
  );

  const totalOvertimePayouts = roundTwo(
    sumEmployeeOvertimePayoutsUpTo(employeeId, year, month)
  );

  const importedPlus = roundTwo(meta?.importedOvertimeBalance ?? 0);
  const importedMinus = roundTwo(meta?.importedMinusBalance ?? 0);
  const importedBalance = roundTwo(importedPlus - importedMinus);

  const maxMinus = Number(meta?.maxMinusHours ?? 0) || 0;
  const maxOvertime = Number(meta?.maxOvertimeHours ?? 0) || 0;

  return clamp(
    roundTwo(importedBalance + overtimeUpToMonth - totalOvertimePayouts),
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
  };
  vacation: {
    totalDays: number;
    takenDays: number;
    remainingDays: number;
  };
}

export async function getEmployeeMonthlySummary(
  tenantId: string,
  employeeId: number,
  overview: EmployeeMonthlyOverview
): Promise<EmployeeMonthlySummary> {
  const meta = await getEmployeeSelfSummaryData(tenantId, employeeId);
  const year = overview.selectedYear;
  const month = overview.selectedMonth;

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

  const recordsWithDates = allRecords
    .map((record) => ({ record, date: parseIsoDate(record.day_date) }))
    .filter((entry): entry is { record: DailyDayRecord; date: Date } => !!entry.date);

  const recordsForSelectedYear = recordsWithDates.filter(
    ({ date }) => date.getUTCFullYear() === year
  );

  const vacationFromRecords = roundTwo(
    recordsForSelectedYear.reduce(
      (acc, entry) => acc + calculateVacationDayFraction(entry.record),
      0
    )
  );

  const importedVacation = roundTwo(meta?.importedVacationTaken ?? 0);
  const totalVacationDays = roundTwo(
    (meta?.vacationDays ?? 0) + (meta?.vacationDaysLastYear ?? 0)
  );
  const vacationTaken = roundTwo(importedVacation + vacationFromRecords);
  const vacationRemaining = roundTwo(Math.max(totalVacationDays - vacationTaken, 0));

  const bonusPercent = Number(meta?.monatlicherBonusProzent ?? 0);
  const revenueDelta = monthlyRevenue - monthlyTarget;
  const mehrUmsatzNetto = revenueDelta > 0 ? roundTwo(revenueDelta * (100 / 119)) : 0;
  const calculatedBonus = roundTwo((mehrUmsatzNetto * bonusPercent) / 100);

  let previousCarry = 0;
  const previousEntry = getPreviousEmployeeBonusEntry(employeeId, year, month);
  if (previousEntry) {
    previousCarry = roundTwo(previousEntry.carryOver ?? 0);
  } else {
    const entryDate = parseIsoDate(meta?.entryDate);
    if (
      entryDate &&
      entryDate.getUTCFullYear() === year &&
      entryDate.getUTCMonth() + 1 === month
    ) {
      previousCarry = roundTwo(meta?.importedBonusEarned ?? 0);
    }
  }

  const availableBonus = roundTwo(previousCarry + calculatedBonus);
  const currentEntry = getEmployeeBonusEntry(employeeId, year, month);
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
    },
    vacation: {
      totalDays: totalVacationDays,
      takenDays: vacationTaken,
      remainingDays: vacationRemaining,
    },
  };
}
