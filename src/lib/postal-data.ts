import 'server-only';

import fs from 'fs';
import path from 'path';

import type { CountryCode } from '@/lib/region-options';

type PostalLookup = {
  city: string | null;
  cities: string[];
};

type PostalData = Record<CountryCode, Record<string, string[]>>;

let cachedData: PostalData | null = null;

function loadPostalData(): PostalData {
  if (cachedData) return cachedData;
  const filePath = path.join(process.cwd(), 'data', 'postal', 'postal-data.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  cachedData = JSON.parse(raw) as PostalData;
  return cachedData;
}

function normalizePostalCode(value: string | null | undefined): string | null {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits.length) return null;
  return digits;
}

function normalizePostalCodeForCountry(
  country: CountryCode,
  value: string | null | undefined
): string | null {
  const digits = normalizePostalCode(value);
  if (!digits) return null;
  const targetLength = country === 'DE' ? 5 : 4;
  if (digits.length < targetLength) {
    return digits.padStart(targetLength, '0');
  }
  return digits;
}

export function lookupPostal(country: CountryCode, postalCode: string | null | undefined): PostalLookup | null {
  const digits = normalizePostalCodeForCountry(country, postalCode);
  if (!digits) return null;
  const data = loadPostalData();
  let cities = data[country]?.[digits] ?? [];
  if (!cities.length) {
    const fallback = normalizePostalCode(postalCode);
    if (fallback && fallback !== digits) {
      cities = data[country]?.[fallback] ?? [];
    }
  }
  return { cities, city: cities[0] ?? null };
}
