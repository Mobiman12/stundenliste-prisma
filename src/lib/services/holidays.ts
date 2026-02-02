import Holidays from 'date-holidays';

export { FEDERAL_STATE_OPTIONS, type GermanFederalStateCode } from '@/lib/constants/federal-states';

const DEFAULT_COUNTRY = 'DE';
const COUNTRY_CODES = new Set(['DE', 'AT', 'CH']);

const holidayCache = new Map<string, Holidays>();

function toCacheKey(countryCode: string, stateCode: string | null | undefined): string {
  return `${countryCode.toLowerCase()}:${stateCode ? stateCode.toLowerCase() : 'national'}`;
}

function splitStateCode(stateCode: string | null | undefined): { country: string; state: string | null } {
  if (!stateCode) {
    return { country: DEFAULT_COUNTRY, state: null };
  }
  const trimmed = stateCode.trim();
  if (!trimmed) {
    return { country: DEFAULT_COUNTRY, state: null };
  }
  const upper = trimmed.toUpperCase();
  if (COUNTRY_CODES.has(upper)) {
    return { country: upper, state: null };
  }
  const [countryPart, statePart] = upper.split('-');
  if (!statePart) {
    return { country: DEFAULT_COUNTRY, state: countryPart.toLowerCase() };
  }
  return {
    country: countryPart || DEFAULT_COUNTRY,
    state: statePart.toLowerCase(),
  };
}

export function normalizeHolidayRegion(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (upper.includes('-')) {
    return upper;
  }
  if (COUNTRY_CODES.has(upper)) {
    return upper;
  }
  return `DE-${upper}`;
}

function resolveHolidays(countryCode: string, stateCode: string | null | undefined): Holidays {
  const cacheKey = toCacheKey(countryCode, stateCode);
  const cached = holidayCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const hd = stateCode ? new Holidays(countryCode, stateCode.toLowerCase()) : new Holidays(countryCode);

  holidayCache.set(cacheKey, hd);
  return hd;
}

function pickPublicHoliday(entry: ReturnType<Holidays['isHoliday']>): { name: string } | null {
  if (!entry) return null;
  const list = Array.isArray(entry) ? entry : [entry];
  const match = list.find((item) => item && item.type === 'public');
  return match ? { name: match.name } : null;
}

export function isHolidayIsoDate(isoDate: string, stateCode?: string | null): { isHoliday: boolean; name?: string } {
  const { country, state } = splitStateCode(stateCode);
  const hd = resolveHolidays(country, state);
  const date = new Date(`${isoDate}T00:00:00`);
  const stateHoliday = pickPublicHoliday(hd.isHoliday(date));
  if (stateHoliday) {
    return { isHoliday: true, name: stateHoliday.name };
  }

  if (stateCode) {
    const nationalHd = resolveHolidays(country, null);
    const nationalHoliday = pickPublicHoliday(nationalHd.isHoliday(date));
    if (nationalHoliday) {
      return { isHoliday: true, name: nationalHoliday.name };
    }
  }

  return { isHoliday: false };
}
