import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import {
  createBranch,
  deleteBranch,
  listBranches,
  updateBranch,
  type BranchInput,
  type BranchScheduleInput,
} from '@/lib/data/branches';

import AdminLocationsClient, { type LocationActionState } from './AdminLocationsClient';

async function ensureAdminSession() {
  const session = await getServerAuthSession();
  if (!session?.user) {
    redirect(withAppBasePath('/login'));
  }
  if (session.user.roleId !== 2) {
    redirect(withAppBasePath('/mitarbeiter'));
  }
  const tenantId = session.tenantId;
  if (!tenantId) {
    redirect(withAppBasePath('/login'));
  }
  return { session, tenantId };
}

const REVALIDATE_TARGET = withAppBasePath('/admin/standorte');

function parseLocationForm(
  formData: FormData
): { data?: BranchInput; error?: string } {
  const getString = (key: string) => String(formData.get(key) ?? '').trim();

  const name = getString('name');
  const slug = getString('slug');
  const timezone = getString('timezone');
  const addressLine1 = getString('addressLine1');
  const addressLine2 = getString('addressLine2');
  const postalCode = getString('postalCode');
  const city = getString('city');
  const country = getString('country');
  const federalState = getString('federalState');
  const phone = getString('phone');
  const email = getString('email');
  const metadata = getString('metadata');

  const rawSchedule = getString('schedule');
  let schedule: BranchScheduleInput[] = [];
  if (rawSchedule) {
    try {
      const parsed = JSON.parse(rawSchedule);
      if (!Array.isArray(parsed)) {
        return { error: 'Öffnungszeiten konnten nicht gelesen werden.' };
      }
      schedule = parsed.map((entry) => ({
        weekday: entry.weekday,
        startsAtMinutes: entry.startsAtMinutes ?? null,
        endsAtMinutes: entry.endsAtMinutes ?? null,
        isActive: entry.isActive ?? true,
        segmentIndex: entry.segmentIndex,
      }));
    } catch {
      return { error: 'Öffnungszeiten sind kein gültiges JSON.' };
    }
  }

  const data: BranchInput = {
    name,
    slug: slug || undefined,
    timezone: timezone || undefined,
    addressLine1: addressLine1 || undefined,
    addressLine2: addressLine2 || undefined,
    postalCode: postalCode || undefined,
    city: city || undefined,
    country: country || undefined,
    federalState: federalState || undefined,
    phone: phone || undefined,
    email: email || undefined,
    metadata: metadata || null,
    schedule,
  };

  return { data };
}

async function createLocationAction(
  prevState: LocationActionState,
  formData: FormData
): Promise<LocationActionState> {
  'use server';
  const { tenantId } = await ensureAdminSession();

  const { data, error } = parseLocationForm(formData);

  if (error) {
    return { status: 'error', message: error };
  }

  if (!data?.name) {
    return { status: 'error', message: 'Bitte einen Namen für den Standort eingeben.' };
  }

  try {
    await createBranch(tenantId, data);
    revalidatePath(REVALIDATE_TARGET);
    return { status: 'success', message: 'Standort wurde angelegt.' };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Standort konnte nicht angelegt werden.',
    };
  }
}

async function updateLocationAction(formData: FormData): Promise<LocationActionState> {
  'use server';
  const { tenantId } = await ensureAdminSession();

  const locationIdRaw = formData.get('locationId');
  const locationId = Number(locationIdRaw);
  const { data, error } = parseLocationForm(formData);

  if (!Number.isFinite(locationId) || locationId <= 0) {
    return { status: 'error', message: 'Ungültiger Standort.' };
  }

  if (error) {
    return { status: 'error', message: error };
  }

  if (!data?.name) {
    return { status: 'error', message: 'Bitte einen Namen für den Standort eingeben.' };
  }

  try {
    await updateBranch(tenantId, locationId, data);
    revalidatePath(REVALIDATE_TARGET);
    return { status: 'success', message: 'Standort wurde aktualisiert.' };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Standort konnte nicht aktualisiert werden.',
    };
  }
}

async function deleteLocationAction(formData: FormData): Promise<LocationActionState> {
  'use server';
  const { tenantId } = await ensureAdminSession();

  const locationIdRaw = formData.get('locationId');
  const locationId = Number(locationIdRaw);

  if (!Number.isFinite(locationId) || locationId <= 0) {
    return { status: 'error', message: 'Ungültiger Standort.' };
  }

  try {
    await deleteBranch(tenantId, locationId);
    revalidatePath(REVALIDATE_TARGET);
    return { status: 'success', message: 'Standort wurde gelöscht.' };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Standort konnte nicht gelöscht werden.',
    };
  }
}

export default async function AdminLocationsPage() {
  const { tenantId } = await ensureAdminSession();
  const locations = (await listBranches(tenantId)).map((branch) => ({
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
  }));

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Standorte verwalten</h1>
        <p className="text-sm text-slate-500">
          Lege neue Standorte an und pflege strukturierte Stammdaten inklusive Öffnungszeiten. Anschließend kannst du
          Standorte Mitarbeitenden und Schichtplänen zuweisen.
        </p>
      </header>
      <AdminLocationsClient
        locations={locations}
        createAction={createLocationAction}
        updateAction={updateLocationAction}
        deleteAction={deleteLocationAction}
      />
    </section>
  );
}
