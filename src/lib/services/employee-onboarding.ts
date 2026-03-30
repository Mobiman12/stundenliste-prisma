import { createHash, randomBytes } from 'crypto';
import path from 'path';

import type { Prisma } from '@prisma/client';

import { hashPassword } from '@/lib/auth';
import { pushStaffPhotoUpdateToControlPlane, upsertStaffInControlPlane } from '@/lib/control-plane';
import { getPrisma } from '@/lib/prisma';
import { normalizeCountry, normalizeFederalState, type CountryCode } from '@/lib/region-options';
import { withAppBasePath } from '@/lib/routes';
import { ALLOWED_DOCUMENT_EXTENSIONS, saveEmployeeDocumentFromBuffer } from '@/lib/services/documents';
import { sendMail, sendTextMail } from '@/lib/services/email';

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_BYTES = 32;
const DEFAULT_INVITE_TTL_HOURS = Number.parseInt(process.env.EMPLOYEE_ONBOARDING_INVITE_TTL_HOURS ?? '168', 10);
const MAX_ATTACHMENTS = Number.parseInt(process.env.EMPLOYEE_ONBOARDING_MAX_ATTACHMENTS ?? '8', 10);
const MAX_DOCUMENT_SIZE_BYTES = Number.parseInt(process.env.MAX_DOCUMENT_SIZE ?? '10485760', 10);
const MAX_SIGNATURE_DATA_URL_LENGTH = 1_000_000;
const TAX_CLASS_SET = new Set(['1', '2', '3', '4', '5', '6']);
const TENANT_MAIL_NAME_CACHE = new Map<string, string>();

export type OnboardingInviteCreateInput = {
  tenantId: string;
  createdByAdminId?: number | null;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  message?: string | null;
  adminPreset: OnboardingInviteAdminPresetInput;
  origin: string;
};

export type OnboardingInviteAdminPresetInput = {
  entryDate: string;
  tarifGroup: string;
  employmentType: string;
  workTimeModel: string;
  weeklyHours: number;
  probationMonths: number;
  compensationType: 'hourly' | 'fixed';
  hourlyWage?: number | null;
  monthlySalaryGross?: number | null;
  vacationDaysTotal: number;
};

export type OnboardingInviteAdminPreset = {
  entryDate: string;
  tarifGroup: string;
  employmentType: string;
  workTimeModel: string;
  weeklyHours: number;
  probationMonths: number;
  compensationType: 'hourly' | 'fixed';
  hourlyWage: number | null;
  monthlySalaryGross: number | null;
  vacationDaysTotal: number;
};

export type OnboardingTenantBranding = {
  logoUrl: string | null;
  companyAddressLines: string[];
};

export type OnboardingInviteCreateResult = {
  inviteId: number;
  inviteUrl: string;
  expiresAt: Date;
  email: string;
};

export type OnboardingInviteStatus = 'open' | 'used' | 'expired' | 'revoked' | 'invalid';

export type OnboardingInviteView = {
  status: OnboardingInviteStatus;
  email?: string;
  firstName?: string | null;
  lastName?: string | null;
  expiresAt?: Date;
  usedAt?: Date | null;
  adminPreset?: OnboardingInviteAdminPreset | null;
  tenantBranding?: OnboardingTenantBranding | null;
};

export type OnboardingInviteListItem = {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  status: OnboardingInviteStatus;
  employeeId: number | null;
  employeeFirstName: string | null;
  employeeLastName: string | null;
};

export type EmployeeOnboardingSubmissionSnapshot = {
  inviteId: number;
  inviteCreatedAt: Date;
  submittedAt: Date | null;
  inviteEmail: string;
  inviteFirstName: string | null;
  inviteLastName: string | null;
  signatureName: string | null;
  signatureAcceptedAt: Date | null;
  adminPreset: OnboardingInviteAdminPreset | null;
  submission: Record<string, string | number | boolean | null>;
};

export type OnboardingFileUpload = {
  name: string;
  size: number;
  buffer: Buffer;
};

export type EmployeeOnboardingSubmitInput = {
  tenantId: string;
  token: string;
  origin: string;
  submittedFromIp?: string | null;
  submittedFromUserAgent?: string | null;
  profilePhoto?: OnboardingFileUpload | null;
  attachments: OnboardingFileUpload[];
  firstName: string;
  lastName: string;
  street?: string | null;
  houseNumber?: string | null;
  country?: string | null;
  federalState?: string | null;
  zipCode?: string | null;
  city?: string | null;
  birthDate?: string | null;
  phone?: string | null;
  email?: string | null;
  nationality?: string | null;
  maritalStatus?: string | null;
  taxClass?: string | null;
  kinderfreibetrag?: number | null;
  steuerId?: string | null;
  socialSecurityNumber?: string | null;
  healthInsurance?: string | null;
  healthInsuranceNumber?: string | null;
  iban?: string | null;
  bic?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelation?: string | null;
  tarifGroup?: string | null;
  entryDate: string;
  employmentType?: string | null;
  workTimeModel?: string | null;
  probationMonths?: number | null;
  weeklyHours?: number | null;
  compensationType?: 'hourly' | 'fixed';
  hourlyWage?: number | null;
  monthlySalaryGross?: number | null;
  vacationDaysTotal?: number | null;
  signatureName: string;
  signatureDataUrl: string;
  consentAccepted: boolean;
};

export type EmployeeOnboardingSubmitResult = {
  employeeId: number;
  employeeDisplayName: string;
  warnings: string[];
};

class OnboardingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnboardingValidationError';
  }
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim();
  return normalized.length ? normalized : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function assertEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(normalized)) {
    throw new OnboardingValidationError('Bitte eine gültige E-Mail-Adresse eingeben.');
  }
  return normalized;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function inviteTtlHours(): number {
  if (!Number.isFinite(DEFAULT_INVITE_TTL_HOURS) || DEFAULT_INVITE_TTL_HOURS <= 0) {
    return 168;
  }
  return DEFAULT_INVITE_TTL_HOURS;
}

