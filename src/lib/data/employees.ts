import type { Employee as PrismaEmployee, Prisma } from '@prisma/client';

import type { BaseUser } from '@/lib/auth';
import { getPrisma } from '@/lib/prisma';
import { fetchStaffProfileFromControlPlane } from '@/lib/control-plane';
import { listBranchesForEmployee, listBranchesForEmployees, type BranchSummary } from '@/lib/data/branches';

type EmployeeRecordRow = Pick<
  PrismaEmployee,
  | 'id'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'username'
  | 'Rolle'
  | 'personnelNumber'
  | 'controlPlaneStaffId'
  | 'entryDate'
  | 'exitDate'
  | 'onboardingStatus'
  | 'arbeitsstundenProWoche'
  | 'vacationDaysTotal'
  | 'federalState'
  | 'showInCalendar'
>;

export interface EmployeeRecord {
  id: number;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  username: string;
  role_id: number;
  personnel_number: string | null;
  control_plane_staff_id: string | null;
  entry_date: string;
  exit_date: string | null;
  onboarding_status: string;
  weekly_hours: number | null;
  vacation_days_total: number;
  federal_state: string | null;
  show_in_calendar: boolean;
}

export interface EmployeeAdminDetails extends EmployeeRecord {
  control_plane_staff_id: string | null;
  street: string | null;
  house_number: string | null;
  zip_code: string | null;
  city: string | null;
  birth_date: string | null;
  booking_pin: string;
  federal_state: string | null;
  tax_class: string | null;
  hourly_wage: number | null;
  compensation_type: 'hourly' | 'fixed';
  monthly_salary_gross: number | null;
  kinderfreibetrag: number | null;
  iban: string | null;
  bic: string | null;
  steuer_id: string | null;
  social_security_number: string | null;
  health_insurance: string | null;
  health_insurance_number: string | null;
  nationality: string | null;
  marital_status: string | null;
  employment_type: string | null;
  work_time_model: string | null;
  probation_months: number | null;
  tarif_group: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relation: string | null;
  vacation_days: number;
  vacation_days_last_year: number;
  vacation_days_total: number;
  vacation_carry_expiry_enabled: boolean;
  vacation_carry_expiry_date: string | null;
  password: string;
  imported_overtime_balance: number;
  imported_minusstunden_balance: number;
  imported_vacation_taken: number;
  imported_bonus_earned: number;
  opening_type: 'new' | 'existing';
  opening_values_locked: boolean;
  opening_effective_date: string | null;
  opening_overtime_balance: number;
  opening_vacation_carry_days: number;
  opening_vacation_taken_ytd: number;
  opening_bonus_carry: number;
  max_ueberstunden: number | null;
  max_minusstunden: number | null;
  sachbezuege: string | null;
  sachbezuege_amount: number | null;
  mind_jahresumsatz: number | null;
  yearly_soll_hours: number;
  sachbezug_verpflegung: string | null;
  monatlicher_bonus_prozent: number | null;
  tillhub_user_id: string | null;
  mandatory_pause_min_work_minutes: number;
  min_pause_under6_minutes: number;
  mandatoryPauseEnabled: boolean;
  overtime_balance: number;
  isActive: boolean;
  profile_photo_file_name: string | null;
  branches: BranchSummary[];
}

export interface UpdateEmployeeAdminInput {
  id: number;
  first_name: string;
  last_name: string;
  street: string | null;
  house_number: string | null;
  zip_code: string | null;
  city: string | null;
  birth_date: string | null;
  entry_date: string;
  exit_date: string | null;
  phone: string | null;
  email: string | null;
  booking_pin: string;
  federal_state: string | null;
  weekly_hours: number | null;
  kinderfreibetrag: number | null;
  tax_class: string | null;
  hourly_wage: number | null;
  compensation_type: 'hourly' | 'fixed';
  monthly_salary_gross: number | null;
  iban: string | null;
  bic: string | null;
  steuer_id: string | null;
  social_security_number: string | null;
  health_insurance: string | null;
  health_insurance_number: string | null;
  nationality: string | null;
  marital_status: string | null;
  employment_type: string | null;
  work_time_model: string | null;
  probation_months: number | null;
  tarif_group: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relation: string | null;
  vacation_days: number;
  vacation_days_last_year: number;
  vacation_days_total: number;
  vacation_carry_expiry_enabled: boolean;
  vacation_carry_expiry_date: string | null;
  role_id: number;
  username: string;
  passwordHash?: string | null;
  imported_overtime_balance: number;
  imported_minusstunden_balance: number;
  imported_vacation_taken: number;
  imported_bonus_earned: number;
  show_in_calendar: boolean;
}

export interface CreateEmployeeInput {
  first_name: string;
  last_name: string;
  entry_date: string;
  exit_date?: string | null;
  personnel_number: string;
  booking_pin: string;
  username: string;
  passwordHash: string;
  role_id: number;
  email?: string | null;
  phone?: string | null;
  weekly_hours?: number | null;
  compensation_type?: 'hourly' | 'fixed';
  monthly_salary_gross?: number | null;
  kinderfreibetrag?: number | null;
  iban?: string | null;
  bic?: string | null;
  steuer_id?: string | null;
  social_security_number?: string | null;
  health_insurance?: string | null;
  health_insurance_number?: string | null;
  nationality?: string | null;
  marital_status?: string | null;
  employment_type?: string | null;
  work_time_model?: string | null;
  probation_months?: number | null;
  tarif_group?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  emergency_contact_relation?: string | null;
  vacation_days?: number | null;
  vacation_days_last_year?: number | null;
  vacation_days_total?: number | null;
  is_active?: boolean;
  onboarding_status?: string;
  onboarding_submitted_at?: Date | null;
  profile_photo_file_name?: string | null;
  mandatory_pause_enabled?: boolean;
  show_in_calendar?: boolean;
}

