import { verifyPassword } from '@/lib/auth';
import { FEDERAL_STATE_OPTIONS } from '@/lib/constants/federal-states';
import { getPrisma } from '@/lib/prisma';
import { pushStaffProfileUpdateToControlPlane } from '@/lib/control-plane';
import { createHash } from 'crypto';

type FederalStateCode = (typeof FEDERAL_STATE_OPTIONS)[number]['code'];

const VALID_FEDERAL_STATES = new Set<FederalStateCode>(FEDERAL_STATE_OPTIONS.map((option) => option.code));

type NullableString = string | null;

export interface EmployeeProfile {
  id: number;
  firstName: string;
  lastName: string;
  street: NullableString;
  houseNumber: NullableString;
  zipCode: NullableString;
  city: NullableString;
  phone: NullableString;
  email: NullableString;
  birthDate: NullableString;
  entryDate: string;
  personnelNumber: string;
  federalState: NullableString;
  bookingPin: string;
}

export interface UpdateEmployeeProfileInput {
  street: NullableString;
  houseNumber: NullableString;
  zipCode: NullableString;
  city: NullableString;
  phone: NullableString;
  email: NullableString;
  federalState: NullableString;
}

export async function getEmployeeProfile(
  employeeId: number,
  tenantId?: string | null
): Promise<EmployeeProfile | null> {
  const prisma = getPrisma();
  const row = await prisma.employee.findFirst({
    where: {
      id: employeeId,
      ...(tenantId ? { tenantId } : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      street: true,
      houseNumber: true,
      zipCode: true,
      city: true,
      phone: true,
      email: true,
      birthDate: true,
      entryDate: true,
      personnelNumber: true,
      federalState: true,
      bookingPin: true,
    },
  });

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    street: row.street ?? null,
    houseNumber: row.houseNumber ?? null,
    zipCode: row.zipCode ?? null,
    city: row.city ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    birthDate: row.birthDate ?? null,
    entryDate: row.entryDate,
    personnelNumber: row.personnelNumber,
    federalState: row.federalState ?? null,
    bookingPin: row.bookingPin ?? '0000',
  };
}

function sanitizeNullable(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export async function updateEmployeeProfile(
  employeeId: number,
  input: UpdateEmployeeProfileInput,
  tenantId?: string | null
): Promise<void> {
  const prisma = getPrisma();
  const normalizedState = input.federalState ? input.federalState.toUpperCase() : null;
  const federalState = normalizedState && VALID_FEDERAL_STATES.has(normalizedState as FederalStateCode)
    ? (normalizedState as FederalStateCode)
    : null;

  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, ...(tenantId ? { tenantId } : {}) },
    select: { tenantId: true, controlPlaneStaffId: true, houseNumber: true },
  });

  if (!employee) {
    throw new Error('Mitarbeiter nicht gefunden.');
  }

  const email = sanitizeNullable(input.email);
  const phone = sanitizeNullable(input.phone);
  const street = sanitizeNullable(input.street);
  const houseNumber = sanitizeNullable(input.houseNumber);
  const zipCode = sanitizeNullable(input.zipCode);
  const city = sanitizeNullable(input.city);

  const staffId = typeof employee.controlPlaneStaffId === 'string' ? employee.controlPlaneStaffId.trim() : '';
  if (staffId) {
    // Avoid wiping a house number that only exists in the Control Plane (not yet provisioned to Timesheet).
    // We only send houseNumber if we already have one locally, or if the user provided a non-empty value.
    const existingHouseNumber = typeof employee.houseNumber === 'string' ? employee.houseNumber.trim() : '';
    const shouldSendHouseNumber = Boolean(existingHouseNumber || houseNumber);
    const ok = await pushStaffProfileUpdateToControlPlane({
      tenantId: employee.tenantId,
      staffId,
      email,
      phone,
      profile: {
        street,
        ...(shouldSendHouseNumber ? { houseNumber } : {}),
        zipCode,
        city,
        federalState,
      },
    });
    if (!ok) {
      throw new Error('Profil konnte nicht synchronisiert werden. Bitte erneut versuchen.');
    }
  }

  // Update local row so the Timesheet UI reflects the change immediately.
  // Control Plane remains the source of truth and will re-provision data back into Timesheet.
  const result = await prisma.employee.updateMany({
    where: { id: employeeId, tenantId: employee.tenantId },
    data: {
      street,
      houseNumber,
      zipCode,
      city,
      phone,
      email,
      // Email is the username for all logins.
      ...(email ? { username: email.toLowerCase() } : {}),
      federalState,
    },
  });

  if (result.count === 0) {
    throw new Error('Mitarbeiter nicht gefunden.');
  }
}

export async function updateEmployeePassword(
  employeeId: number,
  currentPassword: string,
  newPassword: string,
  tenantId?: string | null
): Promise<{ success: boolean; message?: string }> {
  const prisma = getPrisma();
  const row = await prisma.employee.findFirst({
    where: {
      id: employeeId,
      ...(tenantId ? { tenantId } : {}),
    },
    select: { password: true, tenantId: true, controlPlaneStaffId: true, email: true },
  });

  if (!row) {
    return { success: false, message: 'Mitarbeiter nicht gefunden.' };
  }

  if (!verifyPassword(currentPassword, row.password)) {
    return { success: false, message: 'Aktuelles Passwort ist nicht korrekt.' };
  }

  if (verifyPassword(newPassword, row.password)) {
    return { success: false, message: 'Das neue Passwort muss sich vom bisherigen unterscheiden.' };
  }

  const staffId = typeof row.controlPlaneStaffId === 'string' ? row.controlPlaneStaffId.trim() : '';
  if (staffId) {
    const ok = await pushStaffProfileUpdateToControlPlane({
      tenantId: row.tenantId,
      staffId,
      password: newPassword,
      email: row.email ?? null,
    });
    if (!ok) {
      return { success: false, message: 'Passwort konnte nicht synchronisiert werden. Bitte erneut versuchen.' };
    }
  }

  // Control Plane staff auth uses sha256, so we align Timesheet to the same format here.
  const newHash = createHash('sha256').update(newPassword, 'utf8').digest('hex');
  const result = await prisma.employee.updateMany({
    where: {
      id: employeeId,
      ...(tenantId ? { tenantId } : {}),
    },
    data: { password: newHash },
  });
  if (result.count === 0) {
    return { success: false, message: 'Mitarbeiter nicht gefunden.' };
  }

  return { success: true };
}

