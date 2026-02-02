export interface ParsedTime {
  hour: number;
  minute: number;
}

/**
 * Parses a string in HH:MM format.
 * Returns null when format invalid.
 */
export function parseTimeString(value: string | null | undefined): ParsedTime | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':');
  if (parts.length !== 2) return null;
  const [hh, mm] = parts;
  const hours = Number.parseInt(hh, 10);
  const minutes = Number.parseInt(mm, 10);
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }
  return { hour: hours, minute: minutes };
}

export function timeToDecimalHours(time: ParsedTime | null): number {
  if (!time) return 0;
  return time.hour + time.minute / 60;
}

export function pauseStringToHours(value: string | null | undefined): number {
  if (!value) return 0;
  const normalized = value.trim().toLowerCase();
  if (!normalized || ['keine', '0', '0min', '0min.', '0 min', '0 minuten'].includes(normalized)) {
    return 0;
  }
  const digits = normalized
    .split('')
    .filter((char) => /\d/.test(char))
    .join('');
  if (!digits) {
    return 0;
  }
  const minutes = Number.parseInt(digits, 10);
  if (Number.isNaN(minutes)) {
    return 0;
  }
  const clamped = Math.min(Math.max(minutes, 0), 180);
  return clamped / 60;
}

export function pauseStringToMinutes(value: string | null | undefined): number {
  return pauseStringToHours(value) * 60;
}

export function calculateLegalPauseHours(totalRawHours: number): number {
  if (totalRawHours > 9) {
    return 0.75;
  }
  if (totalRawHours > 6) {
    return 0.5;
  }
  return 0;
}

export interface IstCalculationResult {
  netHours: number;
  rawHours: number;
  effectivePauseHours: number;
}

function spanHours(start: string | null | undefined, end: string | null | undefined): number {
  const startTime = parseTimeString(start ?? undefined);
  const endTime = parseTimeString(end ?? undefined);
  if (!startTime || !endTime) {
    return 0;
  }
  let diff = timeToDecimalHours(endTime) - timeToDecimalHours(startTime);
  if (diff < 0) {
    diff += 24;
  }
  return Math.max(diff, 0);
}

export function calculateIstHours(
  kommt1: string | null | undefined,
  geht1: string | null | undefined,
  kommt2: string | null | undefined,
  geht2: string | null | undefined,
  pause: string | null | undefined
): IstCalculationResult {
  const totalRaw = spanHours(kommt1, geht1) + spanHours(kommt2, geht2);
  const legalPause = calculateLegalPauseHours(totalRaw);
  const manualPause = pauseStringToHours(pause);
  const effectivePause = Math.max(legalPause, manualPause);
  const net = Math.max(totalRaw - effectivePause, 0);

  return {
    netHours: Number(net.toFixed(2)),
    rawHours: Number(totalRaw.toFixed(2)),
    effectivePauseHours: Number(effectivePause.toFixed(2)),
  };
}

export function calcHoursLegalGermany(start: ParsedTime | null, end: ParsedTime | null): number {
  const raw = Math.max(timeToDecimalHours(end) - timeToDecimalHours(start), 0);
  const pause = calculateLegalPauseHours(raw);
  return Math.max(raw - pause, 0);
}