export interface EmployeeOvertimeSettingsRow {
  maxOvertimeHours: number;
  maxMinusHours: number;
  overtimeBalance: number;
}

export interface EmployeeSettingsInput {
  employeeId: number;
  maxMinusHours: number | null;
  maxOvertimeHours: number | null;
  sachbezuege: string;
  sachbezuegeAmount: number;
  mindJahresumsatz: number;
  sachbezugVerpflegung: string;
  monatlicherBonusProzent: number;
  importedOvertimeBalance: number;
  importedMinusstundenBalance: number;
  importedVacationCarryDays: number;
  importedBonusEarned: number;
  openingType: 'new' | 'existing';
  openingValuesLocked: boolean;
  openingEffectiveDate: string | null;
  openingOvertimeBalance: number;
  openingVacationCarryDays: number;
  openingVacationTakenYtd: number;
  openingBonusCarry: number;
  mandatoryPauseMinWorkMinutes: number;
  minPauseUnder6Minutes: number;
  mandatoryPauseEnabled: boolean;
}

export type BonusSchemeType = 'linear' | 'stufen';

export interface BonusScheme {
  schemeType: BonusSchemeType;
  linearPercent: number;
}

export interface BonusTier {
  threshold: number;
  percent: number;
}

export interface EmployeeListItem {
  id: number;
  displayName: string;
  roleId: number;
  username: string;
  isActive: boolean;
  onboardingStatus: string;
  branches: BranchSummary[];
  showInCalendar: boolean;
}

export interface EmployeeValidationInfo {
  id: number;
  sachbezugVerpflegung: string;
  mandatoryPauseMinWorkMinutes: number;
  minPauseUnder6Minutes: number;
  federalState: string | null;
  tillhubUserId: string | null;
}

export interface EmployeeSelfSummaryData {
  id: number;
  entryDate: string | null;
  exitDate: string | null;
  mindJahresumsatz: number;
  monatlicherBonusProzent: number;
  importedBonusEarned: number;
  overtimeBalance: number;
  importedOvertimeBalance: number;
  importedMinusBalance: number;
  maxOvertimeHours: number;
  maxMinusHours: number;
  vacationDaysTotal: number;
  vacationDaysLastYear: number;
  importedVacationTaken: number;
  openingType: 'new' | 'existing';
  openingValuesLocked: boolean;
  openingEffectiveDate: string | null;
  openingOvertimeBalance: number;
  openingVacationCarryDays: number;
  openingVacationTakenYtd: number;
  openingBonusCarry: number;
  vacationCarryExpiryEnabled: boolean;
  vacationCarryExpiryDate: string | null;
}

export async function updateEmployeePersonnelNumber(
  tenantId: string,
  employeeId: number,
  personnelNumber: string
): Promise<void> {
  const prisma = getPrisma();
  await prisma.employee.updateMany({
    where: { id: employeeId, tenantId },
    data: { personnelNumber },
  });
}

