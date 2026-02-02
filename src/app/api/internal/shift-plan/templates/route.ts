import { NextResponse } from 'next/server';

import {
  createShiftPlanTemplate,
  deleteShiftPlanTemplate,
} from '@/lib/data/shift-plan-templates';

function assertSecret(headers: Headers) {
  const secret = process.env.PROVISION_SECRET;
  const incoming = headers.get('x-provision-secret');
  return Boolean(secret && incoming && incoming === secret);
}

type TemplatePayload = {
  name: string;
  days: Array<{
    weekday: number;
    mode: 'available' | 'unavailable';
    start?: string | null;
    end?: string | null;
    pause?: number | null;
    label?: string | null;
  }>;
};

const NO_WORK_LABEL = 'Kein Arbeitstag';
const NO_WORK_LABEL_LOWER = NO_WORK_LABEL.toLowerCase();
const isNoWorkLabel = (label: string | null | undefined): boolean =>
  (label ?? '').trim().toLowerCase() === NO_WORK_LABEL_LOWER;

function sanitizePayload(raw: TemplatePayload): TemplatePayload {
  const name = (raw.name ?? '').trim();
  const days = Array.isArray(raw.days) ? raw.days : [];
  return {
    name,
    days: days
      .map((day) => {
        const mode: 'available' | 'unavailable' =
          day.mode === 'unavailable' ? 'unavailable' : 'available';
        return {
          weekday: Number(day.weekday),
          mode,
          start: typeof day.start === 'string' ? day.start : null,
          end: typeof day.end === 'string' ? day.end : null,
          pause: Number(day.pause ?? 0) || 0,
          label: typeof day.label === 'string' ? day.label : null,
        };
      })
      .filter((day) => Number.isInteger(day.weekday) && day.weekday >= 0 && day.weekday <= 6),
  };
}

export async function POST(req: Request) {
  if (!assertSecret(req.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const payloadRaw = body?.payload as TemplatePayload | undefined;
  if (!payloadRaw) {
    return NextResponse.json({ error: 'payload required' }, { status: 400 });
  }

  try {
    const payload = sanitizePayload(payloadRaw);
    if (!payload.name) {
      return NextResponse.json({ error: 'name required' }, { status: 400 });
    }
    if (!payload.days.length) {
      return NextResponse.json({ error: 'days required' }, { status: 400 });
    }

    const templateId = createShiftPlanTemplate({
      name: payload.name,
      days: payload.days.map((day) => ({
        weekday: day.weekday,
        mode: day.mode,
        start:
          day.mode === 'available' || !isNoWorkLabel(day.label)
            ? day.start ?? null
            : null,
        end:
          day.mode === 'available' || !isNoWorkLabel(day.label)
            ? day.end ?? null
            : null,
        requiredPauseMinutes:
          day.mode === 'available' || !isNoWorkLabel(day.label) ? day.pause ?? 0 : 0,
        label: day.label?.trim() ? day.label.trim() : null,
      })),
    });

    return NextResponse.json({ ok: true, templateId });
  } catch (error) {
    console.error('shift-plan/templates create failed', error);
    return NextResponse.json({ ok: false, error: 'create_failed' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!assertSecret(req.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const templateId = Number(body?.templateId);
  if (!Number.isFinite(templateId) || templateId <= 0) {
    return NextResponse.json({ error: 'templateId required' }, { status: 400 });
  }

  try {
    deleteShiftPlanTemplate(templateId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('shift-plan/templates delete failed', error);
    return NextResponse.json({ ok: false, error: 'delete_failed' }, { status: 500 });
  }
}