function buildInviteLink(origin: string, token: string): string {
  const pathWithBase = withAppBasePath(`/bewerbung/${encodeURIComponent(token)}`, 'external');
  return new URL(pathWithBase, origin).toString();
}

function parseDataUrlPng(dataUrl: string): Buffer {
  const trimmed = String(dataUrl ?? '').trim();
  if (!trimmed) {
    throw new OnboardingValidationError('Die Unterschrift fehlt.');
  }
  if (trimmed.length > MAX_SIGNATURE_DATA_URL_LENGTH) {
    throw new OnboardingValidationError('Die Unterschrift ist zu groß. Bitte erneut unterschreiben.');
  }
  const match = trimmed.match(/^data:image\/png;base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) {
    throw new OnboardingValidationError('Ungültiges Unterschrift-Format.');
  }
  return Buffer.from(match[1], 'base64');
}

function sanitizeBaseName(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'datei';
}

function assertSupportedFile(file: OnboardingFileUpload): string {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new OnboardingValidationError('Ungültige Dateiübertragung.');
  }
  if (file.size <= 0) {
    throw new OnboardingValidationError('Leere Dateien sind nicht erlaubt.');
  }
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    throw new OnboardingValidationError('Mindestens eine Datei ist zu groß (max. 10 MB).');
  }
  const ext = path.extname(file.name || '').replace('.', '').toLowerCase();
  if (!ALLOWED_DOCUMENT_EXTENSIONS.includes(ext as (typeof ALLOWED_DOCUMENT_EXTENSIONS)[number])) {
    throw new OnboardingValidationError(
      `Dateityp .${ext || 'unbekannt'} ist nicht erlaubt. Erlaubt: ${ALLOWED_DOCUMENT_EXTENSIONS.join(', ')}`
    );
  }
  return ext;
}

function parseIsoDate(value: string | null | undefined, fieldLabel: string): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (!ISO_DATE_REGEX.test(normalized)) {
    throw new OnboardingValidationError(`${fieldLabel} muss im Format YYYY-MM-DD sein.`);
  }
  return normalized;
}

function parseOptionalNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

function assertRequiredText(value: string | null | undefined, label: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new OnboardingValidationError(`${label} ist erforderlich.`);
  }
  return normalized;
}

function assertRequiredNumber(
  value: number | null | undefined,
  label: string,
  opts?: { min?: number; max?: number }
): number {
  const parsed = parseOptionalNumber(value);
  if (parsed === null) {
    throw new OnboardingValidationError(`${label} ist erforderlich.`);
  }
  const min = opts?.min;
  const max = opts?.max;
  if (Number.isFinite(min) && parsed < Number(min)) {
    throw new OnboardingValidationError(`${label} muss mindestens ${Number(min)} sein.`);
  }
  if (Number.isFinite(max) && parsed > Number(max)) {
    throw new OnboardingValidationError(`${label} darf maximal ${Number(max)} sein.`);
  }
  return parsed;
}

function normalizePhoneNumber(value: string | null | undefined, label = 'Telefon'): string {
  const raw = assertRequiredText(value, label);
  let normalized = raw.replace(/[^\d+]/g, '');
  if (normalized.startsWith('00')) {
    normalized = `+${normalized.slice(2)}`;
  }
  if (!/^\+?\d{6,20}$/.test(normalized) || (normalized.includes('+') && !normalized.startsWith('+'))) {
    throw new OnboardingValidationError(`${label} muss eine gültige Telefonnummer sein.`);
  }
  return normalized;
}

function normalizePostalCode(country: CountryCode, value: string | null | undefined): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  const requiredLength = country === 'DE' ? 5 : 4;
  if (digits.length !== requiredLength) {
    throw new OnboardingValidationError(`PLZ muss für ${country} genau ${requiredLength} Ziffern enthalten.`);
  }
  return digits;
}

