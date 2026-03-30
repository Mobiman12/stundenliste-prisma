import { FEDERAL_STATE_OPTIONS, type GermanFederalStateCode } from '@/lib/constants/federal-states';

export const COUNTRY_OPTIONS = [
  { code: 'DE', label: 'Deutschland' },
  { code: 'AT', label: 'Österreich' },
  { code: 'CH', label: 'Schweiz' },
] as const;

export type CountryCode = (typeof COUNTRY_OPTIONS)[number]['code'];

const COUNTRY_SET = new Set<string>(COUNTRY_OPTIONS.map((option) => option.code));

export const DEFAULT_TIMEZONE_BY_COUNTRY: Record<CountryCode, string> = {
  DE: 'Europe/Berlin',
  AT: 'Europe/Vienna',
  CH: 'Europe/Zurich',
};

export function normalizeCountry(value: string | null | undefined): CountryCode {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return (COUNTRY_SET.has(raw) ? raw : 'DE') as CountryCode;
}

export function getFederalStateOptions(country: CountryCode) {
  return FEDERAL_STATE_OPTIONS.filter((option) => option.code.startsWith(`${country}-`));
}

export function normalizeFederalState(country: CountryCode, value: string | null | undefined): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  const options = getFederalStateOptions(country);
  return options.some((option) => option.code === raw) ? raw : null;
}

export function getDefaultTimezone(country: CountryCode): string {
  return DEFAULT_TIMEZONE_BY_COUNTRY[country] ?? DEFAULT_TIMEZONE_BY_COUNTRY.DE;
}

const GERMAN_POSTAL_PREFIX_RANGES: Array<{
  start: number;
  end: number;
  state: GermanFederalStateCode;
}> = [
  { start: 1, end: 5, state: 'DE-SN' },
  { start: 6, end: 6, state: 'DE-ST' },
  { start: 7, end: 7, state: 'DE-TH' },
  { start: 8, end: 9, state: 'DE-SN' },
  { start: 10, end: 12, state: 'DE-BE' },
  { start: 13, end: 16, state: 'DE-BB' },
  { start: 17, end: 19, state: 'DE-MV' },
  { start: 20, end: 22, state: 'DE-HH' },
  { start: 23, end: 25, state: 'DE-SH' },
  { start: 26, end: 27, state: 'DE-NI' },
  { start: 28, end: 28, state: 'DE-HB' },
  { start: 29, end: 31, state: 'DE-NI' },
  { start: 32, end: 33, state: 'DE-NW' },
  { start: 34, end: 36, state: 'DE-HE' },
  { start: 37, end: 38, state: 'DE-NI' },
  { start: 39, end: 39, state: 'DE-ST' },
  { start: 40, end: 53, state: 'DE-NW' },
  { start: 54, end: 56, state: 'DE-RP' },
  { start: 57, end: 59, state: 'DE-NW' },
  { start: 60, end: 65, state: 'DE-HE' },
  { start: 66, end: 66, state: 'DE-SL' },
  { start: 67, end: 67, state: 'DE-RP' },
  { start: 68, end: 79, state: 'DE-BW' },
  { start: 80, end: 87, state: 'DE-BY' },
  { start: 88, end: 88, state: 'DE-BW' },
  { start: 90, end: 97, state: 'DE-BY' },
  { start: 98, end: 99, state: 'DE-TH' },
];

export function resolveFederalStateByPostalCode(
  country: CountryCode,
  postalCode: string | null | undefined
): GermanFederalStateCode | null {
  if (country !== 'DE') return null;
  const digits = String(postalCode ?? '').replace(/\D/g, '');
  if (digits.length < 2) return null;
  const prefix = Number(digits.slice(0, 2));
  if (!Number.isFinite(prefix)) return null;

  if (prefix === 89 && digits.length >= 3) {
    const prefix3 = Number(digits.slice(0, 3));
    if (Number.isFinite(prefix3) && prefix3 >= 892 && prefix3 <= 896) {
      return 'DE-BY';
    }
    return 'DE-BW';
  }

  for (const range of GERMAN_POSTAL_PREFIX_RANGES) {
    if (prefix >= range.start && prefix <= range.end) {
      return range.state;
    }
  }
  return null;
}
