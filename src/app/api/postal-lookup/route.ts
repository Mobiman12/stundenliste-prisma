import { NextRequest } from 'next/server';

import { lookupPostal } from '@/lib/postal-data';
import { normalizeCountry } from '@/lib/region-options';

export function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const country = normalizeCountry(searchParams.get('country'));
  const postalCode = searchParams.get('postalCode');
  const result = lookupPostal(country, postalCode);
  return Response.json(result ?? { city: null, cities: [] });
}
