import { NextResponse } from 'next/server';

import { getPrisma } from '@/lib/prisma';
import { calculateLegalPauseHours } from '@/lib/services/time-calculations';
import { saveShiftPlanDay, listWeeklyShiftTemplates } from '@/lib/services/shift-plan';
import { recomputeEmployeeOvertime } from '@/lib/services/time-entry';

function assertSecret(headers: Headers) {
  const secret = process.env.PROVISION_SECRET;
  const incoming = headers.get('x-provision-secret');
  return Boolean(secret && incoming && incoming === secret);
}

const NO_WORK_LABEL = 'Kein Arbeitstag';
const NO_WORK_LABEL_LOWER = NO_WORK_LABEL.toLowerCase();
const isNoWorkLabel = (label: string | null | undefined): boolean =>
  (label ?? '').trim().toLowerCase() === NO_WORK_LABEL_LOWER;

function sanitizeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    return trimmed.padStart(5, '0');
  }
  return trimmed;
}

function parseTimeToDecimalHours(value: string | null): number | null {
  if (!value) return null;
  const parts = value.split(':');
  if (parts.length !== 2) return null;
  const hours = Number.parseInt(parts[0] ?? '', 10);
  const minutes = Number.parseInt(parts[1] ?? '', 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  const total = hours + minutes / 60;
  return Number.isFinite(total) ? total : null;
}

export async function POST(req: Request) {
  if (!assertSecret(req.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const tenantId = typeof body?.tenantId === 'string' ? body.tenantId.trim() : '';
  const employeeIdRaw = Number(body?.employeeId);
  const personnelNumber =
    typeof body?.personnelNumber === 'string'
      ? body.personnelNumber.trim()
      : typeof body?.staffId === 'string'
        ? body.staffId.trim()
        : '';
  const weekStartRaw = typeof body?.weekStart === 'string' ? body.weekStart.trim() : '';
  const templateId = Number(body?.templateId);
  const labelOverride = typeof body?.label === 'string' ? body.label.trim() : '';
  const branchRaw = body?.branchId;
  let employeeId = Number.isFinite(employeeIdRaw) ? employeeIdRaw : null;

  if (
    !tenantId ||
    !/^\d{4}-\d{2}-\d{2}$/.test(weekStartRaw) ||
    !Number.isFinite(templateId) ||
    templateId <= 0
  ) {
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

  const branchId = (() => {
    if (branchRaw === null || branchRaw === undefined || branchRaw === '') {
      return null;
    }
    const parsed = Number(branchRaw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
  })();

  if (Number.isNaN(branchId)) {
    return NextResponse.json({ error: 'invalid branchId' }, { status: 400 });
  }

  const weekStartDate = new Date(`${weekStartRaw}T00:00:00`);
  if (Number.isNaN(weekStartDate.getTime())) {
    return NextResponse.json({ error: 'invalid weekStart' }, { status: 400 });
  }

  const template = listWeeklyShiftTemplates().find((entry) => entry.id === templateId);
  if (!template) {
    return NextResponse.json({ error: 'template not found' }, { status: 404 });
  }

  try {
    for (let offset = 0; offset < 7; offset += 1) {
      const current = new Date(weekStartDate);
      current.setDate(current.getDate() + offset);
      const isoDate = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
      const weekdayIndex = (current.getDay() + 6) % 7; // Monday = 0

      const templateDay = template.days.find((day) => day.weekday === weekdayIndex);
      const templateSegments = templateDay?.segments ?? [];
      const templateHasSegments = templateSegments.length > 0;

      let start: string | null = null;
      let end: string | null = null;
      let pauseMinutes = 0;
      let label: string | null = null;

      if (templateHasSegments) {
        const availableSegment = templateSegments.find(
          (segment) => segment.mode === 'available' && (segment.start || segment.end)
        );
        if (availableSegment) {
          start = sanitizeTime(availableSegment.start);
          end = sanitizeTime(availableSegment.end);
          pauseMinutes = Number(availableSegment.requiredPauseMinutes ?? 0) || 0;
          label = availableSegment.label?.trim() || null;
        } else {
          const unavailableSegment = templateSegments.find((segment) => segment.mode === 'unavailable');
          if (unavailableSegment) {
            label = (unavailableSegment.label ?? '').trim() || NO_WORK_LABEL;
            start = sanitizeTime(unavailableSegment.start);
            end = sanitizeTime(unavailableSegment.end);
            pauseMinutes = Number(unavailableSegment.requiredPauseMinutes ?? 0) || 0;
          }
        }
      }

      const startHours = parseTimeToDecimalHours(start);
      const endHours = parseTimeToDecimalHours(end);
      if (startHours !== null && endHours !== null) {
        let duration = endHours - startHours;
        if (duration < 0) {
          duration += 24;
        }
        duration = Math.max(duration, 0);
        const legalPauseMinutes = Math.round(calculateLegalPauseHours(duration) * 60);
        if (pauseMinutes < legalPauseMinutes) {
          pauseMinutes = legalPauseMinutes;
        }
      }

      if (labelOverride) {
        label = labelOverride;
        if (isNoWorkLabel(labelOverride)) {
          start = null;
          end = null;
          pauseMinutes = 0;
        }
      }

      if (label && isNoWorkLabel(label)) {
        start = null;
        end = null;
        pauseMinutes = 0;
      }

      if (!start && !end && pauseMinutes <= 0 && (!label || !label.trim())) {
        await saveShiftPlanDay(tenantId, employeeId, { isoDate, requiredPauseMinutes: 0, branchId: null });
        continue;
      }

      await saveShiftPlanDay(tenantId, employeeId, {
        isoDate,
        start,
        end,
        requiredPauseMinutes: pauseMinutes,
        label: label ?? undefined,
        branchId: branchId ?? null,
      });
    }

    await recomputeEmployeeOvertime(tenantId, employeeId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('shift-plan/fill-week failed', error);
    return NextResponse.json({ ok: false, error: 'fill_failed' }, { status: 500 });
  }
}
