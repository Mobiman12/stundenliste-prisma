import { NextResponse } from 'next/server';

import { ensureAuthorized, UnauthorizedError } from '@/lib/api-auth';
import { listBranches } from '@/lib/data/branches';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    ensureAuthorized(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    throw error;
  }

  try {
    const tenantId = request.headers.get('x-tenant-id')?.trim() || process.env.DEFAULT_TENANT_ID?.trim();
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant fehlt.' }, { status: 400 });
    }

    const branches = (await listBranches(tenantId)).map((branch) => ({
      id: branch.id,
      slug: branch.slug,
      name: branch.name,
      timezone: branch.timezone,
      addressLine1: branch.addressLine1,
      addressLine2: branch.addressLine2,
      postalCode: branch.postalCode,
      city: branch.city,
      country: branch.country,
      federalState: branch.federalState,
      phone: branch.phone,
      email: branch.email,
      metadata: branch.metadata,
      schedule: branch.schedule,
      createdAt: branch.createdAt,
      updatedAt: branch.updatedAt,
    }));
    return NextResponse.json({ data: branches });
  } catch (error) {
    console.error('[api:branches]', error);
    return NextResponse.json({ error: 'Standorte konnten nicht geladen werden.' }, { status: 500 });
  }
}