export async function listEmployees(
  tenantId: string,
  options: { includeInactive?: boolean } = {}
): Promise<EmployeeListItem[]> {
  const includeInactive = options.includeInactive ?? false;
  const prisma = getPrisma();
  const rows = await prisma.employee.findMany({
    where: {
      tenantId,
      ...(includeInactive ? {} : { isActive: 1 }),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      username: true,
      Rolle: true,
      isActive: true,
      showInCalendar: true,
      onboardingStatus: true,
      // Links the "real" Timesheet employee to the Control Plane StaffMember.id.
      // We use this to hide provisioning-created duplicates in admin listings while
      // still preserving the original personnelNumber as the real personnel number.
      controlPlaneStaffId: true,
    },
    orderBy: [
      { isActive: 'desc' },
      { lastName: 'asc' },
      { firstName: 'asc' },
    ],
  });

  // When includeInactive=true, the admin UI shows both active and inactive employees.
  // After provisioning, we may have legacy employees (numeric personnelNumber) AND
  // previously-provisioned duplicates (personnelNumber == staffId) that are now set inactive.
  // To avoid showing "almost everyone twice", hide inactive duplicates when there is an active
  // employee for the same email or Control Plane staff id.
  const filteredRows = includeInactive
    ? (() => {
        const activeEmails = new Set(
          rows
            .filter((row) => Number(row.isActive ?? 1) === 1)
            .map((row) => (typeof row.email === 'string' ? row.email.trim().toLowerCase() : ''))
            .filter(Boolean),
        );
        const activeStaffIds = new Set(
          rows
            .filter((row) => Number(row.isActive ?? 1) === 1)
            .map((row) => (typeof row.controlPlaneStaffId === 'string' ? row.controlPlaneStaffId.trim() : ''))
            .filter(Boolean),
      );
        return rows.filter((row) => {
          const isActive = Number(row.isActive ?? 1) === 1;
          const status = (row.onboardingStatus ?? '').trim().toLowerCase();
          if (status === 'deleted') return false;
          if (isActive) return true;
          const email = typeof row.email === 'string' ? row.email.trim().toLowerCase() : '';
          const staffId = typeof row.controlPlaneStaffId === 'string' ? row.controlPlaneStaffId.trim() : '';
          if (email && activeEmails.has(email)) return false;
          if (staffId && activeStaffIds.has(staffId)) return false;
          return true;
        });
      })()
    : rows;

  const branchMap = await listBranchesForEmployees(tenantId, filteredRows.map((row) => row.id));

  return filteredRows.map((row) => ({
    id: row.id,
    displayName: `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim(),
    roleId: row.Rolle,
    username: row.username,
    isActive: Number(row.isActive ?? 1) === 1,
    onboardingStatus: (row.onboardingStatus ?? 'active').trim() || 'active',
    showInCalendar: Number(row.showInCalendar ?? 1) === 1,
    branches: branchMap.get(row.id) ?? [],
  }));
}

export async function getEmployeeDisplayNamesByIds(
  tenantId: string,
  employeeIds: number[]
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const uniqueIds = Array.from(new Set(employeeIds.filter((id) => Number.isFinite(id) && id > 0)));
  if (!uniqueIds.length) {
    return map;
  }
  const prisma = getPrisma();
  const rows = await prisma.employee.findMany({
    where: { tenantId, id: { in: uniqueIds } },
    select: { id: true, firstName: true, lastName: true },
  });
  for (const row of rows) {
    map.set(row.id, `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim());
  }
  return map;
}

export async function getEmployeeById(
  tenantId: string,
  id: number
): Promise<EmployeeRecord | null> {
  const prisma = getPrisma();
  const row = await prisma.employee.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      username: true,
      Rolle: true,
      personnelNumber: true,
      controlPlaneStaffId: true,
      entryDate: true,
      exitDate: true,
      onboardingStatus: true,
      arbeitsstundenProWoche: true,
      vacationDaysTotal: true,
      federalState: true,
      showInCalendar: true,
    },
  });

  if (!row) {
    return null;
  }

  return mapEmployeeRecord(row);
}


export async function getEmployeeSelfSummaryData(
  tenantId: string,
  id: number
): Promise<EmployeeSelfSummaryData | null> {
  const prisma = getPrisma();
  const row = await prisma.employee.findFirst({
    where: { id, tenantId },
    select: {
      entryDate: true,
      exitDate: true,
      mindJahresumsatz: true,
      monatlicherBonusProzent: true,
      importedBonusEarned: true,
      overtimeBalance: true,
      importedOvertimeBalance: true,
      importedMinusstundenBalance: true,
      maxUeberstunden: true,
      maxMinusstunden: true,
      vacationDaysTotal: true,
      vacationDaysLastYear: true,
      importedVacationTaken: true,
      openingType: true,
      openingValuesLocked: true,
      openingEffectiveDate: true,
      openingOvertimeBalance: true,
      openingVacationCarryDays: true,
      openingVacationTakenYtd: true,
      openingBonusCarry: true,
      vacationCarryExpiryEnabled: true,
      vacationCarryExpiryDate: true,
    },
  });

  if (!row) {
    return null;
  }

  return {
    id,
    entryDate: row.entryDate ?? null,
    exitDate: row.exitDate ?? null,
    mindJahresumsatz: Number(row.mindJahresumsatz ?? 0),
    monatlicherBonusProzent: Number(row.monatlicherBonusProzent ?? 0),
    importedBonusEarned: Number(row.importedBonusEarned ?? 0),
    overtimeBalance: Number(row.overtimeBalance ?? 0),
    importedOvertimeBalance: Number(row.importedOvertimeBalance ?? 0),
    importedMinusBalance: Number(row.importedMinusstundenBalance ?? 0),
    maxOvertimeHours: Number(row.maxUeberstunden ?? 0),
    maxMinusHours: Number(row.maxMinusstunden ?? 0),
    vacationDaysTotal: Number(row.vacationDaysTotal ?? 0),
    vacationDaysLastYear: Number(row.vacationDaysLastYear ?? 0),
    importedVacationTaken: Number(row.importedVacationTaken ?? 0),
    openingType: row.openingType === 'existing' ? 'existing' : 'new',
    openingValuesLocked: Number(row.openingValuesLocked ?? 0) === 1,
    openingEffectiveDate: row.openingEffectiveDate ?? null,
    openingOvertimeBalance: Number(row.openingOvertimeBalance ?? 0),
    openingVacationCarryDays: Number(row.openingVacationCarryDays ?? 0),
    openingVacationTakenYtd: Number(row.openingVacationTakenYtd ?? 0),
    openingBonusCarry: Number(row.openingBonusCarry ?? 0),
    vacationCarryExpiryEnabled: Number(row.vacationCarryExpiryEnabled ?? 0) === 1,
    vacationCarryExpiryDate: row.vacationCarryExpiryDate ?? null,
  };
}

