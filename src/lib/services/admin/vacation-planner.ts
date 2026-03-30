import { getPrisma } from '@/lib/prisma';
import { listBranches } from '@/lib/data/branches';
import { listVacationLocksForDateRange, type VacationLockRow } from '@/lib/data/vacation-locks';
import {
  getLeaveRequestsForYearByEmployees,
  type LeaveRequestView,
} from '@/lib/services/leave-requests';
import { isHolidayIsoDate, normalizeHolidayRegion } from '@/lib/services/holidays';
import { computeVacationBalance, resolveCarryExpiryIsoForYear } from '@/lib/services/vacation-balance';

export type VacationPlannerEmployeeSummary = {
  employeeId: number;
  name: string;
  initials: string;
  color: string;
  annualDays: number;
  carryDays: number;
  carryExpiryDate: string | null;
  takenDays: number;
  pendingDays: number;
  availableDays: number;
};

export type VacationPlannerData = {
  year: number;
  branchOptions: Array<{ id: number; name: string; region: string | null }>;
  selectedBranchId: number | null;
  employees: VacationPlannerEmployeeSummary[];
  leaveRequests: LeaveRequestView[];
  locks: VacationLockRow[];
  holidays: Array<{ isoDate: string; names: string[] }>;
  holidayOverlapByRequestId: Record<number, number>;
  holidayDatesByRequestId: Record<number, string[]>;
  recordedVacationDays: Array<{ employeeId: number; isoDate: string; amount: number }>;
};

const EMPLOYEE_COLORS = [
  '#2563eb',
  '#16a34a',
  '#dc2626',
  '#d97706',
  '#7c3aed',
  '#0d9488',
  '#db2777',
  '#475569',
  '#0891b2',
  '#b45309',
];

const holidaySetCache = new Map<string, { holidayDates: Set<string>; holidayNamesByDate: Map<string, Set<string>> }>();

function toInitials(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length === 0) return 'MA';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}

function parseIsoDate(isoDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const date = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getOpeningAnchorDate(entryDate: string | null, openingEffectiveDate: string | null): Date | null {
  const candidate = openingEffectiveDate ?? entryDate ?? null;
  if (!candidate) return null;
  return parseIsoDate(candidate);
}

function enumerateDates(startIso: string, endIso: string): string[] {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  if (!start || !end) return [];
  const result: string[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    result.push(`${y}-${m}-${d}`);
  }
  return result;
}

function buildHolidaySetsForRegion(
  year: number,
  region: string,
): {
  holidayDates: Set<string>;
  holidayNamesByDate: Map<string, Set<string>>;
} {
  const cacheKey = `${year}:${region}`;
  const cached = holidaySetCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const holidayDates = new Set<string>();
  const holidayNamesByDate = new Map<string, Set<string>>();
  const startIso = `${year}-01-01`;
  const endIso = `${year}-12-31`;
  for (const isoDate of enumerateDates(startIso, endIso)) {
    const holiday = isHolidayIsoDate(isoDate, region);
    if (!holiday.isHoliday) continue;
    holidayDates.add(isoDate);
    const names = holidayNamesByDate.get(isoDate) ?? new Set<string>();
    names.add(holiday.name?.trim() || 'Feiertag');
    holidayNamesByDate.set(isoDate, names);
  }
  const value = { holidayDates, holidayNamesByDate };
  holidaySetCache.set(cacheKey, value);
  return value;
}

function resolveRegion(
  selectedBranchId: number | null,
  employeeBranchIds: number[],
  branchRegionById: Map<number, string | null>,
  fallbackFederalState: string | null,
): string | null {
  if (selectedBranchId) {
    const selectedRegion = branchRegionById.get(selectedBranchId) ?? null;
    if (selectedRegion) {
      return selectedRegion;
    }
  }
  const firstBranchId = employeeBranchIds[0] ?? null;
  if (firstBranchId) {
    return branchRegionById.get(firstBranchId) ?? null;
  }
  return normalizeHolidayRegion(fallbackFederalState ?? null);
}

function overlapVacationDaysForYear(
  startIso: string,
  endIso: string,
  year: number,
  fromIso?: string,
): number {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const effectiveStart = fromIso && fromIso > yearStart ? fromIso : yearStart;
  const overlapStart = startIso > effectiveStart ? startIso : effectiveStart;
  const overlapEnd = endIso < yearEnd ? endIso : yearEnd;
  if (overlapEnd < overlapStart) return 0;
  const start = parseIsoDate(overlapStart);
  const end = parseIsoDate(overlapEnd);
  if (!start || !end) return 0;
  const diffMs = end.getTime() - start.getTime();
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1);
}

