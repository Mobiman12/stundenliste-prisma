import { revalidatePath } from 'next/cache';
import { redirect, notFound } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import {
  adminEmployeeExists,
  getAdminEmployeeDetails,
  getAdminEmployeeList,
  getDailyOverview,
  getEmployeeBonusConfiguration,
  getEmployeeWeekdayPauses,
  getAdminEmployeeValidationInfo,
  acceptAdminEmployeeOnboarding,
  saveEmployeeBonusConfiguration,
  saveEmployeeTillhubUser,
  saveEmployeeWeekdayPauses,
  removeEmployee,
  updateAdminEmployeeProfile,
  updateAdminEmployeeSettings,
  type BonusScheme,
  type BonusTier,
} from '@/lib/services/admin/employee';
import {
  getAdminEmployeeSummaryReadBlock,
  getMonthlyAdminSummary,
  saveAdminBonusPayout,
  saveAdminOvertimePayout,
  saveAdminSummaryPreferences,
  saveAdminOvertimeBalanceAdjustment,
} from '@/lib/services/admin/employee-summary';
import {
  closeMonthlyClosing,
  getMonthlyClosingHistory,
  getMonthlyClosingState,
  reopenMonthlyClosing,
} from '@/lib/services/admin/monthly-closing';
import { getShiftPlan } from '@/lib/services/shift-plan';
import { createAdminTimeEntry, deleteAdminTimeEntry, listTimeEntries } from '@/lib/services/time-entry';
import { FEDERAL_STATE_OPTIONS, type GermanFederalStateCode } from '@/lib/constants/federal-states';
import { getEmployeeOnboardingSubmissionSnapshot } from '@/lib/services/employee-onboarding';

import AdminEmployeeDetailClient, { type BonusSchemeType } from './AdminEmployeeDetailClient';
import type { ActionState } from './types';
import type { EntryActionState } from '@/app/mitarbeiter/types';

const FEDERAL_STATE_CODES = new Set<GermanFederalStateCode>(FEDERAL_STATE_OPTIONS.map((option) => option.code));
const isFederalStateCode = (value: string): value is GermanFederalStateCode =>
  FEDERAL_STATE_CODES.has(value as GermanFederalStateCode);

function normalizeBirthDateValue(raw: string | null): { value: string | null; error?: string } {
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

  return { value: null, error: 'Ungültiges Geburtsdatum. Bitte TT.MM.JJJJ verwenden.' };
}

function ensureAdminSession() {
  return getServerAuthSession().then((session) => {
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
  });
}

function isRedirectError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest === 'string' && digest.includes('NEXT_REDIRECT')) return true;
  return error instanceof Error && error.message === 'NEXT_REDIRECT';
}

function normalizeNumberString(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const sanitized = trimmed.replace(/[€%\s]/g, '');
  if (!sanitized) return '';

  if (!/^-?[0-9.,]+$/.test(sanitized)) {
    return sanitized;
  }

  const commaIndex = sanitized.lastIndexOf(',');
  const dotIndex = sanitized.lastIndexOf('.');
  const dotCount = (sanitized.match(/\./g) ?? []).length;

  if (commaIndex > dotIndex) {
    return sanitized.replace(/\./g, '').replace(',', '.');
  }

  if (dotCount > 1 && commaIndex === -1) {
    return sanitized.replace(/\./g, '');
  }

  if (dotIndex > commaIndex) {
    return sanitized.replace(/,/g, '');
  }

  return sanitized.replace(',', '.');
}

