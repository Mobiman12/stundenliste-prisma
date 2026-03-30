import { calculateIstHours } from '@/lib/services/time-calculations';

export interface DailyOvertimeInput {
  id?: number;
  dayDate: string;
  code?: string | null;
  kommt1?: string | null;
  geht1?: string | null;
  kommt2?: string | null;
  geht2?: string | null;
  pause?: string | null;
  schicht?: string | null;
  brutto?: number | null;
  planHours?: number | null;
  sickHours?: number | null;
  childSickHours?: number | null;
  shortWorkHours?: number | null;
  vacationHours?: number | null;
  holidayHours?: number | null;
  overtimeDelta?: number | null;
  forcedOverflow?: number | null;
}

export interface EmployeeOvertimeSettings {
  maxMinusHours: number;
  maxOvertimeHours: number;
}

export interface PlanHoursProvider {
  (entry: DailyOvertimeInput): number;
}

export interface OvertimeComputationOptions {
  planHoursProvider?: PlanHoursProvider;
}

export interface RecalculatedDay {
  id?: number;
  dayDate: string;
  planHours: number;
  overtimeDelta: number;
  forcedOverflow: number;
  sickHours: number;
  childSickHours: number;
  shortWorkHours: number;
  vacationHours: number;
  netHours: number;
  rawHours: number;
  effectivePauseHours: number;
}

export interface RecalculateOvertimeResult {
  updatedDays: RecalculatedDay[];
  balanceHours: number;
  payoutBankHours: number;
}

const FLOAT_TOLERANCE = 0.0001;

function toNumber(value: number | string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const num = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (Number.isFinite(num)) {
    return num;
  }
  return fallback;
}

function almostEqual(a: number, b: number, tolerance = FLOAT_TOLERANCE): boolean {
  return Math.abs(a - b) <= tolerance;
}

export function recalculateOvertime(
  entries: DailyOvertimeInput[],
  settings: EmployeeOvertimeSettings,
  options: OvertimeComputationOptions = {}
): RecalculateOvertimeResult {
  const sortedEntries = [...entries].sort((a, b) => a.dayDate.localeCompare(b.dayDate));
  const updatedDays: RecalculatedDay[] = [];

  let currentBalance = 0;
  let payoutSaldo = 0;

  for (const entry of sortedEntries) {
    const planHoursFromRow = toNumber(entry.planHours, 0);
    const planHours =
      planHoursFromRow > 0
        ? planHoursFromRow
        : options.planHoursProvider
        ? Math.max(options.planHoursProvider(entry), 0)
        : 0;

    const code = (entry.code ?? '').trim().toUpperCase();
    const pauseValue = entry.pause ?? 'Keine';

    const ist = calculateIstHours(entry.kommt1 ?? '', entry.geht1 ?? '', entry.kommt2 ?? '', entry.geht2 ?? '', pauseValue);
    const actualNetHours = ist.netHours;

    let storePlan = planHours;
    let deltaPlan = planHours;
    let netWorked = actualNetHours;

    let newSickHours = toNumber(entry.sickHours, 0);
    let newChildSickHours = toNumber(entry.childSickHours, 0);
    let newShortWorkHours = toNumber(entry.shortWorkHours, 0);
    let newVacationHours = toNumber(entry.vacationHours, 0);

    const holidayHours = toNumber(entry.holidayHours, 0);

    switch (code) {
      case 'U':
        netWorked = storePlan;
        deltaPlan = storePlan;
        newVacationHours = storePlan;
        break;
      case 'UH': {
        const halfPlan = storePlan / 2;
        deltaPlan = Math.max(storePlan - halfPlan, 0);
        newVacationHours = halfPlan;
        break;
      }
      case 'K':
        netWorked = storePlan;
        deltaPlan = storePlan;
        newSickHours = storePlan;
        break;
      case 'KK':
        netWorked = storePlan;
        deltaPlan = storePlan;
        newChildSickHours = storePlan;
        break;
      case 'KR':
        netWorked = storePlan;
        deltaPlan = storePlan;
        newSickHours = Math.max(storePlan - actualNetHours, 0);
        break;
      case 'KKR':
        netWorked = storePlan;
        deltaPlan = storePlan;
        newChildSickHours = Math.max(storePlan - actualNetHours, 0);
        break;
      case 'KU':
        {
          const shortWorkPlan = Math.max(toNumber(entry.shortWorkHours, 0), planHours);
          newShortWorkHours = shortWorkPlan;
          netWorked = 0;
          deltaPlan = 0;
          storePlan = 0;
        }
        break;
      case 'FT':
        if (holidayHours > 0) {
          netWorked = storePlan;
          deltaPlan = storePlan;
        }
        break;
      case 'UBF':
        netWorked = 0;
        storePlan = 0;
        deltaPlan = 0;
        break;
      default:
        break;
    }

    const delta = netWorked - deltaPlan;
    let forced = 0;
    let overtimeDelta = 0;

    if (delta > FLOAT_TOLERANCE) {
      const room = Math.max(0, settings.maxOvertimeHours - currentBalance);
      const usedForBalance = Math.min(room, delta);
      forced = Math.max(0, delta - room);
      currentBalance += usedForBalance;
      payoutSaldo += forced;
      overtimeDelta = usedForBalance;
    } else if (delta < -FLOAT_TOLERANCE) {
      const needed = Math.abs(delta);
      const fromPayout = Math.min(payoutSaldo, needed);
      payoutSaldo -= fromPayout;
      const remaining = needed - fromPayout;
      const allowedMinus = currentBalance + settings.maxMinusHours;
      const fromBalance = Math.min(allowedMinus, remaining);
      currentBalance -= fromBalance;
      overtimeDelta = fromBalance > 0 ? -fromBalance : 0;
      forced = fromPayout > 0 ? -fromPayout : 0;
      if (currentBalance < -settings.maxMinusHours - FLOAT_TOLERANCE) {
        throw new Error('Minusstunden-Limit überschritten');
      }
    } else {
      forced = 0;
      overtimeDelta = 0;
    }

    const previousOvertime = toNumber(entry.overtimeDelta, 0);
    const previousForced = toNumber(entry.forcedOverflow, 0);
    const previousPlan = planHoursFromRow;

    const updates: RecalculatedDay = {
      id: entry.id,
      dayDate: entry.dayDate,
      planHours: storePlan,
      overtimeDelta,
      forcedOverflow: forced,
      sickHours: newSickHours,
      childSickHours: newChildSickHours,
      shortWorkHours: newShortWorkHours,
      vacationHours: newVacationHours,
      netHours: netWorked,
      rawHours: ist.rawHours,
      effectivePauseHours: ist.effectivePauseHours,
    };

    const changed =
      !almostEqual(previousOvertime, overtimeDelta) ||
      !almostEqual(previousForced, forced) ||
      !almostEqual(previousPlan, storePlan) ||
      !almostEqual(toNumber(entry.sickHours, 0), newSickHours) ||
      !almostEqual(toNumber(entry.childSickHours, 0), newChildSickHours) ||
      !almostEqual(toNumber(entry.shortWorkHours, 0), newShortWorkHours) ||
      !almostEqual(toNumber(entry.vacationHours, 0), newVacationHours);

    if (changed) {
      updatedDays.push(updates);
    }
  }

  const clampedBalance = Math.min(Math.max(currentBalance, -settings.maxMinusHours), settings.maxOvertimeHours);

  return {
    updatedDays,
    balanceHours: clampedBalance,
    payoutBankHours: payoutSaldo,
  };
}