export async function getEmployeeAdminDetails(
  tenantId: string,
  id: number
): Promise<EmployeeAdminDetails | null> {
  const prisma = getPrisma();
  let row = await prisma.employee.findFirst({
    where: { id, tenantId },
    include: {
      employeeBranches: {
        where: { branch: { tenantId } },
        include: { branch: { select: { id: true, name: true } } },
      },
    },
  });

  if (!row) return null;

  if (!row.birthDate && row.controlPlaneStaffId) {
    const staffProfile = await fetchStaffProfileFromControlPlane({
      tenantId,
      staffId: row.controlPlaneStaffId,
    });

    const normalizedBirthDate =
      typeof staffProfile?.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(staffProfile.birthDate)
        ? staffProfile.birthDate
        : null;

    if (normalizedBirthDate) {
      await prisma.employee.updateMany({
        where: { id: row.id, tenantId },
        data: { birthDate: normalizedBirthDate },
      });
      row = { ...row, birthDate: normalizedBirthDate };
    }
  }

  const branches = row.employeeBranches.map((eb) => ({ id: eb.branch.id, name: eb.branch.name }));

  return {
    id: row.id,
    first_name: row.firstName,
    last_name: row.lastName,
    email: row.email ?? null,
    phone: row.phone ?? null,
    username: row.username,
    role_id: row.Rolle,
    personnel_number: row.personnelNumber,
    entry_date: row.entryDate,
    exit_date: row.exitDate ?? null,
    onboarding_status: row.onboardingStatus?.trim() || 'active',
    control_plane_staff_id: typeof row.controlPlaneStaffId === 'string' ? row.controlPlaneStaffId.trim() : null,
    booking_pin: row.bookingPin ?? '0000',
    weekly_hours: row.arbeitsstundenProWoche,
    street: row.street ?? null,
    house_number: row.houseNumber ?? null,
    zip_code: row.zipCode ?? null,
    city: row.city ?? null,
    federal_state: row.federalState ?? null,
    birth_date: row.birthDate ?? null,
    tax_class: row.taxClass ?? null,
    hourly_wage: row.hourlyWage ?? null,
    compensation_type: row.compensationType === 'fixed' ? 'fixed' : 'hourly',
    monthly_salary_gross: row.monthlySalaryGross ?? null,
    kinderfreibetrag: row.kinderfreibetrag ?? null,
    iban: row.iban?.trim() || null,
    bic: row.bic?.trim() || null,
    steuer_id: row.steuerId?.trim() || null,
    social_security_number: row.socialSecurityNumber?.trim() || null,
    health_insurance: row.healthInsurance?.trim() || null,
    health_insurance_number: row.healthInsuranceNumber?.trim() || null,
    nationality: row.nationality?.trim() || null,
    marital_status: row.maritalStatus?.trim() || null,
    employment_type: row.employmentType?.trim() || null,
    work_time_model: row.workTimeModel?.trim() || null,
    probation_months: row.probationMonths ?? null,
    tarif_group: row.tarifGroup?.trim() || null,
    vacation_days: Number(row.vacationDays ?? 0),
    vacation_days_last_year: Number(row.vacationDaysLastYear ?? 0),
    vacation_days_total: Number(row.vacationDaysTotal ?? row.vacationDays ?? 0),
    vacation_carry_expiry_enabled: Number(row.vacationCarryExpiryEnabled ?? 0) === 1,
    vacation_carry_expiry_date: row.vacationCarryExpiryDate ?? null,
    password: row.password,
    imported_overtime_balance: Number(row.importedOvertimeBalance ?? 0),
    imported_minusstunden_balance: Number(row.importedMinusstundenBalance ?? 0),
    imported_vacation_taken: Number(row.importedVacationTaken ?? 0),
    imported_bonus_earned: Number(row.importedBonusEarned ?? 0),
    opening_type: row.openingType === 'existing' ? 'existing' : 'new',
    opening_values_locked: Number(row.openingValuesLocked ?? 0) === 1,
    opening_effective_date: row.openingEffectiveDate ?? null,
    opening_overtime_balance: Number(row.openingOvertimeBalance ?? 0),
    opening_vacation_carry_days: Number(row.openingVacationCarryDays ?? 0),
    opening_vacation_taken_ytd: Number(row.openingVacationTakenYtd ?? 0),
    opening_bonus_carry: Number(row.openingBonusCarry ?? 0),
    max_ueberstunden: row.maxUeberstunden,
    max_minusstunden: row.maxMinusstunden,
    sachbezuege: row.sachbezuege,
    sachbezuege_amount: row.sachbezuegeAmount,
    mind_jahresumsatz: row.mindJahresumsatz,
    yearly_soll_hours: Number(row.yearlySollHours ?? 0),
    sachbezug_verpflegung: row.sachbezugVerpflegung,
    monatlicher_bonus_prozent: row.monatlicherBonusProzent,
    tillhub_user_id: row.tillhubUserId,
    mandatory_pause_min_work_minutes: Number(row.mandatoryPauseMinWorkMinutes ?? 0),
    min_pause_under6_minutes: Number(row.minPauseUnder6Minutes ?? 0),
    mandatoryPauseEnabled: Number(row.mandatoryPauseEnabled ?? 0) === 1,
    overtime_balance: Number(row.overtimeBalance ?? 0),
    isActive: Number(row.isActive ?? 1) === 1,
    profile_photo_file_name: row.profilePhotoFileName?.trim() || null,
    show_in_calendar: Number(row.showInCalendar ?? 1) === 1,
    branches,
    emergency_contact_name: row.emergencyContactName?.trim() || null,
    emergency_contact_phone: row.emergencyContactPhone?.trim() || null,
    emergency_contact_relation: row.emergencyContactRelation?.trim() || null,
  };
}