function toNumber(value: FormDataEntryValue | string | null): number | null {
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  const raw = value;
  const normalized = normalizeNumberString(raw);
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNumber(value: FormDataEntryValue | null, fallback = 0): number {
  const parsed = toNumber(value);
  return parsed ?? fallback;
}

function parseNumberOrNull(value: FormDataEntryValue | null): number | null {
  return toNumber(value);
}

function parseString(value: FormDataEntryValue | null): string | null {
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function normalizeIbanValue(value: FormDataEntryValue | null): string | null {
  const raw = parseString(value);
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  return cleaned.length ? cleaned : null;
}

function normalizeBicValue(value: FormDataEntryValue | null): string | null {
  const raw = parseString(value);
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  return cleaned.length ? cleaned : null;
}

function parseYesNo(value: FormDataEntryValue | null, fallback = 'Nein'): string {
  const raw = parseString(value);
  if (raw === 'Ja' || raw === 'Nein') {
    return raw;
  }
  return fallback;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

async function createAdminTimeEntryAction(
  _prevState: EntryActionState,
  formData: FormData | null
): Promise<EntryActionState> {
  'use server';
  if (!formData) {
    return _prevState ?? null;
  }
  try {
    const { tenantId, session } = await ensureAdminSession();

    const employeeId = Number.parseInt(String(formData.get('employeeId') ?? ''), 10);
    if (!Number.isFinite(employeeId)) {
      return { status: 'error', message: 'Mitarbeiter-ID fehlt.' };
    }

    const result = await createAdminTimeEntry({
      tenantId,
      employeeId,
      dayDateRaw: String(formData.get('dayDate') ?? '').trim(),
      rangeEndDateRaw: parseString(formData.get('rangeEndDate')),
      kommt1Raw: parseString(formData.get('kommt1')),
      geht1Raw: parseString(formData.get('geht1')),
      kommt2Raw: parseString(formData.get('kommt2')),
      geht2Raw: parseString(formData.get('geht2')),
      pauseRaw: parseString(formData.get('pause')),
      codeRaw: parseString(formData.get('code')),
      mittagRaw: parseString(formData.get('mittag')),
      bruttoRaw: parseString(formData.get('brutto')),
      bemerkungenRaw: parseString(formData.get('bemerkungen')),
      performedBy: {
        type: 'admin',
        id: session.user.id ?? null,
        name: formatAdminName(session),
      },
    });

    if (result.status === 'success') {
      revalidatePath(withAppBasePath(`/admin/mitarbeitende/${employeeId}`));
    }
    return result;
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }
    console.error('Failed to create admin time entry', error);
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Eintrag konnte nicht gespeichert werden.',
    };
  }
}

async function deleteAdminTimeEntryAction(
  _prevState: EntryActionState,
  formData: FormData | null
): Promise<EntryActionState> {
  'use server';
  if (!formData) {
    return _prevState ?? null;
  }
  try {
    const { tenantId } = await ensureAdminSession();

    const employeeId = Number.parseInt(String(formData.get('employeeId') ?? ''), 10);
    if (!Number.isFinite(employeeId)) {
      return { status: 'error', message: 'Mitarbeiter-ID fehlt.' };
    }

    const result = await deleteAdminTimeEntry({
      tenantId,
      employeeId,
      dayDateRaw: String(formData.get('dayDate') ?? '').trim(),
    });

    if (result.status === 'success') {
      revalidatePath(withAppBasePath(`/admin/mitarbeitende/${employeeId}`));
    }
    return result;
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }
    console.error('Failed to delete admin time entry', error);
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Eintrag konnte nicht gelöscht werden.',
    };
  }
}

async function updateProfileAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  'use server';
  const { tenantId } = await ensureAdminSession();
  const employeeId = Number.parseInt(String(formData.get('employeeId') ?? ''), 10);
  if (!Number.isFinite(employeeId)) {
    return { status: 'error', message: 'Mitarbeiter-ID fehlt.' };
  }

  const federalStateRaw = parseString(formData.get('federal_state'));
  const federalState = federalStateRaw && isFederalStateCode(federalStateRaw)
    ? federalStateRaw
    : null;
  const birthDateRaw = parseString(formData.get('birth_date'));
  const { value: birthDate, error: birthDateError } = normalizeBirthDateValue(birthDateRaw);
  if (birthDateError) {
    return { status: 'error', message: birthDateError };
  }

  const showInCalendarValues = formData
    .getAll('showInCalendar')
    .map((value) => String(value).toLowerCase());
  const showInCalendar = showInCalendarValues.some((value) => value === '1' || value === 'true' || value === 'on');
  const iban = normalizeIbanValue(formData.get('iban'));
  const bic = normalizeBicValue(formData.get('bic'));
  const weeklyHours = parseNumberOrNull(formData.get('weekly_hours'));

  try {
    await updateAdminEmployeeProfile(tenantId, {
      employeeId,
      federalState,
      birthDate,
      showInCalendar,
      vacationCarryExpiryEnabledRaw: parseString(formData.get('vacation_carry_expiry_enabled')),
      vacationCarryExpiryMonth: parseString(formData.get('vacation_carry_expiry_month')),
      vacationCarryExpiryDay: parseString(formData.get('vacation_carry_expiry_day')),
      iban,
      bic,
      weeklyHours,
      compensationTypeRaw: parseString(formData.get('compensation_type')),
      hourlyWageInput: parseNumberOrNull(formData.get('hourly_wage')),
      monthlySalaryGrossInput: parseNumberOrNull(formData.get('monthly_salary_gross')),
      entryDateRaw: parseString(formData.get('entry_date')),
      exitDateRaw: parseString(formData.get('exit_date')),
      firstName: parseString(formData.get('first_name')),
      lastName: parseString(formData.get('last_name')),
      street: parseString(formData.get('street')),
      houseNumber: parseString(formData.get('house_number')),
      zipCode: parseString(formData.get('zip_code')),
      city: parseString(formData.get('city')),
      phone: parseString(formData.get('phone')),
      email: parseString(formData.get('email')),
      kinderfreibetrag: parseNumberOrNull(formData.get('kinderfreibetrag')),
      taxClass: parseString(formData.get('tax_class')),
      steuerId: parseString(formData.get('steuer_id')),
      socialSecurityNumber: parseString(formData.get('social_security_number')),
      healthInsurance: parseString(formData.get('health_insurance')),
      healthInsuranceNumber: parseString(formData.get('health_insurance_number')),
      nationality: parseString(formData.get('nationality')),
      maritalStatus: parseString(formData.get('marital_status')),
      employmentType: parseString(formData.get('employment_type')),
      workTimeModel: parseString(formData.get('work_time_model')),
      probationMonths: parseNumberOrNull(formData.get('probation_months')),
      tarifGroup: parseString(formData.get('tarif_group')),
      emergencyContactName: parseString(formData.get('emergency_contact_name')),
      emergencyContactPhone: parseString(formData.get('emergency_contact_phone')),
      emergencyContactRelation: parseString(formData.get('emergency_contact_relation')),
      vacationDaysTotal: parseNumberOrNull(formData.get('vacation_days_total')),
      importedOvertimeBalance: parseNumberOrNull(formData.get('imported_overtime_balance')),
      importedMinusstundenBalance: parseNumberOrNull(formData.get('imported_minusstunden_balance')),
      importedVacationTaken: parseNumberOrNull(formData.get('imported_vacation_taken')),
      importedBonusEarned: parseNumberOrNull(formData.get('imported_bonus_earned')),
    });
  } catch (error) {
    console.error('[admin/employee] updateProfileAction failed', {
      tenantId,
      employeeId,
      error,
    });
    return {
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Profil konnte nicht aktualisiert werden. Bitte Eingaben prüfen.',
    };
  }
  revalidatePath(withAppBasePath(`/admin/mitarbeitende/${employeeId}`));
  return { status: 'success', message: 'Profil aktualisiert.' };
}

