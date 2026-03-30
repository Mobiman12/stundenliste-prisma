import { NextResponse } from 'next/server';

import { getServerAuthSession } from '@/lib/auth/session';
import { getEmployeeById } from '@/lib/data/employees';
import { listBranchesForEmployee } from '@/lib/data/branches';
import { isHolidayIsoDate, normalizeHolidayRegion } from '@/lib/services/holidays';

export async function GET(request: Request) {
  const session = await getServerAuthSession();
  if (!session?.user?.employeeId) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const tenantId = session.tenantId;
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const isoDate = (url.searchParams.get('date') ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return NextResponse.json({ ok: false, error: 'invalid_date' }, { status: 400 });
  }

  const employee = await getEmployeeById(tenantId, session.user.employeeId);
  if (!employee) {
    return NextResponse.json({ ok: false, error: 'employee_not_found' }, { status: 404 });
  }

  const branches = await listBranchesForEmployee(tenantId, session.user.employeeId);
  const regions = Array.from(
    new Set(
      branches
        .map((branch) => normalizeHolidayRegion(branch.federalState ?? branch.country ?? null))
        .filter((value): value is string => Boolean(value))
    )
  );
  const region = regions.length === 1 ? regions[0] : null;
  if (!region) {
    return NextResponse.json({ ok: true, isHoliday: false, name: null });
  }

  const holiday = isHolidayIsoDate(isoDate, region);
  return NextResponse.json({
    ok: true,
    isHoliday: holiday.isHoliday,
    name: holiday.isHoliday ? holiday.name ?? null : null,
  });
}
