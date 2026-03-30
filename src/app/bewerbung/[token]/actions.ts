'use server';

import { headers } from 'next/headers';

import {
  type EmployeeOnboardingSubmitInput,
  type OnboardingFileUpload,
  submitEmployeeOnboarding,
} from '@/lib/services/employee-onboarding';

export type OnboardingFormState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
  warnings?: string[];
};

function parseString(value: FormDataEntryValue | null): string {
  return String(value ?? '').trim();
}

function parseOptionalNumber(value: FormDataEntryValue | null): number | null {
  const raw = parseString(value).replace(',', '.');
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeIsoDateInput(value: FormDataEntryValue | null): string {
  const raw = parseString(value);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  const match = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) {
    return raw;
  }
  const day = match[1].padStart(2, '0');
  const month = match[2].padStart(2, '0');
  const year = match[3];
  return `${year}-${month}-${day}`;
}

async function parseFile(entry: FormDataEntryValue | null): Promise<OnboardingFileUpload | null> {
  if (!(entry instanceof File) || entry.size <= 0) return null;
  const buffer = Buffer.from(await entry.arrayBuffer());
  return {
    name: entry.name || 'datei',
    size: entry.size,
    buffer,
  };
}

function extractClientIp(headersList: Headers): string | null {
  const forwarded = headersList.get('x-forwarded-for');
  if (forwarded) {
    const [first] = forwarded.split(',');
    const normalized = String(first ?? '').trim();
    if (normalized) return normalized;
  }
  const realIp = headersList.get('x-real-ip')?.trim();
  return realIp || null;
}

function resolveOrigin(headersList: Headers): string {
  const proto = headersList.get('x-forwarded-proto') ?? 'https';
  const host = headersList.get('x-forwarded-host') ?? headersList.get('host');
  if (host) return `${proto}://${host}`;
  const fallback = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return fallback || 'https://timesheet.timevex.com';
}

export async function submitOnboardingFormAction(
  _prev: OnboardingFormState,
  formData: FormData
): Promise<OnboardingFormState> {
  const headersList = await headers();
  const tenantId = headersList.get('x-tenant-id')?.trim() || process.env.DEFAULT_TENANT_ID?.trim();
  if (!tenantId) {
    return { status: 'error', message: 'Tenant-Kontext fehlt. Bitte Link erneut öffnen.' };
  }

  const token = parseString(formData.get('token'));
  const profilePhoto = await parseFile(formData.get('profile_photo'));
  const attachmentEntries = formData.getAll('attachments');
  const attachments: OnboardingFileUpload[] = [];
  for (const entry of attachmentEntries) {
    const file = await parseFile(entry);
    if (file) attachments.push(file);
  }

  const payload: EmployeeOnboardingSubmitInput = {
    tenantId,
    token,
    origin: resolveOrigin(headersList),
    submittedFromIp: extractClientIp(headersList),
    submittedFromUserAgent: headersList.get('user-agent'),
    profilePhoto,
    attachments,
    firstName: parseString(formData.get('first_name')),
    lastName: parseString(formData.get('last_name')),
    street: parseString(formData.get('street')) || null,
    houseNumber: parseString(formData.get('house_number')) || null,
    country: parseString(formData.get('country')) || 'DE',
    federalState: parseString(formData.get('federal_state')) || null,
    zipCode: parseString(formData.get('zip_code')) || null,
    city: parseString(formData.get('city')) || null,
    birthDate: normalizeIsoDateInput(formData.get('birth_date')) || null,
    phone: parseString(formData.get('phone')) || null,
    email: parseString(formData.get('email')) || null,
    nationality: parseString(formData.get('nationality')) || null,
    maritalStatus: parseString(formData.get('marital_status')) || null,
    taxClass: parseString(formData.get('tax_class')) || null,
    kinderfreibetrag: parseOptionalNumber(formData.get('kinderfreibetrag')),
    steuerId: parseString(formData.get('steuer_id')) || null,
    socialSecurityNumber: parseString(formData.get('social_security_number')) || null,
    healthInsurance: parseString(formData.get('health_insurance')) || null,
    healthInsuranceNumber: parseString(formData.get('health_insurance_number')) || null,
    iban: parseString(formData.get('iban')) || null,
    bic: parseString(formData.get('bic')) || null,
    emergencyContactName: parseString(formData.get('emergency_contact_name')) || null,
    emergencyContactPhone: parseString(formData.get('emergency_contact_phone')) || null,
    emergencyContactRelation: parseString(formData.get('emergency_contact_relation')) || null,
    tarifGroup: parseString(formData.get('tarif_group')) || null,
    entryDate: parseString(formData.get('entry_date')),
    employmentType: parseString(formData.get('employment_type')) || null,
    workTimeModel: parseString(formData.get('work_time_model')) || null,
    probationMonths: parseOptionalNumber(formData.get('probation_months')),
    weeklyHours: parseOptionalNumber(formData.get('weekly_hours')),
    compensationType: parseString(formData.get('compensation_type')) === 'fixed' ? 'fixed' : 'hourly',
    hourlyWage: parseOptionalNumber(formData.get('hourly_wage')),
    monthlySalaryGross: parseOptionalNumber(formData.get('monthly_salary_gross')),
    vacationDaysTotal: parseOptionalNumber(formData.get('vacation_days_total')),
    signatureName: parseString(formData.get('signature_name')),
    signatureDataUrl: parseString(formData.get('signature_data_url')),
    consentAccepted: formData.get('consent_accepted') === 'on',
  };

  try {
    const result = await submitEmployeeOnboarding(payload);
    return {
      status: 'success',
      message: `Danke! Dein Personalbogen wurde erfolgreich gesendet (${result.employeeDisplayName}).`,
      warnings: result.warnings,
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Formular konnte nicht gesendet werden.',
    };
  }
}