async function deleteEmployeeAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  'use server';
  const { tenantId } = await ensureAdminSession();
  const employeeId = Number.parseInt(String(formData.get('employeeId') ?? ''), 10);
  if (!Number.isFinite(employeeId)) {
    return { status: 'error', message: 'Mitarbeiter-ID fehlt.' };
  }

  if (!(await adminEmployeeExists(tenantId, employeeId))) {
    return { status: 'error', message: 'Mitarbeiter nicht gefunden.' };
  }

  await removeEmployee(tenantId, employeeId);
  revalidatePath(withAppBasePath('/admin/mitarbeitende'));
  redirect(withAppBasePath('/admin/mitarbeitende'));
}

async function updateSettingsAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  'use server';
  const { tenantId } = await ensureAdminSession();
  const employeeId = Number.parseInt(String(formData.get('employeeId') ?? ''), 10);
  if (!Number.isFinite(employeeId)) {
    return { status: 'error', message: 'Mitarbeiter-ID fehlt.' };
  }

  const errorMessage = await updateAdminEmployeeSettings(tenantId, {
    employeeId,
    maxMinusHours: parseNumberOrNull(formData.get('maxMinusHours')),
    maxOvertimeHours: parseNumberOrNull(formData.get('maxOvertimeHours')),
    sachbezuege: parseYesNo(formData.get('sachbezuege')),
    sachbezuegeAmount: parseNumber(formData.get('sachbezuegeAmount')),
    mindJahresumsatz: parseNumber(formData.get('mindJahresumsatz')),
    sachbezugVerpflegung: parseYesNo(formData.get('sachbezugVerpflegung')),
    monthlyBonusProvided: formData.has('monatlicherBonusProzent'),
    monthlyBonusPercent: parseNumber(formData.get('monatlicherBonusProzent')),
    importedOvertimeBalanceInput: parseNumberOrNull(formData.get('imported_overtime_balance')),
    importedMinusstundenBalanceInput: parseNumberOrNull(formData.get('imported_minusstunden_balance')),
    importedVacationCarryDaysInput: parseNumberOrNull(formData.get('imported_vacation_taken')),
    importedBonusEarnedInput: parseNumberOrNull(formData.get('imported_bonus_earned')),
    openingTypeRaw: parseString(formData.get('opening_type')),
    openingValuesLockedRaw: parseString(formData.get('opening_values_locked')),
    openingEffectiveDateRaw: parseString(formData.get('opening_effective_date')),
    openingOvertimeBalanceInput: parseNumberOrNull(formData.get('opening_overtime_balance')),
    openingVacationCarryDaysInput: parseNumberOrNull(formData.get('opening_vacation_carry_days')),
    openingVacationTakenYtdInput: parseNumberOrNull(formData.get('opening_vacation_taken_ytd')),
    openingBonusCarryInput: parseNumberOrNull(formData.get('opening_bonus_carry')),
    mandatoryPauseEnabled: parseYesNo(formData.get('mandatoryPauseEnabled')) === 'Ja',
    mandatoryPauseMinWorkMinutes: parseNumber(formData.get('mandatoryPauseMinWorkMinutes')),
    minPauseUnder6Minutes: parseNumber(formData.get('minPauseUnder6Minutes')),
  });
  if (errorMessage) {
    return { status: 'error', message: errorMessage };
  }

  revalidatePath(withAppBasePath(`/admin/mitarbeitende/${employeeId}`));
  revalidatePath(withAppBasePath('/admin/mitarbeitende'));
  return { status: 'success', message: 'Einstellungen gespeichert.' };
}