function parseInvitePayload(raw: string | null | undefined): Record<string, unknown> | null {
  const normalized = normalizeText(raw);
  if (!normalized) return null;
  try {
    const parsed = JSON.parse(normalized);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readAdminPresetFromInvitePayload(raw: string | null | undefined): OnboardingInviteAdminPreset | null {
  const payload = parseInvitePayload(raw);
  if (!payload) return null;

  const candidateRaw =
    payload.adminPreset && typeof payload.adminPreset === 'object'
      ? (payload.adminPreset as Record<string, unknown>)
      : payload;

  const entryDateRaw = typeof candidateRaw.entryDate === 'string' ? candidateRaw.entryDate.trim() : '';
  if (!ISO_DATE_REGEX.test(entryDateRaw)) return null;
  const tarifGroup = typeof candidateRaw.tarifGroup === 'string' ? candidateRaw.tarifGroup.trim() : '';
  const employmentType = typeof candidateRaw.employmentType === 'string' ? candidateRaw.employmentType.trim() : '';
  const workTimeModel = typeof candidateRaw.workTimeModel === 'string' ? candidateRaw.workTimeModel.trim() : '';
  const weeklyHoursRaw = Number(candidateRaw.weeklyHours);
  const probationMonthsRaw = Number(candidateRaw.probationMonths);
  const compensationTypeRaw =
    candidateRaw.compensationType === 'fixed' || candidateRaw.compensationType === 'hourly'
      ? candidateRaw.compensationType
      : null;
  const vacationDaysRaw = Number(candidateRaw.vacationDaysTotal);
  if (!tarifGroup || !employmentType || !workTimeModel || !compensationTypeRaw) return null;
  if (!Number.isFinite(weeklyHoursRaw) || weeklyHoursRaw <= 0 || weeklyHoursRaw > 168) return null;
  if (!Number.isFinite(probationMonthsRaw) || probationMonthsRaw < 0) return null;
  if (!Number.isFinite(vacationDaysRaw) || vacationDaysRaw <= 0) return null;

  const hourlyWageRaw =
    candidateRaw.hourlyWage === null || candidateRaw.hourlyWage === undefined
      ? null
      : Number(candidateRaw.hourlyWage);
  const monthlySalaryRaw =
    candidateRaw.monthlySalaryGross === null || candidateRaw.monthlySalaryGross === undefined
      ? null
      : Number(candidateRaw.monthlySalaryGross);

  return {
    entryDate: entryDateRaw,
    tarifGroup,
    employmentType,
    workTimeModel,
    weeklyHours: Number(weeklyHoursRaw),
    probationMonths: Math.round(probationMonthsRaw),
    compensationType: compensationTypeRaw,
    hourlyWage: Number.isFinite(hourlyWageRaw ?? NaN) ? hourlyWageRaw : null,
    monthlySalaryGross: Number.isFinite(monthlySalaryRaw ?? NaN) ? monthlySalaryRaw : null,
    vacationDaysTotal: Math.round(vacationDaysRaw),
  };
}

function readBranchLogoFromMetadata(raw: string | null | undefined): string | null {
  const payload = parseInvitePayload(raw);
  if (!payload) return null;
  const keys = ['logoUrl', 'logoURL', 'logo', 'imageUrl', 'imageURL'];
  let value: string | null = null;
  for (const key of keys) {
    const candidate = payload[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      value = candidate.trim();
      break;
    }
  }
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (!value.startsWith('/')) return null;
  const controlPlaneBase = process.env.CONTROL_PLANE_URL?.trim();
  if (!controlPlaneBase) return null;
  try {
    return new URL(value, controlPlaneBase).toString();
  } catch {
    return null;
  }
}

function resolveInviteStatus(invite: {
  revokedAt: Date | null;
  usedAt: Date | null;
  expiresAt: Date;
}): OnboardingInviteStatus {
  if (invite.revokedAt) {
    return 'revoked';
  }
  if (invite.usedAt) {
    return 'used';
  }
  if (invite.expiresAt.getTime() <= Date.now()) {
    return 'expired';
  }
  return 'open';
}

function normalizeSubmissionValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return JSON.stringify(value);
}

function readSubmissionFromInvitePayload(
  raw: string | null | undefined
): Record<string, string | number | boolean | null> {
  const payload = parseInvitePayload(raw);
  if (!payload) return {};
  const candidate =
    payload.submission && typeof payload.submission === 'object'
      ? (payload.submission as Record<string, unknown>)
      : payload;
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(candidate)) {
    result[key] = normalizeSubmissionValue(value);
  }
  return result;
}

async function resolveTenantBranding(tenantId: string): Promise<OnboardingTenantBranding | null> {
  const prisma = getPrisma();
  const branches = await prisma.branch.findMany({
    where: { tenantId },
    orderBy: [{ id: 'desc' }],
    take: 50,
    select: {
      name: true,
      addressLine1: true,
      addressLine2: true,
      postalCode: true,
      city: true,
      metadata: true,
    },
  });

  if (!branches.length) return null;

  const selectedBranch =
    branches
      .map((branch) => {
        const logoUrl = readBranchLogoFromMetadata(branch.metadata);
        const line1 = normalizeText(branch.addressLine1);
        const line2 = normalizeText(branch.addressLine2);
        const line3 = [normalizeText(branch.postalCode), normalizeText(branch.city)].filter(Boolean).join(' ').trim();
        let score = 0;
        if (logoUrl) score += 4;
        if (line1) score += 3;
        if (line3) score += 2;
        if (line2) score += 1;
        return {
          branch,
          logoUrl,
          line1,
          line2,
          line3: line3 || null,
          score,
        };
      })
      .sort((a, b) => b.score - a.score)[0] ?? null;

  if (!selectedBranch) {
    return null;
  }

  const lines: string[] = [];
  const branchName = normalizeText(selectedBranch.branch.name);
  if (branchName) lines.push(branchName);
  if (selectedBranch.line1) lines.push(selectedBranch.line1);
  if (selectedBranch.line2) lines.push(selectedBranch.line2);
  if (selectedBranch.line3) lines.push(selectedBranch.line3);

  return {
    logoUrl: selectedBranch.logoUrl,
    companyAddressLines: lines,
  };
}

async function getTenantMailDisplayName(tenantId: string): Promise<string> {
  const cached = TENANT_MAIL_NAME_CACHE.get(tenantId);
  if (cached) return cached;

  const fallback = process.env.TENANT_NAME?.trim() || 'Timevex';
  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  if (!baseUrl) {
    TENANT_MAIL_NAME_CACHE.set(tenantId, fallback);
    return fallback;
  }

  try {
    const url = new URL('/api/internal/tenant/info', baseUrl);
    url.searchParams.set('tenantId', tenantId);
    const secret = process.env.PROVISION_SECRET?.trim();
    const response = await fetch(url.toString(), {
      headers: secret ? { 'x-provision-secret': secret } : undefined,
      cache: 'no-store',
    });
    if (!response.ok) {
      TENANT_MAIL_NAME_CACHE.set(tenantId, fallback);
      return fallback;
    }

    const payload = (await response.json().catch(() => null)) as { tenantName?: string | null } | null;
    const tenantName = payload?.tenantName?.trim() || fallback;
    TENANT_MAIL_NAME_CACHE.set(tenantId, tenantName);
    return tenantName;
  } catch {
    TENANT_MAIL_NAME_CACHE.set(tenantId, fallback);
    return fallback;
  }
}

function normalizeUsernameBase(value: string): string {
  const base = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return base || 'mitarbeiter';
}

async function nextPersonnelNumber(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const rows = await tx.employee.findMany({
    where: { tenantId },
    select: { personnelNumber: true },
  });
  let max = 999;
  for (const row of rows) {
    const normalized = String(row.personnelNumber ?? '').trim();
    if (!/^\d+$/.test(normalized)) continue;
    const parsed = Number.parseInt(normalized, 10);
    if (Number.isFinite(parsed) && parsed > max) {
      max = parsed;
    }
  }
  return String(max + 1);
}

