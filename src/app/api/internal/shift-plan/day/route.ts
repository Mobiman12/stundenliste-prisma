import { NextResponse } from 'next/server';

import { getPrisma } from '@/lib/prisma';
import { saveShiftPlanDay } from '@/lib/services/shift-plan';
import { recomputeEmployeeOvertime } from '@/lib/services/time-entry';

function assertSecret(headers: Headers) {
  const secret = process.env.PROVISION_SECRET;
  const incoming = headers.get('x-provision-secret');
  return Boolean(secret && incoming && incoming === secret);
}

async function resolveEmployeeId(
  prisma: ReturnType<typeof getPrisma>,
  tenantId: string,
  input: { employeeId: number | null; staffOrPersonnelNumber: string }
): Promise<number | null> {
  // Always verify tenant ownership when an employeeId is provided.
  if (input.employeeId && input.employeeId > 0) {
    const row = await prisma.employee.findFirst({
      where: { tenantId, id: input.employeeId },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  const key = input.staffOrPersonnelNumber.trim();
  if (!key) return null;

  // Control Plane calls Timesheet with StaffMember.id (cmj...) as "personnelNumber" (legacy naming).
  // We must resolve both:
  // - controlPlaneStaffId (preferred)
  // - personnelNumber (legacy)
  const row = await prisma.employee.findFirst({
    where: {
      tenantId,
      OR: [{ controlPlaneStaffId: key }, { personnelNumber: key }],
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  return row?.id ?? null;
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
  const employeeIdCandidate = Number.isFinite(employeeIdRaw) ? employeeIdRaw : null;

  if (!tenantId || !isoDate) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  const prisma = getPrisma();
  const employeeId = await resolveEmployeeId(prisma, tenantId, {
    employeeId: employeeIdCandidate,
    staffOrPersonnelNumber: personnelNumber,
  });

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
      segmentIndex:
        body?.segmentIndex === null || body?.segmentIndex === undefined
          ? null
          : Number(body.segmentIndex),
      mode: body?.mode === 'unavailable' ? 'unavailable' : 'available',
    });
    await recomputeEmployeeOvertime(tenantId, employeeId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('shift-plan/day failed', error);
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 });
  }
}
