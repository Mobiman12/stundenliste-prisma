import { NextResponse } from 'next/server';

import { getPrisma } from '@/lib/prisma';
import { clearShiftPlanRange } from '@/lib/services/shift-plan';
import { recomputeEmployeeOvertime } from '@/lib/services/time-entry';

function assertSecret(headers: Headers) {
  const secret = process.env.PROVISION_SECRET;
  const incoming = headers.get('x-provision-secret');
  return Boolean(secret && incoming && incoming === secret);
}

function addDays(source: Date, days: number): Date {
  const next = new Date(source);
  next.setDate(next.getDate() + days);
  return next;
}

function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export async function POST(req: Request) {
  if (!assertSecret(req.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const tenantId = typeof body?.tenantId === 'string' ? body.tenantId.trim() : '';
  const weekStartRaw = typeof body?.weekStart === 'string' ? body.weekStart.trim() : '';
  const employeeIdRaw = Number(body?.employeeId);
  const personnelNumber =
    typeof body?.personnelNumber === 'string'
      ? body.personnelNumber.trim()
      : typeof body?.staffId === 'string'
        ? body.staffId.trim()
        : '';
  let employeeId = Number.isFinite(employeeIdRaw) ? employeeIdRaw : null;

  if (!tenantId || !weekStartRaw) {
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

  const weekStartDate = new Date(`${weekStartRaw}T00:00:00`);
  if (Number.isNaN(weekStartDate.getTime())) {
    return NextResponse.json({ error: 'invalid weekStart' }, { status: 400 });
  }

  const weekEndDate = addDays(weekStartDate, 6);

  try {
    await clearShiftPlanRange(employeeId, formatIsoDate(weekStartDate), formatIsoDate(weekEndDate));
  } catch (error) {
    console.error('shift-plan/clear-week failed', error);
    return NextResponse.json({ ok: false, error: 'clear_failed' }, { status: 500 });
  }

  try {
    await recomputeEmployeeOvertime(tenantId, employeeId);
  } catch (error) {
    console.error('shift-plan/clear-week recompute failed', error);
    return NextResponse.json({ ok: true, warning: 'overtime_failed' });
  }
  return NextResponse.json({ ok: true });
}
