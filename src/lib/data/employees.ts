import type { BaseUser } from '@/lib/auth';
import { getPrisma } from '@/lib/prisma';
import { listBranchesForEmployee, listBranchesForEmployees, type BranchSummary } from '@/lib/data/branches';

export interface EmployeeRecord {
  id: number;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  username: string;
  role_id: number;
  personnel_number: string | null;
  entry_date: string;
  weekly_hours: number | null;
  vacation_days_total: number;
  show_in_calendar: boolean;
}

export interface EmployeeAdminDetails extends EmployeeRecord {
  street: string | null;
  zip_code: string | null;
  city: string | null;
  birth_date: string | null;
  booking_pin: string;
  federal_state: string | null;
  tax_class: string | null;
  hourly_wage: number | null;
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
  password: string;
  imported_overtime_balance: number;
  imported_minusstunden_balance: number;
  imported_vacation_taken: number;
  imported_bonus_earned: number;
  max_ueberstunden: number | null;
  max_minusstunden: number | null;
  sachbezuege: string | null;
  sachbezuege_amount: number | null;
  mind_jahresumsatz: number | null;
  yearly_soll_hours: number;
  sachbezug_verpflegung: string | null;
  monatlicher_bonus_prozent: number | null;
  tillhub_user_id: string | null;
  min_pause_under6_minutes: number;
  mandatoryPauseEnabled: boolean;
  isActive: boolean;
  branches: BranchSummary[];
}

export interface UpdateEmployeeAdminInput {
  id: number;
  first_name: string;
  last_name: string;
  street: string | null;
  zip_code: string | null;
  city: string | null;
  birth_date: string | null;
  entry_date: string;
  phone: string | null;
  email: string | null;
  booking_pin: string;
  federal_state: string | null;
  weekly_hours: number | null;
  kinderfreibetrag: number | null;
  tax_class: string | null;
  hourly_wage: number | null;
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
  personnel_number: string;
  booking_pin: string;
  username: string;
  passwordHash: string;
  role_id: number;
  email?: string | null;
  phone?: string | null;
  weekly_hours?: number | null;
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
  branches: BranchSummary[];
  showInCalendar: boolean;
}

export interface EmployeeValidationInfo {
  id: number;
  sachbezugVerpflegung: string;
  minPauseUnder6Minutes: number;
  federalState: string | null;
  tillhubUserId: string | null;
}