async function nextUsername(
  tx: Prisma.TransactionClient,
  tenantId: string,
  firstName: string,
  lastName: string,
  email: string | null
): Promise<string> {
  const candidates: string[] = [];
  if (email) {
    candidates.push(normalizeUsernameBase(email.split('@')[0] ?? ''));
  }
  candidates.push(normalizeUsernameBase(`${firstName}.${lastName}`));
  candidates.push(normalizeUsernameBase(`${firstName}${lastName}`));

  const existingRows = await tx.employee.findMany({
    where: { tenantId },
    select: { username: true },
  });
  const existing = new Set(existingRows.map((row) => row.username.trim().toLowerCase()));

  for (const candidateBase of candidates) {
    if (!candidateBase) continue;
    if (!existing.has(candidateBase)) return candidateBase;
    for (let idx = 2; idx < 10_000; idx += 1) {
      const attempt = `${candidateBase}${idx}`;
      if (!existing.has(attempt)) return attempt;
    }
  }
  return `mitarbeiter${Date.now()}`;
}

async function nextBookingPin(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const pin = String(1000 + Math.floor(Math.random() * 9000));
    const existing = await tx.employee.findFirst({
      where: { tenantId, bookingPin: pin },
      select: { id: true },
    });
    if (!existing) return pin;
  }
  const fallback = String((Date.now() % 9000) + 1000);
  return fallback;
}

async function listTenantAdminEmails(tenantId: string): Promise<string[]> {
  const prisma = getPrisma();
  const [employeeAdmins, systemAdmins] = await Promise.all([
    prisma.employee.findMany({
      where: { tenantId, Rolle: 2, isActive: 1 },
      select: { email: true, username: true },
    }),
    prisma.admin.findMany({
      where: { tenantId },
      select: { username: true },
    }),
  ]);

  const recipients = new Set<string>();
  const collect = (value: string | null | undefined) => {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (EMAIL_REGEX.test(normalized)) {
      recipients.add(normalized);
    }
  };

  for (const row of employeeAdmins) {
    collect(row.email);
    collect(row.username);
  }
  for (const row of systemAdmins) {
    collect(row.username);
  }
  collect(process.env.ADMIN_EMAIL);

  return Array.from(recipients);
}

function makeRandomPassword(): string {
  return randomBytes(24).toString('base64url');
}

