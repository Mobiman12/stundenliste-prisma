import { NextResponse } from 'next/server';

import { ensureAuthorized, UnauthorizedError } from '@/lib/api-auth';
import { listBranchesForEmployees } from '@/lib/data/branches';
import { getPrisma } from '@/lib/prisma';

export const runtime = 'nodejs';

type EmployeeRow = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  isActive: number | null;
  bookingPin: string | null;
  showInCalendar: number | null;
  personnelNumber: string | null;
};

export async function GET(request: Request) {
  try {
    ensureAuthorized(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    throw error;
  }

  const { searchParams } = new URL(request.url);
  const includeInactiveRaw = searchParams.get('includeInactive');
  const includeInactive =
    includeInactiveRaw === '1' ||
    includeInactiveRaw === 'true' ||
    includeInactiveRaw === 'yes';

  try {
    const tenantId = request.headers.get('x-tenant-id')?.trim() || process.env.DEFAULT_TENANT_ID?.trim();
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant fehlt.' }, { status: 400 });
    }

    const prisma = getPrisma();
    const rows: EmployeeRow[] = await prisma.employee.findMany({
      where: {
        tenantId,
        ...(includeInactive ? {} : { isActive: 1 }),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        bookingPin: true,
        isActive: true,
        showInCalendar: true,
        personnelNumber: true,
      },
      orderBy: [{ isActive: 'desc' }, { lastName: 'asc' }, { firstName: 'asc' }],
    });

    const branchMap = await listBranchesForEmployees(tenantId, rows.map((row) => row.id));

    const employees = rows.map((row) => {
      const firstName = (row.firstName ?? '').trim();
      const lastName = (row.lastName ?? '').trim();
      const displayName = `${firstName} ${lastName}`.replace(/\s+/g, ' ').trim();
      const branches = branchMap.get(row.id) ?? [];
      return {
        id: row.id,
        displayName: displayName || 'Teammitglied',
        firstName: firstName || 'Team',
        lastName: lastName || 'Mitglied',
        email: row.email ?? null,
        phone: row.phone ?? null,
        isActive: Number(row.isActive ?? 1) === 1,
        bookingPin: (row.bookingPin ?? '').trim() || null,
        showInCalendar: Number(row.showInCalendar ?? 1) === 1,
        personnelNumber: row.personnelNumber ?? null,
        branches: branches.map((branch) => ({ id: branch.id, name: branch.name })),
      };
    });

    return NextResponse.json({ data: employees });
  } catch (error) {
    console.error('[api:employees]', error);
    return NextResponse.json({ error: 'Mitarbeiter konnten nicht geladen werden.' }, { status: 500 });
  }
}