async function updateBonusAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  'use server';
  const { tenantId } = await ensureAdminSession();
  const employeeId = Number.parseInt(String(formData.get('employeeId') ?? ''), 10);
  if (!Number.isFinite(employeeId)) {
    return { status: 'error', message: 'Mitarbeiter-ID fehlt.' };
  }

  const schemeType = (formData.get('schemeType') ?? 'linear') as BonusSchemeType;
  const linearPercentRaw = toNumber(formData.get('linearPercent'));
  const tiersRaw = String(formData.get('tiersData') ?? '').trim();

  const tiers: BonusTier[] = tiersRaw
    ? tiersRaw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [thresholdRaw, percentRaw] = line.split(';').map((part) => part.trim());
          const threshold = toNumber(thresholdRaw);
          const percent = toNumber(percentRaw ?? '0');
          if (threshold === null || percent === null) {
            throw new Error(`Ungültige Stufe: ${line}`);
          }
          return { threshold, percent };
        })
    : [];

  if (schemeType === 'linear') {
    if (linearPercentRaw === null) {
      return { status: 'error', message: 'Bitte einen Bonus-Prozentsatz angeben.' };
    }
    if (linearPercentRaw < 0 || linearPercentRaw > 100) {
      return { status: 'error', message: 'Der Bonus-Prozentsatz muss zwischen 0 und 100 liegen.' };
    }
  }

  if (schemeType === 'stufen') {
    if (!tiers.length) {
      return { status: 'error', message: 'Für das Stufenmodell wird mindestens eine Stufe benötigt.' };
    }

    let lastThreshold = -Infinity;
    for (const [index, tier] of tiers.entries()) {
      if (tier.threshold <= 0) {
        return { status: 'error', message: `Schwelle in Zeile ${index + 1} muss größer als 0 sein.` };
      }
      if (tier.percent < 0 || tier.percent > 100) {
        return {
          status: 'error',
          message: `Prozentwert in Zeile ${index + 1} muss zwischen 0 und 100 liegen.`,
        };
      }
      if (tier.threshold <= lastThreshold) {
        return {
          status: 'error',
          message: 'Die Stufen-Schwellen müssen streng ansteigend sortiert sein.',
        };
      }
      lastThreshold = tier.threshold;
    }
  }

  const linearPercent = schemeType === 'linear' ? linearPercentRaw ?? 0 : 0;

  const scheme: BonusScheme = {
    schemeType,
    linearPercent,
  };

  try {
    await saveEmployeeBonusConfiguration(tenantId, employeeId, scheme, schemeType === 'stufen' ? tiers : []);
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Bonus konnte nicht gespeichert werden.',
    };
  }

  revalidatePath(withAppBasePath(`/admin/mitarbeitende/${employeeId}`));
  return { status: 'success', message: 'Bonus-Konfiguration gespeichert.' };
}

async function updateTillhubAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  'use server';
  const { tenantId } = await ensureAdminSession();
  const employeeId = Number.parseInt(String(formData.get('employeeId') ?? ''), 10);
  if (!Number.isFinite(employeeId)) {
    return { status: 'error', message: 'Mitarbeiter-ID fehlt.' };
  }

  const tillhubUserId = parseString(formData.get('tillhubUserId'));
  await saveEmployeeTillhubUser(tenantId, employeeId, tillhubUserId);
  revalidatePath(withAppBasePath(`/admin/mitarbeitende/${employeeId}`));
  return { status: 'success', message: 'Tillhub-ID aktualisiert.' };
}