export async function createEmployeeOnboardingInvite(
  input: OnboardingInviteCreateInput
): Promise<OnboardingInviteCreateResult> {
  const tenantId = normalizeText(input.tenantId);
  if (!tenantId) {
    throw new OnboardingValidationError('Tenant fehlt für die Einladung.');
  }

  const email = assertEmail(input.email);
  const firstName = normalizeText(input.firstName);
  const lastName = normalizeText(input.lastName);
  const message = normalizeText(input.message);
  const inviteEntryDate = parseIsoDate(input.adminPreset?.entryDate, 'Eintrittsdatum');
  if (!inviteEntryDate) {
    throw new OnboardingValidationError('Eintrittsdatum ist erforderlich.');
  }
  const adminPreset: OnboardingInviteAdminPreset = {
    entryDate: inviteEntryDate,
    tarifGroup: assertRequiredText(input.adminPreset?.tarifGroup, 'Tarifgruppe / Jobtitel'),
    employmentType: assertRequiredText(input.adminPreset?.employmentType, 'Einstellungsart'),
    workTimeModel: assertRequiredText(input.adminPreset?.workTimeModel, 'Arbeitszeitmodell'),
    weeklyHours: assertRequiredNumber(input.adminPreset?.weeklyHours, 'Std/Woche', { min: 0.01, max: 168 }),
    probationMonths: Math.round(
      assertRequiredNumber(input.adminPreset?.probationMonths, 'Probezeit (Monate)', { min: 0, max: 36 })
    ),
    compensationType: input.adminPreset?.compensationType === 'fixed' ? 'fixed' : 'hourly',
    hourlyWage: null,
    monthlySalaryGross: null,
    vacationDaysTotal: Math.round(
      assertRequiredNumber(input.adminPreset?.vacationDaysTotal, 'Urlaubstage/Jahr', { min: 1, max: 365 })
    ),
  };

  if (adminPreset.compensationType === 'fixed') {
    adminPreset.monthlySalaryGross = assertRequiredNumber(
      input.adminPreset?.monthlySalaryGross,
      'Monatsgehalt Brutto (€)',
      { min: 0.01 }
    );
    adminPreset.hourlyWage = parseOptionalNumber(input.adminPreset?.hourlyWage) ?? null;
  } else {
    adminPreset.hourlyWage = assertRequiredNumber(input.adminPreset?.hourlyWage, 'Stundenlohn (€)', { min: 0.01 });
    adminPreset.monthlySalaryGross = parseOptionalNumber(input.adminPreset?.monthlySalaryGross) ?? null;
  }

  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + inviteTtlHours() * 60 * 60 * 1000);

  const prisma = getPrisma();
  await prisma.employeeOnboardingInvite.updateMany({
    where: {
      tenantId,
      email,
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { revokedAt: new Date() },
  });

  const created = await prisma.employeeOnboardingInvite.create({
    data: {
      tenantId,
      tokenHash,
      email,
      firstName,
      lastName,
      message,
      createdByAdminId: input.createdByAdminId ?? null,
      expiresAt,
      payloadJson: JSON.stringify({
        version: 1,
        adminPreset,
      }),
    },
    select: { id: true },
  });

  const inviteUrl = buildInviteLink(input.origin, token);
  const greetingName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const greeting = greetingName ? `Hallo ${greetingName},` : 'Hallo,';
  const companyName = await getTenantMailDisplayName(tenantId);
  const expiryLabel = expiresAt.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  const lines = [
    greeting,
    '',
    `du wurdest eingeladen, deinen Personalbogen für ${companyName} sicher auszufüllen.`,
    `Öffne den sicheren Einmal-Link: ${inviteUrl}`,
    '',
    `Der Link ist gültig bis: ${expiryLabel}`,
    'Der Link kann nur einmal verwendet werden.',
    'Falls du diese Einladung nicht erwartest, ignoriere diese E-Mail.',
  ];
  if (message) {
    lines.push('', 'Nachricht vom Unternehmen:', message);
  }

  try {
    const messageBlock = message
      ? `<p style="margin:16px 0 0;color:#0f172a;"><strong>Nachricht vom Unternehmen:</strong><br>${escapeHtml(message)}</p>`
      : '';
    const html = `<!doctype html>
<html lang="de">
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
      <tr>
        <td style="padding:24px;">
          <p style="margin:0 0 12px;font-size:16px;">${escapeHtml(greeting)}</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
            Du wurdest eingeladen, deinen Personalbogen für <strong>${escapeHtml(companyName)}</strong> sicher auszufüllen.
          </p>
          <p style="margin:0 0 20px;">
            <a href="${inviteUrl}" style="display:inline-block;padding:12px 18px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Personalbogen öffnen</a>
          </p>
          <p style="margin:0 0 8px;font-size:13px;color:#334155;">Gültig bis: ${escapeHtml(expiryLabel)}</p>
          <p style="margin:0 0 8px;font-size:13px;color:#334155;">Der Link kann nur einmal verwendet werden.</p>
          ${messageBlock}
          <p style="margin:16px 0 0;font-size:12px;color:#64748b;">Falls du diese Einladung nicht erwartest, ignoriere diese E-Mail.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    await sendMail({
      to: email,
      subject: 'Dein Personalbogen (einmaliger Link)',
      text: lines.join('\n'),
      html,
      fromName: companyName,
      headers: {
        'Auto-Submitted': 'auto-generated',
        'X-Auto-Response-Suppress': 'All',
        'X-Entity-Ref-ID': `employee-onboarding-invite-${tenantId}-${created.id}`,
      },
    });
  } catch (error) {
    console.error('[employee-onboarding] invite mail failed', {
      tenantId,
      inviteId: created.id,
      email,
      error,
    });
    throw new Error('Einladung gespeichert, aber die E-Mail konnte nicht versendet werden.');
  }

  return {
    inviteId: created.id,
    inviteUrl,
    expiresAt,
    email,
  };
}

export async function getEmployeeOnboardingInviteByToken(
  tenantId: string,
  rawToken: string
): Promise<OnboardingInviteView> {
  const token = normalizeText(rawToken);
  if (!token) {
    return { status: 'invalid' };
  }
  const tokenHash = sha256Hex(token);
  const prisma = getPrisma();
  const invite = await prisma.employeeOnboardingInvite.findUnique({
    where: { tokenHash },
    select: {
      tenantId: true,
      email: true,
      firstName: true,
      lastName: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      payloadJson: true,
    },
  });

  if (!invite || invite.tenantId !== tenantId) {
    return { status: 'invalid' };
  }

  const status = resolveInviteStatus(invite);
  if (status !== 'open') {
    return {
      status,
      usedAt: invite.usedAt,
    };
  }

  const adminPreset = readAdminPresetFromInvitePayload(invite.payloadJson);
  const tenantBranding = await resolveTenantBranding(tenantId);

  return {
    status: 'open',
    email: invite.email,
    firstName: invite.firstName,
    lastName: invite.lastName,
    expiresAt: invite.expiresAt,
    adminPreset,
    tenantBranding,
  };
}

export async function listEmployeeOnboardingInvites(
  tenantId: string,
  limit = 30
): Promise<OnboardingInviteListItem[]> {
  const normalizedTenantId = normalizeText(tenantId);
  if (!normalizedTenantId) {
    throw new OnboardingValidationError('Tenant fehlt für die Einladungsliste.');
  }

  const take = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 100) : 30;
  const prisma = getPrisma();
  const invites = await prisma.employeeOnboardingInvite.findMany({
    where: { tenantId: normalizedTenantId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      createdAt: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      employeeId: true,
      employee: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  return invites.map((invite) => ({
    id: invite.id,
    email: invite.email,
    firstName: invite.firstName,
    lastName: invite.lastName,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    usedAt: invite.usedAt,
    revokedAt: invite.revokedAt,
    status: resolveInviteStatus(invite),
    employeeId: invite.employeeId,
    employeeFirstName: invite.employee?.firstName ?? null,
    employeeLastName: invite.employee?.lastName ?? null,
  }));
}

export async function deleteEmployeeOnboardingInvite(tenantId: string, inviteId: number): Promise<void> {
  const normalizedTenantId = normalizeText(tenantId);
  if (!normalizedTenantId) {
    throw new OnboardingValidationError('Tenant fehlt für das Löschen der Einladung.');
  }
  if (!Number.isFinite(inviteId) || inviteId <= 0) {
    throw new OnboardingValidationError('Ungültige Einladungs-ID.');
  }

  const prisma = getPrisma();
  const existing = await prisma.employeeOnboardingInvite.findFirst({
    where: { id: inviteId, tenantId: normalizedTenantId },
    select: { id: true },
  });
  if (!existing) {
    throw new OnboardingValidationError('Personalbogen-Einladung wurde nicht gefunden.');
  }

  await prisma.employeeOnboardingInvite.delete({
    where: { id: existing.id },
  });
}

export async function getEmployeeOnboardingSubmissionSnapshot(
  tenantId: string,
  employeeId: number
): Promise<EmployeeOnboardingSubmissionSnapshot | null> {
  const normalizedTenantId = normalizeText(tenantId);
  if (!normalizedTenantId) return null;
  if (!Number.isFinite(employeeId) || employeeId <= 0) return null;

  const prisma = getPrisma();
  const invite = await prisma.employeeOnboardingInvite.findFirst({
    where: { tenantId: normalizedTenantId, employeeId },
    orderBy: [{ usedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      createdAt: true,
      usedAt: true,
      email: true,
      firstName: true,
      lastName: true,
      signatureName: true,
      signatureAcceptedAt: true,
      payloadJson: true,
    },
  });

  if (!invite) return null;

  return {
    inviteId: invite.id,
    inviteCreatedAt: invite.createdAt,
    submittedAt: invite.usedAt,
    inviteEmail: invite.email,
    inviteFirstName: invite.firstName,
    inviteLastName: invite.lastName,
    signatureName: invite.signatureName,
    signatureAcceptedAt: invite.signatureAcceptedAt,
    adminPreset: readAdminPresetFromInvitePayload(invite.payloadJson),
    submission: readSubmissionFromInvitePayload(invite.payloadJson),
  };
}

export async function submitEmployeeOnboarding(
  input: EmployeeOnboardingSubmitInput
): Promise<EmployeeOnboardingSubmitResult> {
  const tenantId = normalizeText(input.tenantId);
  if (!tenantId) {
    throw new OnboardingValidationError('Tenant fehlt. Bitte Seite neu laden.');
  }

  const token = normalizeText(input.token);
  if (!token) {
    throw new OnboardingValidationError('Der Einladungslink ist ungültig.');
  }
  const tokenHash = sha256Hex(token);

  const firstName = normalizeText(input.firstName);
  const lastName = normalizeText(input.lastName);
  if (!firstName || !lastName) {
    throw new OnboardingValidationError('Vorname und Nachname sind erforderlich.');
  }

  if (!input.consentAccepted) {
    throw new OnboardingValidationError('Bitte bestätige die Datenfreigabe.');
  }

  const signatureName = normalizeText(input.signatureName);
  if (!signatureName) {
    throw new OnboardingValidationError('Bitte gib deinen Namen für die Unterschrift an.');
  }
  const signatureBuffer = parseDataUrlPng(input.signatureDataUrl);

  const profilePhoto = input.profilePhoto ?? null;
  if (profilePhoto) {
    assertSupportedFile(profilePhoto);
  }

  if (input.attachments.length > MAX_ATTACHMENTS) {
    throw new OnboardingValidationError(`Maximal ${MAX_ATTACHMENTS} Anhänge sind erlaubt.`);
  }
  for (const file of input.attachments) {
    assertSupportedFile(file);
  }

  const street = assertRequiredText(input.street, 'Straße');
  const houseNumber = assertRequiredText(input.houseNumber, 'Hausnummer');
  const country = normalizeCountry(input.country);
  const federalState = normalizeFederalState(country, input.federalState);
  if (!federalState) {
    throw new OnboardingValidationError('Bundesland / Kanton ist erforderlich.');
  }
  const zipCode = normalizePostalCode(country, input.zipCode);
  const city = assertRequiredText(input.city, 'Ort');
  const phone = normalizePhoneNumber(input.phone, 'Telefon');
  const birthDate = parseIsoDate(input.birthDate, 'Geburtsdatum');
  if (!birthDate) {
    throw new OnboardingValidationError('Geburtsdatum ist erforderlich.');
  }
  const preferredEmail = assertEmail(assertRequiredText(input.email, 'E-Mail'));
  const nationality = assertRequiredText(input.nationality, 'Nationalität');
  const maritalStatus = assertRequiredText(input.maritalStatus, 'Familienstand');
  const taxClass = assertRequiredText(input.taxClass, 'Steuerklasse');
  if (!TAX_CLASS_SET.has(taxClass)) {
    throw new OnboardingValidationError('Steuerklasse muss zwischen 1 und 6 liegen.');
  }
  const kinderfreibetrag = assertRequiredNumber(input.kinderfreibetrag, 'Kinderfreibetrag', { min: 0 });
  const steuerId = assertRequiredText(input.steuerId, 'Steuer-ID');
  const socialSecurityNumber = assertRequiredText(input.socialSecurityNumber, 'Sozialversicherungsnummer');
  const healthInsurance = assertRequiredText(input.healthInsurance, 'Krankenkasse');
  const healthInsuranceNumber = assertRequiredText(input.healthInsuranceNumber, 'Versichertennummer');
  const iban = assertRequiredText(input.iban, 'IBAN');
  const bic = assertRequiredText(input.bic, 'BIC');
  const weeklyHoursInput = parseOptionalNumber(input.weeklyHours);
  const emergencyContactName = normalizeText(input.emergencyContactName);
  const emergencyContactPhone = normalizeText(input.emergencyContactPhone);
  const emergencyContactRelation = normalizeText(input.emergencyContactRelation);

  const prisma = getPrisma();
  const txResult = await prisma.$transaction(async (tx) => {
    const invite = await tx.employeeOnboardingInvite.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        tenantId: true,
        email: true,
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
        payloadJson: true,
      },
    });

    if (!invite || invite.tenantId !== tenantId) {
      throw new OnboardingValidationError('Der Einladungslink ist ungültig.');
    }
    if (invite.revokedAt) {
      throw new OnboardingValidationError('Der Einladungslink wurde widerrufen.');
    }
    if (invite.usedAt) {
      throw new OnboardingValidationError('Der Einladungslink wurde bereits verwendet.');
    }
    if (invite.expiresAt.getTime() <= Date.now()) {
      throw new OnboardingValidationError('Der Einladungslink ist abgelaufen.');
    }

    const adminPreset = readAdminPresetFromInvitePayload(invite.payloadJson);
    const entryDate = adminPreset?.entryDate ?? parseIsoDate(input.entryDate, 'Eintrittsdatum');
    if (!entryDate) {
      throw new OnboardingValidationError('Eintrittsdatum ist erforderlich.');
    }

    const tarifGroup = adminPreset?.tarifGroup ?? assertRequiredText(input.tarifGroup, 'Tarifgruppe / Jobtitel');
    const employmentType = adminPreset?.employmentType ?? assertRequiredText(input.employmentType, 'Einstellungsart');
    const workTimeModel = adminPreset?.workTimeModel ?? assertRequiredText(input.workTimeModel, 'Arbeitszeitmodell');
    const probationMonths = Number.isFinite(adminPreset?.probationMonths ?? NaN)
      ? Number(adminPreset?.probationMonths)
      : Math.round(assertRequiredNumber(input.probationMonths, 'Probezeit (Monate)', { min: 0, max: 36 }));
    const weeklyHours = Number.isFinite(adminPreset?.weeklyHours ?? NaN)
      ? Number(adminPreset?.weeklyHours)
      : assertRequiredNumber(weeklyHoursInput, 'Std/Woche', { min: 0.01, max: 168 });
    const compensationType =
      adminPreset?.compensationType === 'fixed' || adminPreset?.compensationType === 'hourly'
        ? adminPreset.compensationType
        : input.compensationType === 'fixed'
          ? 'fixed'
          : 'hourly';
    const vacationDaysTotal = Number.isFinite(adminPreset?.vacationDaysTotal ?? NaN)
      ? Number(adminPreset?.vacationDaysTotal)
      : Math.round(assertRequiredNumber(input.vacationDaysTotal, 'Urlaubstage/Jahr', { min: 1, max: 365 }));
    const hourlyWage =
      adminPreset && adminPreset.hourlyWage !== null
        ? adminPreset.hourlyWage
        : parseOptionalNumber(input.hourlyWage);
    let monthlySalaryGross =
      adminPreset && adminPreset.monthlySalaryGross !== null
        ? adminPreset.monthlySalaryGross
        : parseOptionalNumber(input.monthlySalaryGross);
    if (compensationType === 'fixed') {
      if (!monthlySalaryGross || monthlySalaryGross <= 0) {
        throw new OnboardingValidationError('Bei Festgehalt bitte Brutto-Monatsgehalt eintragen.');
      }
    } else {
      if (!hourlyWage || hourlyWage <= 0) {
        throw new OnboardingValidationError('Bei Stundenlohn bitte Stundenlohn eintragen.');
      }
      monthlySalaryGross = monthlySalaryGross ?? null;
    }

    const payloadSnapshot = {
      firstName,
      lastName,
      street,
      houseNumber,
      country,
      federalState,
      zipCode,
      city,
      birthDate,
      phone,
      email: preferredEmail,
      nationality,
      maritalStatus,
      taxClass,
      kinderfreibetrag,
      steuerId,
      socialSecurityNumber,
      healthInsurance,
      healthInsuranceNumber,
      iban,
      bic,
      emergencyContactName,
      emergencyContactPhone,
      emergencyContactRelation,
      tarifGroup,
      entryDate,
      employmentType,
      workTimeModel,
      probationMonths,
      weeklyHours,
      compensationType,
      hourlyWage,
      monthlySalaryGross,
      vacationDaysTotal,
      submittedAt: new Date().toISOString(),
    };

    const resolvedEmail = preferredEmail ?? invite.email;
    const username = await nextUsername(tx, tenantId, firstName, lastName, resolvedEmail);
    const personnelNumber = await nextPersonnelNumber(tx, tenantId);
    const bookingPin = await nextBookingPin(tx, tenantId);
    const randomPassword = makeRandomPassword();

    const created = await tx.employee.create({
      data: {
        tenantId,
        firstName,
        lastName,
        street,
        houseNumber,
        zipCode,
        city,
        federalState,
        birthDate,
        entryDate,
        phone,
        email: resolvedEmail,
        personnelNumber,
        Rolle: 1,
        username,
        password: hashPassword(randomPassword),
        bookingPin,
        isActive: 0,
        showInCalendar: 0,
        onboardingStatus: 'pending',
        onboardingSubmittedAt: new Date(),
        arbeitsstundenProWoche: weeklyHours,
        compensationType,
        hourlyWage: compensationType === 'hourly' ? hourlyWage ?? 0 : 0,
        monthlySalaryGross: compensationType === 'fixed' ? monthlySalaryGross : null,
        vacationDays: vacationDaysTotal,
        vacationDaysTotal,
        vacationDaysLastYear: 0,
        employmentType,
        workTimeModel,
        probationMonths,
        tarifGroup,
        nationality,
        maritalStatus,
        taxClass,
        kinderfreibetrag,
        steuerId,
        socialSecurityNumber,
        healthInsurance,
        healthInsuranceNumber,
        iban,
        bic,
        emergencyContactName,
        emergencyContactPhone,
        emergencyContactRelation,
      },
      select: { id: true, email: true, firstName: true, lastName: true },
    });

    await tx.employeeOnboardingInvite.update({
      where: { id: invite.id },
      data: {
        usedAt: new Date(),
        employeeId: created.id,
        signatureName,
        signatureAcceptedAt: new Date(),
        submissionIp: normalizeText(input.submittedFromIp),
        submissionUserAgent: normalizeText(input.submittedFromUserAgent),
        payloadJson: JSON.stringify({
          version: 1,
          adminPreset,
          submission: payloadSnapshot,
        }),
      },
    });

    return {
      inviteEmail: invite.email,
      employeeId: created.id,
      employeeEmail: created.email,
      employeeName: `${created.firstName} ${created.lastName}`.replace(/\s+/g, ' ').trim(),
    };
  });

  const warnings: string[] = [];
  const employeeId = txResult.employeeId;
  let resolvedControlPlaneStaffId: string | null = null;
  try {
    const employeeSnapshot = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        tenantId: true,
        controlPlaneStaffId: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        password: true,
      },
    });

    if (employeeSnapshot && employeeSnapshot.tenantId === tenantId) {
      const displayName =
        [employeeSnapshot.firstName?.trim(), employeeSnapshot.lastName?.trim()]
          .filter(Boolean)
          .join(' ')
          .trim() || `Mitarbeiter ${employeeId}`;
      const upsert = await upsertStaffInControlPlane({
        tenantId,
        staffId: employeeSnapshot.controlPlaneStaffId?.trim() || undefined,
        isActive: false,
        displayName,
        firstName: employeeSnapshot.firstName,
        lastName: employeeSnapshot.lastName,
        email: employeeSnapshot.email,
        phone: employeeSnapshot.phone,
        passwordHash: employeeSnapshot.password,
        showInCalendar: false,
        apps: {
          calendar: false,
          timeshift: true,
          website: false,
        },
        profile: {
          street,
          houseNumber,
          zipCode,
          city,
          country,
          federalState,
          birthDate,
          phones: phone ? [{ type: 'Mobil', number: phone }] : [],
        },
      });
      const resolvedStaffId = upsert?.staffId?.trim() || '';
      if (resolvedStaffId) {
        resolvedControlPlaneStaffId = resolvedStaffId;
        if ((employeeSnapshot.controlPlaneStaffId?.trim() || '') !== resolvedStaffId) {
          await prisma.employee.update({
            where: { id: employeeId },
            data: { controlPlaneStaffId: resolvedStaffId },
          });
        }
      } else {
        warnings.push('Mitarbeiter konnte nicht in der zentralen Mitarbeiterverwaltung verknüpft werden.');
      }
    } else {
      warnings.push('Mitarbeiter konnte nicht für die zentrale Mitarbeiterverwaltung geladen werden.');
    }
  } catch (error) {
    warnings.push('Mitarbeiter konnte nicht in der zentralen Mitarbeiterverwaltung angelegt werden.');
    console.error('[employee-onboarding] control-plane staff upsert failed', {
      tenantId,
      employeeId,
      error,
    });
  }

  let profilePhotoStoredName: string | null = null;

  try {
    const signatureFileName = `unterschrift_${sanitizeBaseName(firstName)}_${sanitizeBaseName(lastName)}.png`;
    await saveEmployeeDocumentFromBuffer(employeeId, signatureBuffer, signatureFileName);
  } catch (error) {
    warnings.push('Unterschrift konnte nicht als Dokument gespeichert werden.');
    console.error('[employee-onboarding] signature save failed', { tenantId, employeeId, error });
  }

  if (profilePhoto) {
    try {
      const ext = assertSupportedFile(profilePhoto);
      const photoName = `profilfoto_${sanitizeBaseName(firstName)}_${sanitizeBaseName(lastName)}.${ext}`;
      const saved = await saveEmployeeDocumentFromBuffer(employeeId, profilePhoto.buffer, photoName);
      profilePhotoStoredName = saved.storedFileName;
      if (resolvedControlPlaneStaffId) {
        const photoMimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        const photoPushed = await pushStaffPhotoUpdateToControlPlane({
          tenantId,
          staffId: resolvedControlPlaneStaffId,
          photoBase64: profilePhoto.buffer.toString('base64'),
          photoMimeType,
        });
        if (!photoPushed) {
          warnings.push('Profilfoto konnte nicht in der zentralen Mitarbeiterverwaltung gespeichert werden.');
        }
      }
    } catch (error) {
      warnings.push('Profilfoto konnte nicht gespeichert werden.');
      console.error('[employee-onboarding] photo save failed', { tenantId, employeeId, error });
    }
  }

  for (const file of input.attachments) {
    try {
      const ext = assertSupportedFile(file);
      const baseName = path.basename(file.name, path.extname(file.name)) || 'anhang';
      const finalName = `${sanitizeBaseName(baseName)}.${ext}`;
      await saveEmployeeDocumentFromBuffer(employeeId, file.buffer, finalName);
    } catch (error) {
      warnings.push(`Anhang "${file.name}" konnte nicht gespeichert werden.`);
      console.error('[employee-onboarding] attachment save failed', {
        tenantId,
        employeeId,
        fileName: file.name,
        error,
      });
    }
  }

  if (profilePhotoStoredName) {
    await prisma.employee.updateMany({
      where: { id: employeeId, tenantId },
      data: { profilePhotoFileName: profilePhotoStoredName },
    });
  }

  const confirmationEmail = txResult.employeeEmail?.trim() || txResult.inviteEmail;
  const companyName = await getTenantMailDisplayName(tenantId);
  if (EMAIL_REGEX.test(confirmationEmail.toLowerCase())) {
    const lines = [
      `Hallo ${txResult.employeeName || firstName},`,
      '',
      'dein Personalbogen wurde erfolgreich an das Unternehmen übermittelt.',
      'Vielen Dank.',
    ];
    try {
      await sendTextMail(confirmationEmail, 'Personalbogen erfolgreich gesendet', lines.join('\n'), {
        fromName: companyName,
      });
    } catch (error) {
      warnings.push('Bestätigungs-E-Mail an den Mitarbeiter konnte nicht gesendet werden.');
      console.error('[employee-onboarding] confirmation mail failed', { tenantId, employeeId, error });
    }
  }

  const adminRecipients = await listTenantAdminEmails(tenantId);
  if (adminRecipients.length > 0) {
    const employeeLink = new URL(
      withAppBasePath(`/admin/mitarbeitende/${employeeId}`, 'external'),
      input.origin,
    ).toString();
    const adminBody = [
      'Neuer Personalbogen eingegangen.',
      '',
      `Mitarbeiter: ${txResult.employeeName}`,
      `Status: Ausstehend`,
      `Zur Prüfung: ${employeeLink}`,
    ].join('\n');

    await Promise.allSettled(
      adminRecipients.map((recipient) =>
        sendTextMail(recipient, `Neuer ausstehender Mitarbeiter: ${txResult.employeeName}`, adminBody, {
          fromName: companyName,
        })
      )
    );
  }

  return {
    employeeId,
    employeeDisplayName: txResult.employeeName,
    warnings,
  };
}
