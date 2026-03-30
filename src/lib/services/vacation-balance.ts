type VacationCode = 'U' | 'UH';

interface VacationUsageEntry {
  isoDate: string;
  amount: number;
}

interface VacationSimulationResult {
  carryIn: number;
  carryRemaining: number;
  annualRemaining: number;
  carryOut: number;
  taken: number;
}

export interface VacationBalanceInput {
  annualDays: number;
  importedCarryDays: number;
  openingTakenDays?: number;
  entryDate: string | null;
  exitDate?: string | null;
  asOfDate?: string | null;
  carryExpiryEnabled: boolean;
  carryExpiryDate: string | null;
  carryExpiryNotified?: boolean;
  year: number;
  records: Array<{
    day_date: string;
    code: string | null;
  }>;
}

export interface VacationBalanceResult {
  annualDays: number;
  carryStartDays: number;
  takenDays: number;
  carryRemainingDays: number;
  annualRemainingDays: number;
  remainingDays: number;
}

const DECIMAL_FACTOR = 100;

function roundTwo(value: number): number {
  return Math.round(value * DECIMAL_FACTOR) / DECIMAL_FACTOR;
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function roundStatutoryVacationDays(value: number): number {
  const safe = Math.max(value, 0);
  const fullDays = Math.trunc(safe);
  const fraction = safe - fullDays;
  return fraction >= 0.5 ? fullDays + 1 : fullDays;
}

function computeEligibleAnnualDays(input: {
  annualDays: number;
  year: number;
  entryDate: string | null;
  exitDate: string | null | undefined;
}): number {
  const baseAnnualDays = roundTwo(Math.max(input.annualDays, 0));
  let startMonth = 1;
  let endMonth = 12;

  const entry = parseIsoDate(input.entryDate);
  if (entry) {
    const entryYear = entry.getUTCFullYear();
    const entryMonth = entry.getUTCMonth() + 1;
    const entryDay = entry.getUTCDate();
    if (entryYear > input.year) {
      return 0;
    }
    if (entryYear === input.year) {
      // For pro-rata we count only full calendar months in the start year.
      startMonth = entryDay > 1 ? Math.min(entryMonth + 1, 13) : entryMonth;
    }
  }

  const exit = parseIsoDate(input.exitDate);
  if (exit) {
    const exitYear = exit.getUTCFullYear();
    const exitMonth = exit.getUTCMonth() + 1;
    const exitDay = exit.getUTCDate();
    if (exitYear < input.year) {
      return 0;
    }
    if (exitYear === input.year) {
      const lastDay = getDaysInMonth(exitYear, exitMonth);
      // For pro-rata we count only full calendar months in the exit year.
      endMonth = exitDay < lastDay ? Math.max(exitMonth - 1, 0) : exitMonth;
    }
  }

  const fullMonths = Math.max(endMonth - startMonth + 1, 0);
  if (fullMonths <= 0) return 0;
  return roundStatutoryVacationDays((baseAnnualDays / 12) * fullMonths);
}

function parseMonthDay(value: string | null | undefined): { month: number; day: number } | null {
  if (!value) return null;
  const normalized = value.trim();
  const mdMatch = /^(\d{2})-(\d{2})$/.exec(normalized);
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  const month = Number.parseInt((mdMatch?.[1] ?? isoMatch?.[2] ?? ''), 10);
  const day = Number.parseInt((mdMatch?.[2] ?? isoMatch?.[3] ?? ''), 10);
  if (!Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const check = new Date(Date.UTC(2024, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return { month, day };
}

export function resolveCarryExpiryIsoForYear(
  year: number,
  expiryValue: string | null | undefined
): string | null {
  if (!expiryValue) return null;
  const normalized = expiryValue.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (isoMatch) {
    const absoluteYear = Number.parseInt(isoMatch[1], 10);
    if (absoluteYear !== year) {
      return null;
    }
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }
  const monthDay = parseMonthDay(normalized);
  if (!monthDay) return null;
  return `${year}-${String(monthDay.month).padStart(2, '0')}-${String(monthDay.day).padStart(2, '0')}`;
}

function isVacationCode(code: string | null | undefined): code is VacationCode {
  const normalized = (code ?? '').trim().toUpperCase();
  return normalized === 'U' || normalized === 'UH';
}

function toVacationAmount(code: VacationCode): number {
  return code === 'UH' ? 0.5 : 1;
}

function usageByYear(records: VacationBalanceInput['records']): Map<number, VacationUsageEntry[]> {
  const grouped = new Map<number, VacationUsageEntry[]>();
  for (const row of records) {
    if (!isVacationCode(row.code)) {
      continue;
    }
    const parsed = parseIsoDate(row.day_date);
    if (!parsed) {
      continue;
    }
    const year = parsed.getFullYear();
    const entries = grouped.get(year) ?? [];
    entries.push({ isoDate: row.day_date, amount: toVacationAmount(row.code) });
    grouped.set(year, entries);
  }
  for (const entries of grouped.values()) {
    entries.sort((a, b) => (a.isoDate < b.isoDate ? -1 : 1));
  }
  return grouped;
}

function usageByYearUntil(records: VacationBalanceInput['records'], asOfDate: string | null): Map<number, VacationUsageEntry[]> {
  if (!asOfDate) {
    return usageByYear(records);
  }
  return usageByYear(records.filter((row) => row.day_date <= asOfDate));
}

function recordYears(records: VacationBalanceInput['records']): Set<number> {
  const years = new Set<number>();
  for (const row of records) {
    const parsed = parseIsoDate(row.day_date);
    if (!parsed) {
      continue;
    }
    years.add(parsed.getFullYear());
  }
  return years;
}

function recordYearsUntil(records: VacationBalanceInput['records'], asOfDate: string | null): Set<number> {
  if (!asOfDate) {
    return recordYears(records);
  }
  return recordYears(records.filter((row) => row.day_date <= asOfDate));
}

function getExpiryIsoForYear(
  carryExpiryEnabled: boolean,
  carryExpiryDate: string | null,
  _carryExpiryNotified: boolean,
  year: number
): string | null {
  if (!carryExpiryEnabled || !carryExpiryDate) {
    return null;
  }
  return resolveCarryExpiryIsoForYear(year, carryExpiryDate);
}

function simulateYear(params: {
  year: number;
  asOfIso: string | null;
  annualDays: number;
  carryIn: number;
  usage: VacationUsageEntry[];
  yearHasAnyRecords: boolean;
  carryExpiryEnabled: boolean;
  carryExpiryDate: string | null;
  carryExpiryNotified: boolean;
  applyExpiry: boolean;
}): VacationSimulationResult {
  let carryRemaining = roundTwo(Math.max(params.carryIn, 0));
  let annualRemaining = roundTwo(Math.max(params.annualDays, 0));
  const expiryIso = getExpiryIsoForYear(
    params.carryExpiryEnabled,
    params.carryExpiryDate,
    params.carryExpiryNotified,
    params.year
  );
  let carryExpired = false;
  let taken = 0;

  for (const entry of params.usage) {
    if (params.applyExpiry && !carryExpired && expiryIso && entry.isoDate > expiryIso) {
      carryRemaining = 0;
      carryExpired = true;
    }

    let open = roundTwo(entry.amount);
    taken = roundTwo(taken + open);

    if (carryRemaining > 0) {
      const fromCarry = Math.min(carryRemaining, open);
      carryRemaining = roundTwo(carryRemaining - fromCarry);
      open = roundTwo(open - fromCarry);
    }

    if (open > 0 && annualRemaining > 0) {
      const fromAnnual = Math.min(annualRemaining, open);
      annualRemaining = roundTwo(annualRemaining - fromAnnual);
    }
  }

  if (params.applyExpiry && !carryExpired && expiryIso) {
    if (params.asOfIso && params.asOfIso > expiryIso) {
      carryRemaining = 0;
    }
  }

  // Only carry annual remainder to the next year when this year has tracked records.
  // Without year records (historical gaps), we avoid synthesizing full carried vacation.
  const carryOut = roundTwo(
    Math.max(carryRemaining + (params.yearHasAnyRecords ? annualRemaining : 0), 0)
  );
  return {
    carryIn: roundTwo(Math.max(params.carryIn, 0)),
    carryRemaining: roundTwo(Math.max(carryRemaining, 0)),
    annualRemaining: roundTwo(Math.max(annualRemaining, 0)),
    carryOut,
    taken: roundTwo(Math.max(taken, 0)),
  };
}

export function computeVacationBalance(input: VacationBalanceInput): VacationBalanceResult {
  const annualDays = computeEligibleAnnualDays({
    annualDays: input.annualDays,
    year: input.year,
    entryDate: input.entryDate,
    exitDate: input.exitDate,
  });
  const importedCarryDays = roundTwo(Math.max(input.importedCarryDays, 0));
  const openingTakenDays = roundTwo(Math.max(input.openingTakenDays ?? 0, 0));
  const asOfDate = input.asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(input.asOfDate) ? input.asOfDate : null;
  const groupedUsage = usageByYearUntil(input.records, asOfDate);
  const yearsWithRecords = recordYearsUntil(input.records, asOfDate);

  const entryYear = (() => {
    const parsed = parseIsoDate(input.entryDate);
    if (parsed) {
      return parsed.getFullYear();
    }
    if (groupedUsage.size) {
      return Math.min(...Array.from(groupedUsage.keys()));
    }
    return input.year;
  })();

  let carryIn = importedCarryDays;
  for (let currentYear = entryYear; currentYear < input.year; currentYear += 1) {
    const previousYearUsage = groupedUsage.get(currentYear) ?? [];
    const simulation = simulateYear({
      year: currentYear,
      asOfIso: `${currentYear}-12-31`,
      annualDays,
      carryIn,
      usage: previousYearUsage,
      yearHasAnyRecords: yearsWithRecords.has(currentYear),
      carryExpiryEnabled: input.carryExpiryEnabled,
      carryExpiryDate: input.carryExpiryDate,
      carryExpiryNotified: input.carryExpiryNotified ?? false,
      applyExpiry: yearsWithRecords.has(currentYear),
    });
    carryIn = simulation.carryOut;
  }

  const currentUsage = groupedUsage.get(input.year) ?? [];
  const currentSimulation = simulateYear({
    year: input.year,
    asOfIso: asOfDate && asOfDate.startsWith(`${input.year}-`) ? asOfDate : `${input.year}-12-31`,
    annualDays,
    carryIn,
    usage: currentUsage,
    yearHasAnyRecords: yearsWithRecords.has(input.year),
    carryExpiryEnabled: input.carryExpiryEnabled,
    carryExpiryDate: input.carryExpiryDate,
    carryExpiryNotified: input.carryExpiryNotified ?? false,
    applyExpiry: true,
  });

  const consumedFromCarry = Math.min(currentSimulation.carryRemaining, openingTakenDays);
  const carryRemainingAfterOpening = roundTwo(
    Math.max(currentSimulation.carryRemaining - consumedFromCarry, 0)
  );
  const openingRemainder = roundTwo(Math.max(openingTakenDays - consumedFromCarry, 0));
  const annualRemainingAfterOpening = roundTwo(
    Math.max(currentSimulation.annualRemaining - openingRemainder, 0)
  );
  const takenDays = roundTwo(currentSimulation.taken + openingTakenDays);

  return {
    annualDays,
    carryStartDays: roundTwo(Math.max(currentSimulation.carryIn, 0)),
    takenDays,
    carryRemainingDays: carryRemainingAfterOpening,
    annualRemainingDays: annualRemainingAfterOpening,
    remainingDays: roundTwo(
      Math.max(carryRemainingAfterOpening + annualRemainingAfterOpening, 0)
    ),
  };
}