export function mapBaseUser(employee: EmployeeRecord): BaseUser {
  return {
    id: employee.id,
    username: employee.username,
    roleId: employee.role_id,
    accountType: 'employee',
    email: employee.email ?? undefined,
    firstName: employee.first_name,
    lastName: employee.last_name,
    employeeId: employee.id,
  };
}

function mapEmployeeRecord(row: EmployeeRecordRow): EmployeeRecord {
  return {
    id: row.id,
    first_name: row.firstName,
    last_name: row.lastName,
    email: row.email ?? null,
    phone: row.phone ?? null,
    username: row.username,
    role_id: row.Rolle,
    personnel_number: row.personnelNumber ?? null,
    control_plane_staff_id: typeof row.controlPlaneStaffId === 'string' ? row.controlPlaneStaffId.trim() : null,
    entry_date: row.entryDate,
    exit_date: row.exitDate ?? null,
    onboarding_status: row.onboardingStatus?.trim() || 'active',
    weekly_hours: row.arbeitsstundenProWoche ?? null,
    vacation_days_total: Number(row.vacationDaysTotal ?? 0),
    federal_state: row.federalState ?? null,
    // Default to visible in calendar when the field is null/undefined.
    show_in_calendar: Number(row.showInCalendar ?? 1) === 1,
  };
}

export async function updateEmployeeControlPlaneStaffId(
  tenantId: string,
  employeeId: number,
  controlPlaneStaffId: string
): Promise<void> {
  const prisma = getPrisma();
  const normalized = String(controlPlaneStaffId ?? '').trim();
  if (!normalized) return;

  // This field is UNIQUE per tenant. In case we have legacy duplicates (same person in Timesheet twice),
  // trying to "backfill" the controlPlaneStaffId would throw and break page renders/server actions.
  // We therefore treat conflicts as a no-op and keep operating via email/name lookup.
  const conflict = await prisma.employee.findFirst({
    where: { tenantId, controlPlaneStaffId: normalized, id: { not: employeeId } },
    select: { id: true },
  });
  if (conflict) return;

  try {
    await prisma.employee.updateMany({
      where: { id: employeeId, tenantId },
      data: { controlPlaneStaffId: normalized },
    });
  } catch (error) {
    // Best-effort only. Another request may have written the same staffId concurrently.
    console.warn('[employee] controlPlaneStaffId update skipped', { tenantId, employeeId }, error);
  }
}

function emptyToNull<T>(value: T | null | undefined): T | null {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }
  return value;
}

export async function updateEmployeeAdminDetails(
  tenantId: string,
  input: UpdateEmployeeAdminInput
): Promise<void> {
  const prisma = getPrisma();
  const normalizedPin = input.booking_pin.trim();

  const exists = await prisma.employee.findFirst({
    where: { id: input.id, tenantId },
    select: { id: true, bookingPin: true },
  });
  if (!exists) {
    throw new Error('Mitarbeiter wurde nicht gefunden.');
  }

  const currentPin = typeof exists.bookingPin === 'string' ? exists.bookingPin.trim() : '';
  if (normalizedPin && normalizedPin !== currentPin) {
    const existingPinOwner = await prisma.employee.findFirst({
      where: { tenantId, bookingPin: normalizedPin, id: { not: input.id } },
      select: { id: true },
    });
    if (existingPinOwner) {
      throw new Error('Buchungs-PIN wird bereits verwendet.');
    }
  }

  const data: Prisma.EmployeeUpdateInput = {
    firstName: input.first_name.trim(),
    lastName: input.last_name.trim(),
    street: emptyToNull(input.street)?.trim() ?? null,
    houseNumber: emptyToNull(input.house_number)?.trim() ?? null,
    zipCode: emptyToNull(input.zip_code)?.trim() ?? null,
    city: emptyToNull(input.city)?.trim() ?? null,
    federalState: emptyToNull(input.federal_state)?.trim() ?? null,
    birthDate: emptyToNull(input.birth_date)?.trim() ?? null,
    entryDate: input.entry_date.trim(),
    exitDate: emptyToNull(input.exit_date)?.trim() ?? null,
    phone: emptyToNull(input.phone)?.trim() ?? null,
    email: emptyToNull(input.email)?.trim() ?? null,
    bookingPin: normalizedPin,
    arbeitsstundenProWoche: emptyToNull(input.weekly_hours) ?? undefined,
    kinderfreibetrag: emptyToNull(input.kinderfreibetrag) ?? undefined,
    taxClass: emptyToNull(input.tax_class)?.trim() ?? null,
    hourlyWage: emptyToNull(input.hourly_wage) ?? undefined,
    compensationType: input.compensation_type === 'fixed' ? 'fixed' : 'hourly',
    monthlySalaryGross: emptyToNull(input.monthly_salary_gross) ?? null,
    iban: emptyToNull(input.iban)?.trim() ?? null,
    bic: emptyToNull(input.bic)?.trim() ?? null,
    steuerId: emptyToNull(input.steuer_id)?.trim() ?? null,
    socialSecurityNumber: emptyToNull(input.social_security_number)?.trim() ?? null,
    healthInsurance: emptyToNull(input.health_insurance)?.trim() ?? null,
    healthInsuranceNumber: emptyToNull(input.health_insurance_number)?.trim() ?? null,
    nationality: emptyToNull(input.nationality)?.trim() ?? null,
    maritalStatus: emptyToNull(input.marital_status)?.trim() ?? null,
    employmentType: emptyToNull(input.employment_type)?.trim() ?? null,
    workTimeModel: emptyToNull(input.work_time_model)?.trim() ?? null,
    probationMonths: emptyToNull(input.probation_months),
    tarifGroup: emptyToNull(input.tarif_group)?.trim() ?? null,
    emergencyContactName: emptyToNull(input.emergency_contact_name)?.trim() ?? null,
    emergencyContactPhone: emptyToNull(input.emergency_contact_phone)?.trim() ?? null,
    emergencyContactRelation: emptyToNull(input.emergency_contact_relation)?.trim() ?? null,
    vacationDays: Number(input.vacation_days ?? 0),
    vacationDaysLastYear: Number(input.vacation_days_last_year ?? 0),
    vacationDaysTotal: Number(input.vacation_days_total ?? 0),
    vacationCarryExpiryEnabled: input.vacation_carry_expiry_enabled ? 1 : 0,
    vacationCarryExpiryDate: emptyToNull(input.vacation_carry_expiry_date)?.trim() ?? null,
    Rolle: input.role_id,
    username: input.username.trim(),
    importedOvertimeBalance: Number(input.imported_overtime_balance ?? 0),
    importedMinusstundenBalance: Number(input.imported_minusstunden_balance ?? 0),
    importedVacationTaken: Number(input.imported_vacation_taken ?? 0),
    importedBonusEarned: Number(input.imported_bonus_earned ?? 0),
    showInCalendar: input.show_in_calendar ? 1 : 0,
  };

  if (input.passwordHash) {
    data.password = input.passwordHash;
  }

  await prisma.employee.update({
    where: { id: input.id },
    data,
  });
}