async function updateMandatoryPauseScheduleAction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  'use server';
  const { tenantId } = await ensureAdminSession();

  const employeeId = Number.parseInt(String(formData.get('employeeId') ?? ''), 10);
  if (!Number.isFinite(employeeId)) {
    return { status: 'error', message: 'Mitarbeiter-ID fehlt.' };
  }

  if (!(await adminEmployeeExists(tenantId, employeeId))) {
    return { status: 'error', message: 'Mitarbeiter nicht gefunden.' };
  }

  const employee = await getAdminEmployeeDetails(tenantId, employeeId);
  if (!employee) {
    return { status: 'error', message: 'Mitarbeiter nicht gefunden.' };
  }

  if (!employee.mandatoryPauseEnabled) {
    return { status: 'error', message: 'Pflichtpause ist für diesen Mitarbeiter deaktiviert.' };
  }

  const payloadRaw = formData.get('payload');
  if (typeof payloadRaw !== 'string' || !payloadRaw.trim()) {
    return { status: 'error', message: 'Ungültige Eingabe.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadRaw);
  } catch {
    return { status: 'error', message: 'Eingaben konnten nicht gelesen werden.' };
  }

  if (!parsed || typeof parsed !== 'object' || !('entries' in (parsed as Record<string, unknown>))) {
    return { status: 'error', message: 'Ungültige Eingabe.' };
  }

  const entriesRaw = (parsed as { entries: unknown }).entries;
  if (!Array.isArray(entriesRaw)) {
    return { status: 'error', message: 'Ungültige Eingabe.' };
  }

  const sanitized: { weekday: number; minutes: number }[] = [];
  for (const item of entriesRaw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const weekday = Number((item as { weekday?: unknown }).weekday);
    const minutes = Number((item as { minutes?: unknown }).minutes);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      continue;
    }
    if (!Number.isFinite(minutes) || minutes < 0) {
      return { status: 'error', message: 'Pflichtpausen müssen positive Zahlen sein.' };
    }
    sanitized.push({ weekday, minutes: Math.round(minutes) });
  }

  if (!sanitized.length) {
    return { status: 'error', message: 'Es wurden keine gültigen Werte übertragen.' };
  }

  await saveEmployeeWeekdayPauses(tenantId, employeeId, sanitized);
  revalidatePath(withAppBasePath(`/admin/mitarbeitende/${employeeId}?tab=time`));
  return { status: 'success', message: 'Pflichtpausen gespeichert.' };
}

async function saveSummaryPreferencesAction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  'use server';
  const { tenantId } = await ensureAdminSession();

  const employeeId = Number.parseInt(String(formData.get('employeeId') ?? ''), 10);
  if (!Number.isFinite(employeeId)) {
    return { status: 'error', message: 'Mitarbeiter-ID fehlt.' };
  }
  if (!(await adminEmployeeExists(tenantId, employeeId))) {
    return { status: 'error', message: 'Mitarbeiter nicht gefunden.' };
  }

  const raw = formData.get('preferences');
  if (typeof raw !== 'string') {
    return { status: 'error', message: 'Einstellungen konnten nicht gelesen werden.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'error', message: 'Ungültiges Einstellungsformat.' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { status: 'error', message: 'Ungültige Einstellungen.' };
  }

  const prefs = parsed as Record<string, unknown>;
  const sanitized = {
    sales: Boolean(prefs.sales ?? true),
    bonus: Boolean(prefs.bonus ?? true),
    worktime: Boolean(prefs.worktime ?? true),
    absences: Boolean(prefs.absences ?? true),
  };

  await saveAdminSummaryPreferences(employeeId, sanitized);
  revalidatePath(withAppBasePath(`/admin/mitarbeitende/${employeeId}`));
  return { status: 'success', message: 'Ansicht gespeichert.' };
}

async function updateBonusPayoutAction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  'use server';
  const { tenantId } = await ensureAdminSession();

  const employeeId = Number.parseInt(String(formData.get('employeeId') ?? ''), 10);
  const year = Number.parseInt(String(formData.get('year') ?? ''), 10);
  const month = Number.parseInt(String(formData.get('month') ?? ''), 10);

  if (!Number.isFinite(employeeId) || !Number.isFinite(year) || !Number.isFinite(month)) {
    return { status: 'error', message: 'Parameter fehlen.' };
  }
  if (!(await adminEmployeeExists(tenantId, employeeId))) {
    return { status: 'error', message: 'Mitarbeiter nicht gefunden.' };
  }

  const payoutRaw = formData.get('payout');
  if (typeof payoutRaw !== 'string') {
    return { status: 'error', message: 'Bitte einen Betrag angeben.' };
  }

  const payout = Number.parseFloat(payoutRaw.replace(',', '.'));
  if (!Number.isFinite(payout) || payout < 0) {
    return { status: 'error', message: 'Ungültiger Auszahlungsbetrag.' };
  }

  await saveAdminBonusPayout(tenantId, employeeId, year, month, payout);
  revalidatePath(withAppBasePath(`/admin/mitarbeitende/${employeeId}?year=${year}&month=${month}`));
  return { status: 'success', message: 'Bonus-Auszahlung gespeichert.' };
}