export async function getVacationPlannerData(
  tenantId: string,
  year: number,
  branchId?: number | null,
): Promise<VacationPlannerData> {
  const prisma = getPrisma();
  const startIso = `${year}-01-01`;
  const endIso = `${year}-12-31`;
  const now = new Date();
  const currentYear = now.getFullYear();
  const asOfMonth = year === currentYear ? now.getMonth() + 1 : 12;
  const asOfLastDay = new Date(year, asOfMonth, 0).getDate();
  const asOfIso = `${year}-${String(asOfMonth).padStart(2, '0')}-${String(asOfLastDay).padStart(2, '0')}`;
  const approvedFromIso = (() => {
    const endDate = parseIsoDate(asOfIso);
    if (!endDate) return asOfIso;
    const next = new Date(endDate);
    next.setDate(endDate.getDate() + 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  })();
  const selectedBranchId = branchId && Number.isFinite(branchId) && branchId > 0 ? branchId : null;

  const [branches, employeeRows, locks] = await Promise.all([
    listBranches(tenantId),
    prisma.employee.findMany({
      where: {
        tenantId,
        isActive: 1,
        ...(selectedBranchId
          ? {
              employeeBranches: {
                some: { branchId: selectedBranchId },
              },
            }
          : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        entryDate: true,
        exitDate: true,
        openingEffectiveDate: true,
        federalState: true,
        vacationDaysTotal: true,
        vacationDaysLastYear: true,
        openingVacationCarryDays: true,
        openingVacationTakenYtd: true,
        vacationCarryExpiryEnabled: true,
        vacationCarryExpiryDate: true,
        employeeBranches: {
          select: {
            branchId: true,
          },
          orderBy: { branchId: 'asc' },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    }),
    listVacationLocksForDateRange(tenantId, startIso, endIso, selectedBranchId),
  ]);
  const allRequests = await getLeaveRequestsForYearByEmployees(
    tenantId,
    year,
    employeeRows.map((row) => row.id),
  );
  const [dailyRows, dailyVacationRows] = await Promise.all([
    prisma.dailyDay.findMany({
      where: {
        employeeId: { in: employeeRows.map((row) => row.id) },
        dayDate: { lte: asOfIso },
      },
      select: { employeeId: true, dayDate: true, code: true },
      orderBy: [{ employeeId: 'asc' }, { dayDate: 'asc' }],
    }),
    prisma.dailyDay.findMany({
      where: {
        employeeId: { in: employeeRows.map((row) => row.id) },
        dayDate: { gte: startIso, lte: endIso },
        code: { in: ['U', 'UH'] },
      },
      select: { employeeId: true, dayDate: true, code: true },
      orderBy: [{ employeeId: 'asc' }, { dayDate: 'asc' }],
    }),
  ]);
  const dailyRecordsByEmployee = new Map<number, Array<{ day_date: string; code: string | null }>>();
  for (const row of dailyRows) {
    const list = dailyRecordsByEmployee.get(row.employeeId) ?? [];
    list.push({ day_date: row.dayDate, code: row.code ?? null });
    dailyRecordsByEmployee.set(row.employeeId, list);
  }

  const employeeIds = new Set(employeeRows.map((row) => row.id));
  const employeeMap = new Map(employeeRows.map((row) => [row.id, row]));
  const branchRegionById = new Map(
    branches.map((branch) => [
      branch.id,
      normalizeHolidayRegion(branch.federalState ?? branch.country ?? null),
    ]),
  );
  const holidayOverlapByRequestId: Record<number, number> = {};
  const holidayDatesByRequestId: Record<number, string[]> = {};

  const effectiveRegions = Array.from(
    new Set(
      (selectedBranchId
        ? branches
            .filter((branch) => branch.id === selectedBranchId)
            .map((branch) => normalizeHolidayRegion(branch.federalState ?? branch.country ?? null))
        : branches.map((branch) => normalizeHolidayRegion(branch.federalState ?? branch.country ?? null))).filter(
        Boolean,
      ) as string[],
    ),
  );

  const holidaySetByRegion = new Map<string, Set<string>>();
  const holidayNamesMergedByDate = new Map<string, Set<string>>();
  for (const region of effectiveRegions) {
    const { holidayDates, holidayNamesByDate } = buildHolidaySetsForRegion(year, region);
    holidaySetByRegion.set(region, holidayDates);
    for (const [isoDate, names] of holidayNamesByDate.entries()) {
      const merged = holidayNamesMergedByDate.get(isoDate) ?? new Set<string>();
      for (const name of names) {
        merged.add(name);
      }
      holidayNamesMergedByDate.set(isoDate, merged);
    }
  }

  const requests = allRequests.filter((row) => {
    if (!employeeIds.has(row.employeeId)) return false;
    if (!selectedBranchId) return true;
    const employee = employeeMap.get(row.employeeId);
    return Boolean(employee?.employeeBranches.some((branch) => branch.branchId === selectedBranchId));
  });

  const byEmployee = new Map<number, LeaveRequestView[]>();
  for (const request of requests) {
    if (request.type === 'vacation') {
      const employee = employeeMap.get(request.employeeId);
      const region = employee
        ? resolveRegion(
            selectedBranchId,
            employee.employeeBranches.map((item) => item.branchId),
            branchRegionById,
            employee.federalState ?? null,
          )
        : null;
      const regionHolidaySet = region ? holidaySetByRegion.get(region) ?? null : null;
      const holidayDates = regionHolidaySet
        ? enumerateDates(request.startDate, request.endDate).filter((isoDate) => {
            if (!isoDate.startsWith(`${year}-`)) return false;
            return regionHolidaySet.has(isoDate);
          })
        : [];
      holidayDatesByRequestId[request.id] = holidayDates;
      holidayOverlapByRequestId[request.id] = holidayDates.length;
    }
    const list = byEmployee.get(request.employeeId) ?? [];
    list.push(request);
    byEmployee.set(request.employeeId, list);
  }

  const employees: VacationPlannerEmployeeSummary[] = employeeRows.map((row, index) => {
    const name = `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim();
    const ownRequests = byEmployee.get(row.id) ?? [];
    const openingAnchorDate = getOpeningAnchorDate(row.entryDate ?? null, row.openingEffectiveDate ?? null);
    const openingTakenDays =
      openingAnchorDate && openingAnchorDate.getFullYear() === year
        ? Number(row.openingVacationTakenYtd ?? 0)
        : 0;
    const carryExpiryDate = resolveCarryExpiryIsoForYear(year, row.vacationCarryExpiryDate ?? null);
    const vacationBalance = computeVacationBalance({
      annualDays: Number(row.vacationDaysTotal ?? 0),
      importedCarryDays: Number(row.openingVacationCarryDays ?? row.vacationDaysLastYear ?? 0),
      openingTakenDays,
      entryDate: row.openingEffectiveDate ?? row.entryDate ?? null,
      exitDate: row.exitDate ?? null,
      asOfDate: asOfIso,
      carryExpiryEnabled: Number(row.vacationCarryExpiryEnabled ?? 0) === 1,
      carryExpiryDate: row.vacationCarryExpiryDate ?? null,
      year,
      records: dailyRecordsByEmployee.get(row.id) ?? [],
    });
    const requestedVacationDays = ownRequests.reduce((acc, item) => {
      if (item.type !== 'vacation' || item.status !== 'pending') return acc;
      return acc + overlapVacationDaysForYear(item.startDate, item.endDate, year);
    }, 0);
    const approvedVacationDays = ownRequests.reduce((acc, item) => {
      if (item.type !== 'vacation' || item.status !== 'approved') return acc;
      if (item.cancellationRequested || item.cancelledAt) return acc;
      return acc + overlapVacationDaysForYear(item.startDate, item.endDate, year, approvedFromIso);
    }, 0);
    const annualDays = Number(vacationBalance.annualDays ?? 0);
    const carryDays = Number(vacationBalance.carryRemainingDays ?? 0);
    const takenDays = Number(vacationBalance.takenDays ?? 0);
    const availableDays = Math.max(
      0,
      Number((vacationBalance.remainingDays - approvedVacationDays - requestedVacationDays).toFixed(2)),
    );

    return {
      employeeId: row.id,
      name,
      initials: toInitials(name),
      color: EMPLOYEE_COLORS[index % EMPLOYEE_COLORS.length] ?? '#2563eb',
      annualDays,
      carryDays,
      carryExpiryDate,
      takenDays: Number(takenDays.toFixed(2)),
      pendingDays: Number(requestedVacationDays.toFixed(2)),
      availableDays,
    };
  });

  const holidays = Array.from(holidayNamesMergedByDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([isoDate, names]) => ({ isoDate, names: Array.from(names.values()) }));

  return {
    year,
    selectedBranchId,
    branchOptions: branches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      region: normalizeHolidayRegion(branch.federalState ?? branch.country ?? null),
    })),
    employees,
    leaveRequests: requests,
    locks,
    holidays,
    holidayOverlapByRequestId,
    holidayDatesByRequestId,
    recordedVacationDays: dailyVacationRows
      .map((row) => ({
        employeeId: row.employeeId,
        isoDate: row.dayDate,
        amount: row.code === 'UH' ? 0.5 : 1,
      })),
  };
}
