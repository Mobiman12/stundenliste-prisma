import { NextResponse } from 'next/server';

import { getServerAuthSession } from '@/lib/auth/session';
import { createPayrollExportFile, type PayrollExportFormat } from '@/lib/services/admin/monthly-closing-export';

const SUPPORTED_FORMATS: PayrollExportFormat[] = ['csv', 'xlsx', 'pdf'];

function parseYearMonth(value: string | null, min: number, max: number): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < min || parsed > max) return null;
  return parsed;
}

function parseEmployeeIds(searchParams: URLSearchParams): number[] {
  const merged = searchParams.getAll('employeeIds').join(',');
  if (!merged.trim()) return [];
  return Array.from(
    new Set(
      merged
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  );
}

export async function GET(request: Request) {
  const session = await getServerAuthSession();
  if (!session?.user || !session.tenantId) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (session.user.roleId !== 2) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(request.url);
  const year = parseYearMonth(url.searchParams.get('year'), 2020, 2100);
  const month = parseYearMonth(url.searchParams.get('month'), 1, 12);
  const formatParam = (url.searchParams.get('format') ?? 'xlsx').trim().toLowerCase();
  const selectedEmployeeIds = parseEmployeeIds(url.searchParams);

  if (!year || !month) {
    return NextResponse.json({ ok: false, error: 'invalid_year_month' }, { status: 400 });
  }

  if (!SUPPORTED_FORMATS.includes(formatParam as PayrollExportFormat)) {
    return NextResponse.json({ ok: false, error: 'invalid_format' }, { status: 400 });
  }

  try {
    const file = await createPayrollExportFile(
      session.tenantId,
      year,
      month,
      formatParam as PayrollExportFormat,
      selectedEmployeeIds
    );

    return new NextResponse(new Uint8Array(file.body), {
      status: 200,
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[monthly-closing-export] failed', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'export_failed',
      },
      { status: 500 }
    );
  }
}