async function updateOvertimePayoutAction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  'use server';
  const { tenantId } = await ensureAdminSession();

  const employeeId = Number.parseInt(String(formData.get('employeeId') ?? ''), 10);
  const year = Number.parseInt(String(formData.get('year') ?? ''), 10);
  const month = Number.parseInt(String(formData.get('month') ?? ''), 10);

  if (!Number.isFinite(employeeId) || !Number.isFinite(year) || !Number.isFinite(month)) {
    return { status: 'error', message: 'Parameter fehlen.' };
  }
  if (!(await adminEmployeeExists(tenantId, employeeId))) {
    return { status: 'error', message: 'Mitarbeiter nicht gefunden.' };
  }

  const payoutRaw = formData.get('payoutHours');
  if (typeof payoutRaw !== 'string') {
    return { status: 'error', message: 'Bitte eine Stundenanzahl angeben.' };
  }

  const payout = Number.parseFloat(payoutRaw.replace(',', '.'));
  if (!Number.isFinite(payout)) {
    return { status: 'error', message: 'Ungültige Überstundenauszahlung.' };
  }

  const { remainingBalance } = await saveAdminOvertimePayout(tenantId, employeeId, year, month, payout);
  revalidatePath(withAppBasePath(`/admin/mitarbeitende/${employeeId}?year=${year}&month=${month}`));
  return {
    status: 'success',
    message: `Überstundenauszahlung gespeichert. Neuer Kontostand: ${remainingBalance.toFixed(2).replace('.', ',')} h.`,
  };
}

async function updateOvertimeBalanceAction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  'use server';
  const { tenantId, session } = await ensureAdminSession();

  const employeeId = Number.parseInt(String(formData.get('employeeId') ?? ''), 10);
  const year = Number.parseInt(String(formData.get('year') ?? ''), 10);
  const month = Number.parseInt(String(formData.get('month') ?? ''), 10);
  if (!Number.isFinite(employeeId) || !Number.isFinite(year) || !Number.isFinite(month)) {
    return { status: 'error', message: 'Parameter fehlen.' };
  }
  if (!(await adminEmployeeExists(tenantId, employeeId))) {
    return { status: 'error', message: 'Mitarbeiter nicht gefunden.' };
  }

  const deltaRaw = formData.get('adjustmentDelta');
  if (typeof deltaRaw !== 'string') {
    return { status: 'error', message: 'Bitte einen Korrekturwert für das Stundenkonto angeben.' };
  }
  const adjustmentDelta = Number.parseFloat(deltaRaw.replace(',', '.'));
  if (!Number.isFinite(adjustmentDelta)) {
    return { status: 'error', message: 'Ungültiger Korrekturwert für das Stundenkonto.' };
  }
  const normalizedDelta = roundTwo(adjustmentDelta);
  if (Math.abs(normalizedDelta) < 0.0001) {
    return { status: 'error', message: 'Bitte eine Korrektur ungleich 0,00 h eingeben.' };
  }
  const quarterSteps = normalizedDelta * 4;
  if (Math.abs(quarterSteps - Math.round(quarterSteps)) > 0.0001) {
    return { status: 'error', message: 'Die Korrektur ist nur in 0,25h-Schritten möglich.' };
  }

  const adminName = formatAdminName(session);
  const adminId = Number.isFinite(session.user.id) ? Number(session.user.id) : null;

  let newCurrentBalance: number;
  try {
    const result = await saveAdminOvertimeBalanceAdjustment(
      tenantId,
      employeeId,
      year,
      month,
      normalizedDelta,
      adminId,
      adminName,
    );
    newCurrentBalance = result.newCurrentBalance;
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Stundenkonto-Korrektur konnte nicht gespeichert werden.',
    };
  }

  revalidatePath(withAppBasePath(`/admin/mitarbeitende/${employeeId}?year=${year}&month=${month}`));
  return {
    status: 'success',
    message: `Stundenkonto um ${normalizedDelta.toFixed(2).replace('.', ',')} h korrigiert. Neuer Kontostand: ${newCurrentBalance.toFixed(2).replace('.', ',')} h.`,
  };
}