export async function createEmployee(tenantId: string, input: CreateEmployeeInput): Promise<number> {
  const prisma = getPrisma();
  const username = input.username.trim();
  const personnelNumber = input.personnel_number.trim();
  const normalizedPin = input.booking_pin.trim();

  const [existingUsername, existingPersonnel, existingPin] = await Promise.all([
    prisma.employee.findFirst({ where: { tenantId, username }, select: { id: true } }),
    prisma.employee.findFirst({ where: { tenantId, personnelNumber }, select: { id: true } }),
    prisma.employee.findFirst({ where: { tenantId, bookingPin: normalizedPin }, select: { id: true } }),
  ]);

  if (existingUsername) {
    throw new Error('Benutzername ist bereits vergeben.');
  }
  if (existingPersonnel) {
    throw new Error('Personalnummer ist bereits vergeben.');
  }
  if (existingPin) {
    throw new Error('Buchungs-PIN wird bereits verwendet.');
  }

  const showInCalendar = input.show_in_calendar !== false;
  const isActive = input.is_active !== false;
  const onboardingStatus = (input.onboarding_status ?? (isActive ? 'active' : 'pending')).trim() || 'active';

  const created = await prisma.employee.create({
    data: {
      tenantId,
      firstName: input.first_name.trim(),
      lastName: input.last_name.trim(),
      entryDate: input.entry_date.trim(),
      exitDate: emptyToNull(input.exit_date)?.trim() ?? null,
      phone: emptyToNull(input.phone)?.trim() ?? null,
      email: emptyToNull(input.email)?.trim() ?? null,
      personnelNumber,
      bookingPin: normalizedPin,
      arbeitsstundenProWoche: input.weekly_hours ?? 40,
      compensationType: input.compensation_type === 'fixed' ? 'fixed' : 'hourly',
      monthlySalaryGross: emptyToNull(input.monthly_salary_gross) ?? null,
      kinderfreibetrag: input.kinderfreibetrag ?? 0,
      iban: emptyToNull(input.iban)?.trim() ?? null,
      bic: emptyToNull(input.bic)?.trim() ?? null,
      steuerId: emptyToNull(input.steuer_id)?.trim() ?? null,
      socialSecurityNumber: emptyToNull(input.social_security_number)?.trim() ?? null,
      healthInsurance: emptyToNull(input.health_insurance)?.trim() ?? null,
      healthInsuranceNumber: emptyToNull(input.health_insurance_number)?.trim() ?? null,
      nationality: emptyToNull(input.nationality)?.trim() ?? null,
      maritalStatus: emptyToNull(input.marital_status)?.trim() ?? null,
      employmentType: emptyToNull(input.employment_type)?.trim() ?? null,
      workTimeModel: emptyToNull(input.work_time_model)?.trim() ?? null,
      probationMonths: emptyToNull(input.probation_months),
      tarifGroup: emptyToNull(input.tarif_group)?.trim() ?? null,
      emergencyContactName: emptyToNull(input.emergency_contact_name)?.trim() ?? null,
      emergencyContactPhone: emptyToNull(input.emergency_contact_phone)?.trim() ?? null,
      emergencyContactRelation: emptyToNull(input.emergency_contact_relation)?.trim() ?? null,
      vacationDays: input.vacation_days ?? 20,
      vacationDaysLastYear: input.vacation_days_last_year ?? 0,
      vacationDaysTotal: input.vacation_days_total ?? input.vacation_days ?? 20,
      Rolle: input.role_id,
      username,
      password: input.passwordHash,
      mandatoryPauseEnabled: input.mandatory_pause_enabled ? 1 : 0,
      showInCalendar: showInCalendar ? 1 : 0,
      isActive: isActive ? 1 : 0,
      onboardingStatus,
      onboardingSubmittedAt: input.onboarding_submitted_at ?? null,
      profilePhotoFileName: input.profile_photo_file_name ?? null,
    },
    select: { id: true },
  });

  return created.id;
}

