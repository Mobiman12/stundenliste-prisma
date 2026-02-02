import { NextRequest, NextResponse } from 'next/server';

import { ensureAuthorized, UnauthorizedError } from '@/lib/api-auth';
import { getEmployeeById } from '@/lib/data/employees';
import { getEditableShiftPlan, saveShiftPlanMonth } from '@/lib/services/shift-plan';

export const runtime = 'nodejs';

function parseEmployeeId(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const numeric = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

function isValidMonthKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value);
}

type RawShiftPlanDay = {
  isoDate: string;
  start: string | null;
  end: string | null;
  requiredPauseMinutes: number;
};

function isValidDay(entry: unknown): entry is RawShiftPlanDay {
  if (!entry || typeof entry !== 'object') return false;
  const record = entry as Record<string, unknown>;
  if (typeof record.isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.isoDate.trim())) {
    return false;
  }
  const startValid =
    record.start === null ||
    record.start === undefined ||
    (typeof record.start === 'string' && record.start.length <= 8);
  const endValid =
    record.end === null ||
    record.end === undefined ||
    (typeof record.end === 'string' && record.end.length <= 8);
  if (!startValid || !endValid) {
    return false;
  }
  if (typeof record.requiredPauseMinutes !== 'number' || !Number.isFinite(record.requiredPauseMinutes)) {
    return false;
  }
  return true;
}

function ensureAuth(request: Request): NextResponse | null {
  try {
    ensureAuthorized(request);
    return null;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    throw error;
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ employeeId: string }> }
) {
  const { employeeId } = await context.params;
  const authResponse = ensureAuth(request);
  if (authResponse) {
    return authResponse;
  }

  const employeeIdNumber = parseEmployeeId(employeeId);
  if (!employeeIdNumber) {
    return NextResponse.json({ error: 'Ungültige Mitarbeiter-ID.' }, { status: 400 });
  }

  const tenantId = request.headers.get('x-tenant-id')?.trim() || process.env.DEFAULT_TENANT_ID?.trim();
  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant fehlt.' }, { status: 400 });
  }

  const employee = await getEmployeeById(tenantId, employeeIdNumber);
  if (!employee) {
    return NextResponse.json({ error: 'Mitarbeiter nicht gefunden.' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month') ?? undefined;

  try {
    const plan = await getEditableShiftPlan(employeeIdNumber, month ?? undefined);
    return NextResponse.json({ data: plan });
  } catch (error) {
    console.error('[api:shift-plan:get]', { employeeId: employeeIdNumber, error });
    return NextResponse.json(
      { error: 'Schichtplan konnte nicht geladen werden.' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ employeeId: string }> }
) {
  const { employeeId } = await context.params;
  const authResponse = ensureAuth(request);
  if (authResponse) {
    return authResponse;
  }

  const employeeIdNumber = parseEmployeeId(employeeId);
  if (!employeeIdNumber) {
    return NextResponse.json({ error: 'Ungültige Mitarbeiter-ID.' }, { status: 400 });
  }

  const tenantId = request.headers.get('x-tenant-id')?.trim() || process.env.DEFAULT_TENANT_ID?.trim();
  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant fehlt.' }, { status: 400 });
  }

  const employee = await getEmployeeById(tenantId, employeeIdNumber);
  if (!employee) {
    return NextResponse.json({ error: 'Mitarbeiter nicht gefunden.' }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ungültige JSON-Eingabe.' }, { status: 400 });
  }

  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Ungültige Eingabedaten.' }, { status: 400 });
  }

  const data = payload as Record<string, unknown>;
  const monthKeyRaw = data.monthKey;
  const daysRaw = Array.isArray(data.days) ? data.days : null;

  if (!isValidMonthKey(monthKeyRaw) || !daysRaw || daysRaw.length === 0 || !daysRaw.every(isValidDay)) {
    return NextResponse.json({ error: 'Ungültige Eingabedaten.' }, { status: 400 });
  }

  const monthKey = monthKeyRaw;
  const days = daysRaw as RawShiftPlanDay[];

  try {
    await saveShiftPlanMonth(employeeIdNumber, {
      monthKey,
      days: days.map((day) => ({
        isoDate: day.isoDate,
        start: day.start ?? null,
        end: day.end ?? null,
        requiredPauseMinutes: Math.max(0, Math.round(day.requiredPauseMinutes ?? 0)),
      })),
    });
  } catch (error) {
    console.error('[api:shift-plan:save]', { employeeId: employeeIdNumber, error });
    return NextResponse.json({ error: 'Schichtplan konnte nicht gespeichert werden.' }, { status: 400 });
  }

  try {
    const plan = await getEditableShiftPlan(employeeIdNumber, monthKey);
    return NextResponse.json({ data: plan });
  } catch (error) {
    console.error('[api:shift-plan:reload]', { employeeId: employeeIdNumber, error });
    return NextResponse.json(
      { error: 'Schichtplan wurde gespeichert, aber das Ergebnis konnte nicht geladen werden.' },
      { status: 500 }
    );
  }
}