async function acceptOnboardingAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  'use server';
  const { tenantId } = await ensureAdminSession();

  const employeeId = Number.parseInt(String(formData.get('employee_id') ?? ''), 10);
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    return { status: 'error', message: 'Ungültige Mitarbeiter-ID.' };
  }

  try {
    const result = await acceptAdminEmployeeOnboarding(tenantId, employeeId);
    if (result.status === 'success') {
      revalidatePath(withAppBasePath(`/admin/mitarbeitende/${employeeId}`));
      revalidatePath(withAppBasePath('/admin/mitarbeitende'));
    }
    return result;
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error ? error.message : 'Mitarbeiter konnte nicht übernommen werden.',
    };
  }
}

function formatAdminName(session: Awaited<ReturnType<typeof getServerAuthSession>>): string {
  const first = session?.user?.firstName?.trim();
  const last = session?.user?.lastName?.trim();
  if (first || last) {
    return [first, last].filter(Boolean).join(' ');
  }
  return session?.user?.username ?? 'Admin';
}

async function closeMonthlyClosingAction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  'use server';
  const { session, tenantId } = await ensureAdminSession();

  const employeeId = Number.parseInt(String(formData.get('employeeId') ?? ''), 10);
  const year = Number.parseInt(String(formData.get('year') ?? ''), 10);
  const month = Number.parseInt(String(formData.get('month') ?? ''), 10);

  if (!Number.isFinite(employeeId) || !Number.isFinite(year) || !Number.isFinite(month)) {
    return { status: 'error', message: 'Parameter fehlen für den Monatsabschluss.' };
  }
  if (!(await adminEmployeeExists(tenantId, employeeId))) {
    return { status: 'error', message: 'Mitarbeiter nicht gefunden.' };
  }

  try {
    await closeMonthlyClosing(employeeId, year, month, formatAdminName(session));
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Monatsabschluss konnte nicht durchgeführt werden.',
    };
  }

  revalidatePath(withAppBasePath(`/admin/mitarbeitende/${employeeId}?year=${year}&month=${month}`));
  return {
    status: 'success',
    message: `Monat ${String(month).padStart(2, '0')}.${year} abgeschlossen.`,
  };
}

async function reopenMonthlyClosingAction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  'use server';
  const { tenantId } = await ensureAdminSession();

  const employeeId = Number.parseInt(String(formData.get('employeeId') ?? ''), 10);
  const year = Number.parseInt(String(formData.get('year') ?? ''), 10);
  const month = Number.parseInt(String(formData.get('month') ?? ''), 10);

  if (!Number.isFinite(employeeId) || !Number.isFinite(year) || !Number.isFinite(month)) {
    return { status: 'error', message: 'Parameter fehlen für die Wiedereröffnung.' };
  }
  if (!(await adminEmployeeExists(tenantId, employeeId))) {
    return { status: 'error', message: 'Mitarbeiter nicht gefunden.' };
  }

  try {
    await reopenMonthlyClosing(employeeId, year, month);
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Monatsabschluss konnte nicht wieder geöffnet werden.',
    };
  }

  revalidatePath(withAppBasePath(`/admin/mitarbeitende/${employeeId}?year=${year}&month=${month}`));
  return {
    status: 'success',
    message: `Monat ${String(month).padStart(2, '0')}.${year} wieder geöffnet.`,
  };
}