export async function setEmployeeActiveStatus(
  tenantId: string,
  employeeId: number,
  isActive: boolean
): Promise<void> {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    const existing = await tx.employee.findFirst({
      where: { id: employeeId, tenantId },
      select: { onboardingStatus: true },
    });
    if (!existing) {
      throw new Error('Mitarbeiter wurde nicht gefunden.');
    }
    const normalizedStatus = (existing.onboardingStatus ?? '').trim().toLowerCase();
    const keepPinSetupRequired = normalizedStatus === 'pin_setup_required';

    const updated = await tx.employee.updateMany({
      where: { id: employeeId, tenantId },
      data: {
        isActive: isActive ? 1 : 0,
        ...(isActive ? {} : { showInCalendar: 0 }),
        ...(isActive ? { onboardingStatus: keepPinSetupRequired ? 'pin_setup_required' : 'active' } : {}),
      },
    });
    if (updated.count === 0) {
      throw new Error('Mitarbeiter wurde nicht gefunden.');
    }
    if (!isActive) {
      await tx.employeeBranch.deleteMany({ where: { employeeId } });
    }
  });
}

export async function setEmployeeOnboardingStatus(
  tenantId: string,
  employeeId: number,
  onboardingStatus: string
): Promise<void> {
  const prisma = getPrisma();
  const normalized = onboardingStatus.trim();
  if (!normalized) {
    throw new Error('Ungültiger Onboarding-Status.');
  }
  const updated = await prisma.employee.updateMany({
    where: { id: employeeId, tenantId },
    data: { onboardingStatus: normalized },
  });
  if (updated.count === 0) {
    throw new Error('Mitarbeiter wurde nicht gefunden.');
  }
}

export async function deleteEmployeeById(tenantId: string, id: number): Promise<void> {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await tx.employeeBranch.deleteMany({ where: { employeeId: id } });
    const deleted = await tx.employee.deleteMany({ where: { id, tenantId } });
    if (deleted.count === 0) {
      throw new Error('Mitarbeiter wurde nicht gefunden.');
    }
  });
}

export async function employeeExists(tenantId: string, id: number): Promise<boolean> {
  const prisma = getPrisma();
  const total = await prisma.employee.count({ where: { id, tenantId } });
  return total > 0;
}

export async function getEmployeeValidationInfo(
  tenantId: string,
  employeeId: number
): Promise<EmployeeValidationInfo | null> {
  const prisma = getPrisma();
  const row = await prisma.employee.findFirst({
    where: { id: employeeId, tenantId },
    select: {
      id: true,
      sachbezugVerpflegung: true,
      mandatoryPauseMinWorkMinutes: true,
      minPauseUnder6Minutes: true,
      federalState: true,
      tillhubUserId: true,
    },
  });

  if (!row) {
    return null;
  }

  const branches = await listBranchesForEmployee(tenantId, employeeId);
  const primaryBranch = branches[0] ?? null;
  const branchRegion = primaryBranch?.federalState ?? primaryBranch?.country ?? null;
  const fallbackRegion = row.federalState?.trim() || null;

  return {
    id: Number(row.id),
    sachbezugVerpflegung: (row.sachbezugVerpflegung ?? 'Nein').trim() || 'Nein',
    mandatoryPauseMinWorkMinutes: Number(row.mandatoryPauseMinWorkMinutes ?? 0) || 0,
    minPauseUnder6Minutes: Number(row.minPauseUnder6Minutes ?? 0) || 0,
    federalState: branchRegion || fallbackRegion,
    tillhubUserId: row.tillhubUserId?.trim() || null,
  };
}

export async function getEmployeeOvertimeSettings(
  tenantId: string,
  employeeId: number
): Promise<EmployeeOvertimeSettingsRow> {
  const prisma = getPrisma();
  const row = await prisma.employee.findFirst({
    where: { id: employeeId, tenantId },
    select: {
      maxUeberstunden: true,
      maxMinusstunden: true,
      overtimeBalance: true,
    },
  });

  if (!row) {
    return {
      maxOvertimeHours: 0,
      maxMinusHours: 0,
      overtimeBalance: 0,
    };
  }

  return {
    maxOvertimeHours: Number(row.maxUeberstunden ?? 0) || 0,
    maxMinusHours: Number(row.maxMinusstunden ?? 0) || 0,
    overtimeBalance: Number(row.overtimeBalance ?? 0) || 0,
  };
}

export async function updateEmployeeOvertimeBalance(
  tenantId: string,
  employeeId: number,
  newBalance: number
): Promise<void> {
  const prisma = getPrisma();
  const updated = await prisma.employee.updateMany({
    where: { id: employeeId, tenantId },
    data: { overtimeBalance: newBalance },
  });
  if (updated.count === 0) {
    throw new Error('Mitarbeiter wurde nicht gefunden.');
  }
}

