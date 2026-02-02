import { NextResponse } from 'next/server';

import { getPrisma } from '@/lib/prisma';
import { saveShiftPlanDay } from '@/lib/services/shift-plan';
import { recomputeEmployeeOvertime } from '@/lib/services/time-entry';

function assertSecret(headers: Headers) {
  const secret = process.env.PROVISION_SECRET;
  const incoming = headers.get('x-provision-secret');
  return Boolean(secret && incoming && incoming === secret);
}

export async function POST(req: Request) {
  if (!assertSecret(req.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const tenantId = typeof body?.tenantId === 'string' ? body.tenantId.trim() : '';
  const isoDate = typeof body?.isoDate === 'string' ? body.isoDate.trim() : '';
  const employeeIdRaw = Number(body?.employeeId);
  const personnelNumber =
    typeof body?.personnelNumber === 'string'
      ? body.personnelNumber.trim()
      : typeof body?.staffId === 'string'
        ? body.staffId.trim()
        : '';
  let employeeId = Number.isFinite(employeeIdRaw) ? employeeIdRaw : null;

  if (!tenantId || !isoDate) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  if (!employeeId && personnelNumber) {
    const prisma = getPrisma();
    const row = await prisma.employee.findUnique({
      where: { tenantId_personnelNumber: { tenantId, personnelNumber } },
      select: { id: true },
    });
    employeeId = row?.id ?? null;
  }

  if (!employeeId || employeeId <= 0) {
    return NextResponse.json({ error: 'employee not found' }, { status: 404 });
  }

  try {
    await saveShiftPlanDay(tenantId, employeeId, {
      isoDate,
      start: body?.start ?? null,
      end: body?.end ?? null,
      requiredPauseMinutes: body?.pause ?? 0,
      label: body?.label ?? null,
      branchId: body?.branchId ?? null,
    });
    await recomputeEmployeeOvertime(tenantId, employeeId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('shift-plan/day failed', error);
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 });
  }
}