export default async function AdminEmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams?: Promise<{ year?: string; month?: string }>;
}) {
  const { tenantId } = await ensureAdminSession();

  const employees = await getAdminEmployeeList(tenantId);
  if (!employees.length) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold text-slate-900">Mitarbeiterverwaltung</h1>
        <p className="text-sm text-slate-500">Keine Mitarbeitenden gefunden.</p>
      </section>
    );
  }

  const resolvedParams = await params;
  const employeeId = Number.parseInt(resolvedParams.employeeId, 10);
  if (!Number.isFinite(employeeId) || !(await adminEmployeeExists(tenantId, employeeId))) {
    notFound();
  }

  const employee = await getAdminEmployeeDetails(tenantId, employeeId);
  if (!employee) {
    notFound();
  }

  const resolvedSearch = searchParams ? await searchParams : undefined;
  const year = resolvedSearch?.year ? Number.parseInt(resolvedSearch.year, 10) : undefined;
  const month = resolvedSearch?.month ? Number.parseInt(resolvedSearch.month, 10) : undefined;
  const dailyOverview = await getDailyOverview(tenantId, employeeId, year, month);
  const bonusConfig = await getEmployeeBonusConfiguration(tenantId, employeeId);
  const monthlySummary = await getMonthlyAdminSummary(
    tenantId,
    employeeId,
    dailyOverview.selectedYear,
    dailyOverview.selectedMonth
  );
  const monthlyClosing = await getMonthlyClosingState(
    employeeId,
    dailyOverview.selectedYear,
    dailyOverview.selectedMonth
  );
  const monthlyClosingHistory = await getMonthlyClosingHistory(employeeId, 12);
  const timeEntries = await listTimeEntries(employeeId);
  const validationProfile = await getAdminEmployeeValidationInfo(tenantId, employeeId);
  const shiftPlan = await getShiftPlan(employeeId);
  const { closedMonths, vacationCarryNotifications } = await getAdminEmployeeSummaryReadBlock(
    tenantId,
    employeeId
  );
  const requiresMealFlag = (validationProfile?.sachbezugVerpflegung ?? 'Nein').toLowerCase() === 'ja';
  const mandatoryPauseMinWorkMinutes = validationProfile?.mandatoryPauseMinWorkMinutes ?? 0;
  const minPauseUnder6Minutes = validationProfile?.minPauseUnder6Minutes ?? 0;
  const weekdayPauses = await getEmployeeWeekdayPauses(tenantId, employeeId);
  const onboardingSubmission = await getEmployeeOnboardingSubmissionSnapshot(tenantId, employeeId);
  const onboardingSubmissionView = onboardingSubmission
    ? {
        inviteId: onboardingSubmission.inviteId,
        inviteCreatedAtLabel: onboardingSubmission.inviteCreatedAt.toLocaleString('de-DE'),
        submittedAtLabel: onboardingSubmission.submittedAt
          ? onboardingSubmission.submittedAt.toLocaleString('de-DE')
          : null,
        inviteEmail: onboardingSubmission.inviteEmail,
        inviteFirstName: onboardingSubmission.inviteFirstName,
        inviteLastName: onboardingSubmission.inviteLastName,
        signatureName: onboardingSubmission.signatureName,
        signatureAcceptedAtLabel: onboardingSubmission.signatureAcceptedAt
          ? onboardingSubmission.signatureAcceptedAt.toLocaleString('de-DE')
          : null,
        adminPreset: onboardingSubmission.adminPreset,
        submission: onboardingSubmission.submission,
      }
    : null;

  return (
    <AdminEmployeeDetailClient
      employees={employees}
      selectedEmployeeId={employeeId}
      employee={employee}
      dailyOverview={dailyOverview}
      bonusScheme={bonusConfig.scheme}
      bonusTiers={bonusConfig.tiers}
      monthlySummary={monthlySummary}
      monthlyClosing={monthlyClosing}
      monthlyClosingHistory={monthlyClosingHistory}
      timeEntries={timeEntries}
      closedMonths={closedMonths}
      shiftPlan={shiftPlan.days}
      requiresMealFlag={requiresMealFlag}
      minPauseUnder6Minutes={minPauseUnder6Minutes}
      mandatoryPauseMinWorkMinutes={mandatoryPauseMinWorkMinutes}
      mandatoryPauseEnabled={employee.mandatoryPauseEnabled}
      weekdayPauses={weekdayPauses}
      vacationCarryNotifications={vacationCarryNotifications}
      onboardingSubmission={onboardingSubmissionView}
      profileAction={updateProfileAction}
      profileInitialState={null}
      deleteAction={deleteEmployeeAction}
      deleteInitialState={null}
      settingsAction={updateSettingsAction}
      settingsInitialState={null}
      bonusAction={updateBonusAction}
      bonusInitialState={null}
      tillhubAction={updateTillhubAction}
      tillhubInitialState={null}
      createTimeEntryAction={createAdminTimeEntryAction}
      createTimeEntryInitialState={null}
      deleteTimeEntryAction={deleteAdminTimeEntryAction}
      deleteTimeEntryInitialState={null}
      mandatoryPauseAction={updateMandatoryPauseScheduleAction}
      mandatoryPauseInitialState={null}
      summaryPreferencesAction={saveSummaryPreferencesAction}
      summaryPreferencesInitialState={null}
      bonusPayoutAction={updateBonusPayoutAction}
      bonusPayoutInitialState={null}
      overtimePayoutAction={updateOvertimePayoutAction}
      overtimePayoutInitialState={null}
      overtimeBalanceAction={updateOvertimeBalanceAction}
      overtimeBalanceInitialState={null}
      acceptOnboardingAction={acceptOnboardingAction}
      acceptOnboardingInitialState={null}
      closeMonthlyClosingAction={closeMonthlyClosingAction}
      closeMonthlyClosingInitialState={null}
      reopenMonthlyClosingAction={reopenMonthlyClosingAction}
      reopenMonthlyClosingInitialState={null}
    />
  );
}