export async function updateEmployeeBookingPin(
  employeeId: number,
  currentPin: string,
  newPin: string,
  tenantId?: string | null
): Promise<{ success: boolean; message?: string }> {
  const prisma = getPrisma();
  const row = await prisma.employee.findFirst({
    where: {
      id: employeeId,
      ...(tenantId ? { tenantId } : {}),
    },
    select: { bookingPin: true, tenantId: true, controlPlaneStaffId: true, email: true },
  });

  if (!row) {
    return { success: false, message: 'Mitarbeiter nicht gefunden.' };
  }

  const normalizedCurrent = currentPin.trim();
  const normalizedNew = newPin.trim();

  if (!/^\d{4}$/.test(normalizedCurrent) || !/^\d{4}$/.test(normalizedNew)) {
    return { success: false, message: 'Die Buchungs-PIN muss aus genau 4 Ziffern bestehen.' };
  }

  if (normalizedCurrent !== (row.bookingPin ?? '')) {
    return { success: false, message: 'Aktuelle Buchungs-PIN ist nicht korrekt.' };
  }

  if (normalizedCurrent === normalizedNew) {
    return { success: false, message: 'Die neue Buchungs-PIN muss sich von der bisherigen unterscheiden.' };
  }

  const duplicate = await prisma.employee.findFirst({
    where: {
      bookingPin: normalizedNew,
      ...(tenantId ? { tenantId } : {}),
      id: { not: employeeId },
    },
    select: { id: true },
  });
  if (duplicate) {
    return { success: false, message: 'Diese Buchungs-PIN wird bereits verwendet.' };
  }

  const staffId = typeof row.controlPlaneStaffId === 'string' ? row.controlPlaneStaffId.trim() : '';
  if (staffId) {
    const ok = await pushStaffProfileUpdateToControlPlane({
      tenantId: row.tenantId,
      staffId,
      bookingPin: normalizedNew,
      email: row.email ?? null,
    });
    if (!ok) {
      return { success: false, message: 'PIN konnte nicht synchronisiert werden. Bitte erneut versuchen.' };
    }
  }

  const result = await prisma.employee.updateMany({
    where: {
      id: employeeId,
      ...(tenantId ? { tenantId } : {}),
    },
    data: { bookingPin: normalizedNew },
  });
  if (result.count === 0) {
    return { success: false, message: 'Mitarbeiter nicht gefunden.' };
  }
  return { success: true };
}

export async function completeEmployeeInitialBookingPin(
  employeeId: number,
  newPin: string,
  tenantId?: string | null
): Promise<{ success: boolean; message?: string }> {
  const prisma = getPrisma();
  const row = await prisma.employee.findFirst({
    where: {
      id: employeeId,
      ...(tenantId ? { tenantId } : {}),
    },
    select: {
      id: true,
      tenantId: true,
      bookingPin: true,
      onboardingStatus: true,
      controlPlaneStaffId: true,
      email: true,
    },
  });

  if (!row) {
    return { success: false, message: 'Mitarbeiter nicht gefunden.' };
  }

  const status = (row.onboardingStatus ?? '').trim().toLowerCase();
  if (status !== 'pin_setup_required') {
    return { success: false, message: 'Für diesen Zugang ist keine initiale PIN-Einrichtung erforderlich.' };
  }

  const normalizedNew = newPin.trim();
  if (!/^\d{4}$/.test(normalizedNew)) {
    return { success: false, message: 'Die Buchungs-PIN muss aus genau 4 Ziffern bestehen.' };
  }

  const duplicate = await prisma.employee.findFirst({
    where: {
      bookingPin: normalizedNew,
      ...(tenantId ? { tenantId } : {}),
      id: { not: employeeId },
    },
    select: { id: true },
  });
  if (duplicate) {
    return { success: false, message: 'Diese Buchungs-PIN wird bereits verwendet.' };
  }

  const staffId = typeof row.controlPlaneStaffId === 'string' ? row.controlPlaneStaffId.trim() : '';
  if (staffId) {
    const ok = await pushStaffProfileUpdateToControlPlane({
      tenantId: row.tenantId,
      staffId,
      bookingPin: normalizedNew,
      email: row.email ?? null,
    });
    if (!ok) {
      return { success: false, message: 'PIN konnte nicht synchronisiert werden. Bitte erneut versuchen.' };
    }
  }

  const result = await prisma.employee.updateMany({
    where: {
      id: employeeId,
      ...(tenantId ? { tenantId } : {}),
    },
    data: {
      bookingPin: normalizedNew,
      onboardingStatus: 'active',
    },
  });
  if (result.count === 0) {
    return { success: false, message: 'Mitarbeiter nicht gefunden.' };
  }

  return { success: true };
}
