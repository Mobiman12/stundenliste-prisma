import { NextResponse } from 'next/server';

import { fetchTillhubStaffOverview } from '@/lib/services/tillhub';

function isAuthorized(request: Request): boolean {
  const expected = process.env.INTEGRATION_API_KEY?.trim();
  if (!expected) return false;
  const provided =
    request.headers.get('x-api-key')?.trim() ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  return Boolean(provided && provided === expected);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const start = searchParams.get('start') ?? searchParams.get('from');
  const end = searchParams.get('end') ?? searchParams.get('to');
  const accountId = searchParams.get('account') ?? undefined;
  const tenantId = searchParams.get('tenantId')?.trim() || null;

  try {
    const data = await fetchTillhubStaffOverview({ start, end, accountId, tenantId });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[tillhub] failed to fetch staff overview', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unexpected error while fetching Tillhub data.',
      },
      { status: 500 }
    );
  }
}
