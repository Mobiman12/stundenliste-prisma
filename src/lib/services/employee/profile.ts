import { hashPassword, verifyPassword } from '@/lib/auth';
import { FEDERAL_STATE_OPTIONS } from '@/lib/constants/federal-states';
import { getPrisma } from '@/lib/prisma';

type FederalStateCode = (typeof FEDERAL_STATE_OPTIONS)[number]['code'];

const VALID_FEDERAL_STATES = new Set<FederalStateCode>(FEDERAL_STATE_OPTIONS.map((option) => option.code));

type NullableString = string | null;

export interface EmployeeProfile {
  id: number;
  firstName: string;
  lastName: string;
  street: NullableString;
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
  firstName: string;
  lastName: string;
  street: NullableString;
  zipCode: NullableString;
  city: NullableString;
  phone: NullableString;
  email: NullableString;
  birthDate: NullableString;
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

  const result = await prisma.employee.updateMany({
    where: {
      id: employeeId,
      ...(tenantId ? { tenantId } : {}),
    },
    data: {
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      street: sanitizeNullable(input.street),
      zipCode: sanitizeNullable(input.zipCode),
      city: sanitizeNullable(input.city),
      phone: sanitizeNullable(input.phone),
      email: sanitizeNullable(input.email),
      birthDate: sanitizeNullable(input.birthDate),
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
    select: { password: true },
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

  const newHash = hashPassword(newPassword);
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
    select: { bookingPin: true },
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
