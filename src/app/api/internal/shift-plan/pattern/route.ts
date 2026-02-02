import { NextResponse } from 'next/server';

import { getPrisma } from '@/lib/prisma';
import { saveShiftPlanDaySegments } from '@/lib/services/shift-plan';
import { recomputeEmployeeOvertime } from '@/lib/services/time-entry';

function assertSecret(headers: Headers) {
  const secret = process.env.PROVISION_SECRET;
  const incoming = headers.get('x-provision-secret');
  return Boolean(secret && incoming && incoming === secret);
}

type WeekPatternPayload = {
  weekStart: string;
  employees: Array<number | string>;
  days: Array<{
    isoDate: string;
    segments?: Array<{
      mode?: 'available' | 'unavailable';
      start?: string | null;
      end?: string | null;
      pause?: number | null;
      label?: string | null;
      branchId?: number | null;
    }>;
    mode?: 'available' | 'unavailable';
    start?: string | null;
    end?: string | null;
    pause?: number | null;
    label?: string | null;
    branchId?: number | null;
  }>;
};

const NO_WORK_LABEL = 'Kein Arbeitstag';
const NO_WORK_LABEL_LOWER = NO_WORK_LABEL.toLowerCase();
const isNoWorkLabel = (label: string | null | undefined): boolean =>
  (label ?? '').trim().toLowerCase() === NO_WORK_LABEL_LOWER;

export async function POST(req: Request) {
  if (!assertSecret(req.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const tenantId = typeof body?.tenantId === 'string' ? body.tenantId.trim() : '';
  const payload = body?.payload as WeekPatternPayload | undefined;

  if (!tenantId || !payload) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  const weekStart = (payload.weekStart ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return NextResponse.json({ error: 'invalid weekStart' }, { status: 400 });
  }

  const rawEmployeeIds = Array.isArray(payload.employees) ? payload.employees : [];
  const employeeIds = rawEmployeeIds
    .map((id) => (typeof id === 'string' ? Number.parseInt(id, 10) : Number(id)))
    .filter((id) => Number.isFinite(id) && id > 0);

  const personnelNumbers = rawEmployeeIds
    .filter((id) => typeof id === 'string')
    .map((id) => String(id).trim())
    .filter(Boolean);

  if (personnelNumbers.length) {
    const prisma = getPrisma();
    const rows = await prisma.employee.findMany({
      where: { tenantId, personnelNumber: { in: personnelNumbers } },
      select: { id: true },
    });
    for (const row of rows) {
      employeeIds.push(row.id);
    }
  }

  if (!employeeIds.length) {
    return NextResponse.json({ error: 'employees required' }, { status: 400 });
  }

  const days = Array.isArray(payload.days) ? payload.days : [];
  if (!days.length) {
    return NextResponse.json({ error: 'days required' }, { status: 400 });
  }

  try {
    const affectedEmployees = new Set<number>();
    for (const employeeId of employeeIds) {
      for (const day of days) {
        const isoDate = (day.isoDate ?? '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
          continue;
        }

        const rawSegments = Array.isArray(day.segments) ? day.segments : [];
        const hasLegacyPayload = Boolean(
          day.mode || day.start || day.end || day.label || day.pause !== undefined
        );
        const combinedSegments = rawSegments.length
          ? rawSegments
          : hasLegacyPayload
            ? [
                {
                  mode: day.mode,
                  start: day.start ?? null,
                  end: day.end ?? null,
                  pause: day.pause ?? null,
                  label: day.label ?? null,
                  branchId: day.branchId ?? null,
                },
              ]
            : [];

        const normalizedSegments = combinedSegments
          .map((segment, index) => {
            const labelTrimmed = typeof segment.label === 'string' ? segment.label.trim() : '';
            const mode = segment.mode === 'unavailable' ? 'unavailable' : 'available';
            const noWorkDay = mode === 'unavailable' && isNoWorkLabel(labelTrimmed);
            const startValue = !noWorkDay && typeof segment.start === 'string' ? segment.start.trim() : null;
            const endValue = !noWorkDay && typeof segment.end === 'string' ? segment.end.trim() : null;
            const pauseNumeric = Number(segment.pause ?? 0);
            const pauseValue = !noWorkDay && Number.isFinite(pauseNumeric) ? pauseNumeric : 0;
            const labelValue = labelTrimmed || null;
            const branchValue = Number(segment.branchId ?? 0);
            const branchId = Number.isFinite(branchValue) && branchValue > 0 ? branchValue : null;

            return {
              segmentIndex: index,
              mode,
              start: startValue && startValue.length ? startValue : null,
              end: endValue && endValue.length ? endValue : null,
              requiredPauseMinutes: pauseValue,
              label: labelValue,
              branchId,
            };
          })
          .filter((segment) => {
            const hasTimes = Boolean(segment.start || segment.end);
            const hasLabel = Boolean(segment.label);
            return hasTimes || hasLabel || segment.requiredPauseMinutes > 0;
          });

        await saveShiftPlanDaySegments(tenantId, employeeId, {
          isoDate,
          segments: normalizedSegments,
        });
      }
      affectedEmployees.add(employeeId);
    }

    for (const id of affectedEmployees) {
      try {
        await recomputeEmployeeOvertime(tenantId, id);
      } catch (error) {
        console.error('shift-plan/pattern recompute failed', error);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('shift-plan/pattern failed', error);
    return NextResponse.json({ ok: false, error: 'pattern_failed' }, { status: 500 });
  }
}
