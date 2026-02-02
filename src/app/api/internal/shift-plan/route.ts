import { NextResponse } from 'next/server';

import { listEmployees } from '@/lib/data/employees';
import { getWeeklyShiftPlan, listWeeklyShiftTemplates } from '@/lib/services/shift-plan';

function assertSecret(headers: Headers) {
  const secret = process.env.PROVISION_SECRET;
  const incoming = headers.get('x-provision-secret');
  return Boolean(secret && incoming && incoming === secret);
}

export async function GET(req: Request) {
  if (!assertSecret(req.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get('tenantId')?.trim();
  const week = searchParams.get('week')?.trim() ?? null;

  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId required' }, { status: 400 });
  }

  const allEmployees = await listEmployees(tenantId);
  const employees = allEmployees.filter((employee) => employee.showInCalendar);

  const weekPlan = await getWeeklyShiftPlan(
    employees.map((employee) => ({
      id: employee.id,
      displayName: employee.displayName,
      username: employee.username,
      branches: employee.branches,
    })),
    { week }
  );

  const templates = listWeeklyShiftTemplates();

  return NextResponse.json({
    employees,
    week: weekPlan,
    templates,
  });
}
