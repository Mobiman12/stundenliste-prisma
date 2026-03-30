import { NextResponse } from 'next/server';

import { getServerAuthSession } from '@/lib/auth/session';
import { fetchTillhubDailyGrossForStaff } from '@/lib/services/tillhub';

export async function GET(request: Request) {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  const staffId = searchParams.get('tillhubUserId')?.trim();
  const accountId = searchParams.get('account');

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ success: false, error: 'Ungültiges Datum.' }, { status: 400 });
  }

  if (!staffId) {
    return NextResponse.json({ success: false, error: 'Kein Tillhub-User hinterlegt.' }, { status: 400 });
  }

  try {
    const { gross } = await fetchTillhubDailyGrossForStaff({
      staffId,
      date,
      accountId: accountId ?? undefined,
      tenantId: session.tenantId ?? null,
    });
    return NextResponse.json({ success: true, gross });
  } catch (error) {
    console.error('[tillhub] daily fetch failed', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Tillhub-Anfrage fehlgeschlagen.',
      },
      { status: 500 }
    );
  }
}