export interface EmployeeSelfSummaryData {
  id: number;
  entryDate: string | null;
  mindJahresumsatz: number;
  monatlicherBonusProzent: number;
  importedBonusEarned: number;
  importedOvertimeBalance: number;
  importedMinusBalance: number;
  maxOvertimeHours: number;
  maxMinusHours: number;
  vacationDays: number;
  vacationDaysLastYear: number;
  importedVacationTaken: number;
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
      username: true,
      Rolle: true,
      isActive: true,
      showInCalendar: true,
    },
    orderBy: [
      { isActive: 'desc' },
      { lastName: 'asc' },
      { firstName: 'asc' },
    ],
  });

  const branchMap = await listBranchesForEmployees(tenantId, rows.map((row) => row.id));

  return rows.map((row) => ({
    id: row.id,
    displayName: `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim(),
    roleId: row.Rolle,
    username: row.username,
    isActive: Number(row.isActive ?? 1) === 1,
    showInCalendar: Number(row.showInCalendar ?? 1) === 1,
    branches: branchMap.get(row.id) ?? [],
  }));
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
      entryDate: true,
      arbeitsstundenProWoche: true,
      vacationDaysTotal: true,
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
      mindJahresumsatz: true,
      monatlicherBonusProzent: true,
      importedBonusEarned: true,
      importedOvertimeBalance: true,
      importedMinusstundenBalance: true,
      maxUeberstunden: true,
      maxMinusstunden: true,
      vacationDays: true,
      vacationDaysLastYear: true,
      importedVacationTaken: true,
    },
  });

  if (!row) {
    return null;
  }

  return {
    id,
    entryDate: row.entryDate ?? null,
    mindJahresumsatz: Number(row.mindJahresumsatz ?? 0),
    monatlicherBonusProzent: Number(row.monatlicherBonusProzent ?? 0),
    importedBonusEarned: Number(row.importedBonusEarned ?? 0),
    importedOvertimeBalance: Number(row.importedOvertimeBalance ?? 0),
    importedMinusBalance: Number(row.importedMinusstundenBalance ?? 0),
    maxOvertimeHours: Number(row.maxUeberstunden ?? 0),
    maxMinusHours: Number(row.maxMinusstunden ?? 0),
    vacationDays: Number(row.vacationDays ?? 0),
    vacationDaysLastYear: Number(row.vacationDaysLastYear ?? 0),
    importedVacationTaken: Number(row.importedVacationTaken ?? 0),
  };
}

export async function getEmployeeAdminDetails(
  tenantId: string,
  id: number
): Promise<EmployeeAdminDetails | null> {
  const prisma = getPrisma();
  const row = await prisma.employee.findFirst({
    where: { id, tenantId },
    include: {
      employeeBranches: {
        where: { branch: { tenantId } },
        include: { branch: { select: { id: true, name: true } } },
      },
    },
  });

  if (!row) return null;

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
    booking_pin: row.bookingPin ?? '0000',
    weekly_hours: row.arbeitsstundenProWoche,
    street: row.street ?? null,
    zip_code: row.zipCode ?? null,
    city: row.city ?? null,
    federal_state: row.federalState ?? null,
    birth_date: row.birthDate ?? null,
    tax_class: row.taxClass ?? null,
    hourly_wage: row.hourlyWage ?? null,
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
    password: row.password,
    imported_overtime_balance: Number(row.importedOvertimeBalance ?? 0),
    imported_minusstunden_balance: Number(row.importedMinusstundenBalance ?? 0),
    imported_vacation_taken: Number(row.importedVacationTaken ?? 0),
    imported_bonus_earned: Number(row.importedBonusEarned ?? 0),
    max_ueberstunden: row.maxUeberstunden,
    max_minusstunden: row.maxMinusstunden,
    sachbezuege: row.sachbezuege,
    sachbezuege_amount: row.sachbezuegeAmount,
    mind_jahresumsatz: row.mindJahresumsatz,
    yearly_soll_hours: Number(row.yearlySollHours ?? 0),
    sachbezug_verpflegung: row.sachbezugVerpflegung,
    monatlicher_bonus_prozent: row.monatlicherBonusProzent,
    tillhub_user_id: row.tillhubUserId,
    min_pause_under6_minutes: Number(row.minPauseUnder6Minutes ?? 0),
    mandatoryPauseEnabled: Number(row.mandatoryPauseEnabled ?? 0) === 1,
    isActive: Number(row.isActive ?? 1) === 1,
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

function mapEmployeeRecord(row: any): EmployeeRecord {
  return {
    id: row.id,
    first_name: row.firstName,
    last_name: row.lastName,
    email: row.email ?? null,
    phone: row.phone ?? null,
    username: row.username,
    role_id: row.Rolle,
    personnel_number: row.personnelNumber ?? null,
    entry_date: row.entryDate,
    weekly_hours: row.arbeitsstundenProWoche ?? null,
    vacation_days_total: Number(row.vacationDaysTotal ?? 0),
    // Default to visible in calendar when the field is null/undefined.
    show_in_calendar: Number(row.showInCalendar ?? 1) === 1,
  };
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

  const existingPinOwner = await prisma.employee.findFirst({
    where: { tenantId, bookingPin: normalizedPin, id: { not: input.id } },
    select: { id: true },
  });
  if (existingPinOwner) {
    throw new Error('Buchungs-PIN wird bereits verwendet.');
  }

  const exists = await prisma.employee.findFirst({
    where: { id: input.id, tenantId },
    select: { id: true },
  });
  if (!exists) {
    throw new Error('Mitarbeiter wurde nicht gefunden.');
  }

  const data: any = {
    firstName: input.first_name.trim(),
    lastName: input.last_name.trim(),
    street: emptyToNull(input.street)?.trim() ?? null,
    zipCode: emptyToNull(input.zip_code)?.trim() ?? null,
    city: emptyToNull(input.city)?.trim() ?? null,
    federalState: emptyToNull(input.federal_state)?.trim() ?? null,
    birthDate: emptyToNull(input.birth_date)?.trim() ?? null,
    entryDate: input.entry_date.trim(),
    phone: emptyToNull(input.phone)?.trim() ?? null,
    email: emptyToNull(input.email)?.trim() ?? null,
    bookingPin: normalizedPin,
    arbeitsstundenProWoche: emptyToNull(input.weekly_hours),
    kinderfreibetrag: emptyToNull(input.kinderfreibetrag),
    taxClass: emptyToNull(input.tax_class)?.trim() ?? null,
    hourlyWage: emptyToNull(input.hourly_wage),
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

  const created = await prisma.employee.create({
    data: {
      tenantId,
      firstName: input.first_name.trim(),
      lastName: input.last_name.trim(),
      entryDate: input.entry_date.trim(),
      phone: emptyToNull(input.phone)?.trim() ?? null,
      email: emptyToNull(input.email)?.trim() ?? null,
      personnelNumber,
      bookingPin: normalizedPin,
      arbeitsstundenProWoche: input.weekly_hours ?? 40,
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
      isActive: 1,
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
    const updated = await tx.employee.updateMany({
      where: { id: employeeId, tenantId },
      data: { isActive: isActive ? 1 : 0, showInCalendar: isActive ? 1 : 0 },
    });
    if (updated.count === 0) {
      throw new Error('Mitarbeiter wurde nicht gefunden.');
    }
    if (!isActive) {
      await tx.employeeBranch.deleteMany({ where: { employeeId } });
    }
  });
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
      maxMinusstunden: input.maxMinusHours,
      maxUeberstunden: input.maxOvertimeHours,
      sachbezuege: input.sachbezuege,
      sachbezuegeAmount: input.sachbezuegeAmount,
      mindJahresumsatz: input.mindJahresumsatz,
      sachbezugVerpflegung: input.sachbezugVerpflegung,
      monatlicherBonusProzent: input.monatlicherBonusProzent,
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