export async function getEmployeeFederalState(
  tenantId: string,
  employeeId: number
): Promise<string | null> {
  const prisma = getPrisma();
  const row = await prisma.employee.findFirst({
    where: { id: employeeId, tenantId },
    select: { federalState: true },
  });
  const value = row?.federalState?.trim();
  return value && value.length ? value : null;
}

export async function updateEmployeeSettings(
  tenantId: string,
  input: EmployeeSettingsInput
): Promise<void> {
  const prisma = getPrisma();
  const updated = await prisma.employee.updateMany({
    where: { id: input.employeeId, tenantId },
    data: {
      maxMinusstunden: input.maxMinusHours ?? undefined,
      maxUeberstunden: input.maxOvertimeHours ?? undefined,
      sachbezuege: input.sachbezuege,
      sachbezuegeAmount: input.sachbezuegeAmount,
      mindJahresumsatz: input.mindJahresumsatz,
      sachbezugVerpflegung: input.sachbezugVerpflegung,
      monatlicherBonusProzent: input.monatlicherBonusProzent,
      importedOvertimeBalance: input.importedOvertimeBalance,
      importedMinusstundenBalance: input.importedMinusstundenBalance,
      importedVacationTaken: input.importedVacationCarryDays,
      importedBonusEarned: input.importedBonusEarned,
      openingType: input.openingType,
      openingValuesLocked: input.openingValuesLocked ? 1 : 0,
      openingEffectiveDate: emptyToNull(input.openingEffectiveDate)?.trim() ?? null,
      openingOvertimeBalance: input.openingOvertimeBalance,
      openingVacationCarryDays: input.openingVacationCarryDays,
      openingVacationTakenYtd: input.openingVacationTakenYtd,
      openingBonusCarry: input.openingBonusCarry,
      mandatoryPauseMinWorkMinutes: input.mandatoryPauseMinWorkMinutes,
      minPauseUnder6Minutes: input.minPauseUnder6Minutes,
      mandatoryPauseEnabled: input.mandatoryPauseEnabled ? 1 : 0,
    },
  });
  if (updated.count === 0) {
    throw new Error('Mitarbeiter wurde nicht gefunden.');
  }
}

export async function updateEmployeeTillhubUserId(
  tenantId: string,
  employeeId: number,
  tillhubUserId: string | null
): Promise<void> {
  const prisma = getPrisma();
  const updated = await prisma.employee.updateMany({
    where: { id: employeeId, tenantId },
    data: { tillhubUserId: emptyToNull(tillhubUserId)?.trim() ?? null },
  });
  if (updated.count === 0) {
    throw new Error('Mitarbeiter wurde nicht gefunden.');
  }
}

export async function getBonusScheme(tenantId: string, employeeId: number): Promise<BonusScheme> {
  const prisma = getPrisma();
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, tenantId }, select: { id: true } });
  if (!employee) {
    return { schemeType: 'linear', linearPercent: 0 };
  }
  const row = await prisma.bonusScheme.findUnique({
    where: { employeeId },
    select: { schemeType: true, linearPercent: true },
  });

  if (!row) {
    return { schemeType: 'linear', linearPercent: 0 };
  }

  const scheme = row.schemeType === 'stufen' ? 'stufen' : 'linear';
  return {
    schemeType: scheme,
    linearPercent: Number(row.linearPercent ?? 0),
  };
}

export async function saveBonusScheme(
  tenantId: string,
  employeeId: number,
  scheme: BonusScheme
): Promise<void> {
  const prisma = getPrisma();
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, tenantId }, select: { id: true } });
  if (!employee) {
    throw new Error('Mitarbeiter wurde nicht gefunden.');
  }
  await prisma.bonusScheme.upsert({
    where: { employeeId },
    update: { schemeType: scheme.schemeType, linearPercent: scheme.linearPercent },
    create: { employeeId, schemeType: scheme.schemeType, linearPercent: scheme.linearPercent },
  });
}

export async function listBonusTiers(tenantId: string, employeeId: number): Promise<BonusTier[]> {
  const prisma = getPrisma();
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, tenantId }, select: { id: true } });
  if (!employee) {
    return [];
  }
  const rows = await prisma.bonusTier.findMany({
    where: { employeeId },
    orderBy: { threshold: 'asc' },
    select: { threshold: true, percent: true },
  });
  return rows.map((row) => ({ threshold: Number(row.threshold ?? 0), percent: Number(row.percent ?? 0) }));
}

export async function replaceBonusTiers(
  tenantId: string,
  employeeId: number,
  tiers: BonusTier[]
): Promise<void> {
  const prisma = getPrisma();
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, tenantId }, select: { id: true } });
  if (!employee) {
    throw new Error('Mitarbeiter wurde nicht gefunden.');
  }
  await prisma.$transaction(async (tx) => {
    await tx.bonusTier.deleteMany({ where: { employeeId } });
    if (tiers.length) {
      await tx.bonusTier.createMany({
        data: tiers.map((tier) => ({
          employeeId,
          threshold: tier.threshold,
          percent: tier.percent,
        })),
      });
    }
  });
}
