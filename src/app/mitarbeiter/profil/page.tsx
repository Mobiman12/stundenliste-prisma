import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import {
  getEmployeeProfile,
  updateEmployeeBookingPin,
  updateEmployeePassword,
  updateEmployeeProfile,
} from '@/lib/services/employee/profile';
import EmployeeProfileClient, { type EmployeeProfileView, type ProfileActionState } from './EmployeeProfileClient';

async function ensureEmployeeContext() {
  const session = await getServerAuthSession();
  if (!session?.user) {
    redirect(withAppBasePath('/login?mode=employee'));
  }
  if (!session.user.employeeId) {
    redirect(withAppBasePath('/admin'));
  }
  return {
    employeeId: session.user.employeeId,
    tenantId: session.tenantId ?? null,
  };
}

function normalizeBirthDate(raw: string | null): { value: string | null; error?: string } {
  if (!raw) return { value: null };
  const trimmed = raw.trim();
  if (!trimmed) return { value: null };

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { value: trimmed };
  }

  const match = /^([0-3]?\d)\.([0-1]?\d)\.(\d{4})$/.exec(trimmed);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const year = match[3];
    return { value: `${year}-${month}-${day}` };
  }

  return { value: null, error: 'Bitte ein gültiges Geburtsdatum eingeben (TT.MM.JJJJ).' };
}

export async function updateProfileAction(prevState: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  'use server';
  try {
    const { employeeId, tenantId } = await ensureEmployeeContext();

    const firstName = String(formData.get('first_name') ?? '').trim();
    const lastName = String(formData.get('last_name') ?? '').trim();
    if (!firstName || !lastName) {
      return { status: 'error', message: 'Vor- und Nachname dürfen nicht leer sein.' };
    }

    const birthDateRaw = formData.get('birth_date');
    const { value: birthDate, error: birthDateError } = normalizeBirthDate(
      typeof birthDateRaw === 'string' ? birthDateRaw : null
    );
    if (birthDateError) {
      return { status: 'error', message: birthDateError };
    }

    const federalStateRaw = formData.get('federal_state');
    const federalState = typeof federalStateRaw === 'string' && federalStateRaw.trim().length
      ? federalStateRaw.trim()
      : null;

    const getString = (name: string) => {
      const value = formData.get(name);
      return typeof value === 'string' ? value : null;
    };

    await updateEmployeeProfile(employeeId, {
      firstName,
      lastName,
      street: getString('street'),
      zipCode: getString('zip_code'),
      city: getString('city'),
      phone: getString('phone'),
      email: getString('email'),
      birthDate,
      federalState,
    }, tenantId);

    revalidatePath(withAppBasePath('/mitarbeiter/profil'));

    return { status: 'success', message: 'Profil wurde gespeichert.' };
  } catch (error) {
    console.error('Failed to update employee profile', error);
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Profil konnte nicht gespeichert werden.',
    };
  }
}

export async function updatePasswordAction(prevState: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  'use server';
  try {
    const { employeeId, tenantId } = await ensureEmployeeContext();

    const currentPassword = String(formData.get('current_password') ?? '').trim();
    const newPassword = String(formData.get('new_password') ?? '').trim();
    const confirmPassword = String(formData.get('confirm_password') ?? '').trim();

    if (!currentPassword || !newPassword) {
      return { status: 'error', message: 'Bitte alle Passwortfelder ausfüllen.' };
    }
    if (newPassword.length < 8) {
      return { status: 'error', message: 'Das neue Passwort muss mindestens 8 Zeichen lang sein.' };
    }
    if (newPassword !== confirmPassword) {
      return { status: 'error', message: 'Die Passwörter stimmen nicht überein.' };
    }

    const result = await updateEmployeePassword(employeeId, currentPassword, newPassword, tenantId);
    if (!result.success) {
      return { status: 'error', message: result.message ?? 'Passwort konnte nicht geändert werden.' };
    }

    return { status: 'success', message: 'Passwort wurde aktualisiert.' };
  } catch (error) {
    console.error('Failed to update employee password', error);
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Passwort konnte nicht geändert werden.',
    };
  }
}

export async function updateBookingPinAction(prevState: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  'use server';
  try {
    const { employeeId, tenantId } = await ensureEmployeeContext();

    const currentPin = String(formData.get('current_pin') ?? '').trim();
    const newPin = String(formData.get('new_pin') ?? '').trim();
    const confirmPin = String(formData.get('confirm_pin') ?? '').trim();

    if (!currentPin || !newPin || !confirmPin) {
      return { status: 'error', message: 'Bitte alle PIN-Felder ausfüllen.' };
    }

    if (!/^\d{4}$/.test(currentPin)) {
      return { status: 'error', message: 'Die aktuelle Buchungs-PIN muss aus genau 4 Ziffern bestehen.' };
    }

    if (!/^\d{4}$/.test(newPin)) {
      return { status: 'error', message: 'Die neue Buchungs-PIN muss aus genau 4 Ziffern bestehen.' };
    }

    if (newPin !== confirmPin) {
      return { status: 'error', message: 'Die neue PIN stimmt nicht mit der Wiederholung überein.' };
    }

    const result = await updateEmployeeBookingPin(employeeId, currentPin, newPin, tenantId);
    if (!result.success) {
      return { status: 'error', message: result.message ?? 'Buchungs-PIN konnte nicht geändert werden.' };
    }

    revalidatePath(withAppBasePath('/mitarbeiter/profil'));

    return { status: 'success', message: 'Buchungs-PIN wurde aktualisiert.' };
  } catch (error) {
    console.error('Failed to update employee booking pin', error);
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Buchungs-PIN konnte nicht geändert werden.',
    };
  }
}

export default async function MitarbeiterProfilPage() {
  const session = await getServerAuthSession();
  if (!session?.user?.employeeId) {
    redirect(withAppBasePath('/login?mode=employee'));
  }

  const employeeId = session.user.employeeId;
  const profile = await getEmployeeProfile(employeeId, session.tenantId ?? null);
  if (!profile) {
    return (
      <section className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        Das Profil konnte nicht geladen werden.
      </section>
    );
  }

  const view: EmployeeProfileView = {
    firstName: profile.firstName,
    lastName: profile.lastName,
    street: profile.street,
    zipCode: profile.zipCode,
    city: profile.city,
    phone: profile.phone,
    email: profile.email,
    birthDate: profile.birthDate,
    entryDate: profile.entryDate,
    personnelNumber: profile.personnelNumber,
    federalState: profile.federalState,
    bookingPin: profile.bookingPin,
  };

  return (
    <EmployeeProfileClient
      profile={view}
      updateProfileAction={updateProfileAction}
      updatePasswordAction={updatePasswordAction}
      updateBookingPinAction={updateBookingPinAction}
    />
  );
}
