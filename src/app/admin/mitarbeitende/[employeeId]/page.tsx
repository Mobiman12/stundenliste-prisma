import { revalidatePath } from 'next/cache';
import { redirect, notFound } from 'next/navigation';

import { hashPassword } from '@/lib/auth';
import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import {
  adminEmployeeExists,
  getAdminEmployeeDetails,
  getAdminEmployeeList,
  getDailyOverview,
  getEmployeeBonusConfiguration,
  getEmployeeWeekdayPauses,
  saveAdminEmployeeDetails,
  saveEmployeeBonusConfiguration,
  saveEmployeeSettings,
  saveEmployeeTillhubUser,
  saveEmployeeWeekdayPauses,
  removeEmployee,
  type BonusScheme,
  type BonusTier,
} from '@/lib/services/admin/employee';
import { getMonthlyAdminSummary } from '@/lib/services/admin/employee-summary';
import {
  closeMonthlyClosing,
  getMonthlyClosingHistory,
  getMonthlyClosingState,
  reopenMonthlyClosing,
} from '@/lib/services/admin/monthly-closing';
import { saveFooterPreferences } from '@/lib/data/footer-preferences';
import { upsertEmployeeBonusEntry } from '@/lib/data/employee-bonus';
import { upsertEmployeeOvertimePayout } from '@/lib/data/employee-overtime-payouts';
import { listMonthlyClosings } from '@/lib/data/monthly-closings';
import { getEmployeeValidationInfo } from '@/lib/data/employees';
import { isMonthClosedForEmployee } from '@/lib/services/employee/monthly-closing';
import { getPlanHoursForDay, getShiftPlan } from '@/lib/services/shift-plan';
import { deleteTimeEntry, listTimeEntries, saveTimeEntry } from '@/lib/services/time-entry';
import { validateTimeEntry } from '@/lib/services/time-entry-validation';
import { isHolidayIsoDate, normalizeHolidayRegion } from '@/lib/services/holidays';
import { FEDERAL_STATE_OPTIONS, type GermanFederalStateCode } from '@/lib/constants/federal-states';

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

function formatMonthLabel(year: number, month: number): string {
  const MONTH_NAMES = [
    'Januar',
    'Februar',
    'März',
    'April',
    'Mai',
    'Juni',
    'Juli',
    'August',
    'September',
    'Oktober',
    'November',
    'Dezember',
  ];
  const index = month - 1;
  const name = MONTH_NAMES[index] ?? '';
  return name ? `${name} ${year}` : `${String(month).padStart(2, '0')}.${year}`;
}

function extractYearMonth(isoDate: string): { year: number; month: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return null;
  }
  const year = Number.parseInt(isoDate.slice(0, 4), 10);
  const month = Number.parseInt(isoDate.slice(5, 7), 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return null;
  }
  return { year, month };
}

function normalizeTimeInput(value: FormDataEntryValue | null): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    return raw.padStart(5, '0');
  }
  if (/^\d{3,4}$/.test(raw)) {
    const padded = raw.padStart(4, '0');
    return `${padded.slice(0, 2)}:${padded.slice(2)}`;
  }
  return null;
}

function normalizePause(value: FormDataEntryValue | null): string | null {
  const raw = parseString(value);
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    return `${raw}min.`;
  }
  return raw;
}

const RANGE_ELIGIBLE_CODES = new Set(['U', 'UH', 'K', 'KK', 'KKR', 'KR', 'KU']);

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function compareIsoDate(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function addDaysIso(isoDate: string, delta: number): string {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + delta);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function enumerateIsoDates(startIso: string, endIso: string): string[] {
  if (!isIsoDate(startIso) || !isIsoDate(endIso)) {
    return [];
  }
  const result: string[] = [];
  let current = startIso;
  while (compareIsoDate(current, endIso) <= 0) {
    result.push(current);
    if (current === endIso) {
      break;
    }
    current = addDaysIso(current, 1);
  }
  return result;
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

    if (!(await adminEmployeeExists(tenantId, employeeId))) {
      return { status: 'error', message: 'Mitarbeiter wurde nicht gefunden.' };
    }

    const dayDateRaw = String(formData.get('dayDate') ?? '').trim();
    if (!dayDateRaw) {
      return { status: 'error', message: 'Bitte ein Datum auswählen.' };
    }

    if (!isIsoDate(dayDateRaw)) {
      return { status: 'error', message: 'Ungültiges Datum.' };
    }

    const validationProfile = await getEmployeeValidationInfo(tenantId, employeeId);
    if (!validationProfile) {
      return { status: 'error', message: 'Mitarbeiterdaten konnten nicht geladen werden.' };
    }

    const rangeEndRaw = parseString(formData.get('rangeEndDate')) ?? '';

    const kommt1 = normalizeTimeInput(formData.get('kommt1'));
    const geht1 = normalizeTimeInput(formData.get('geht1'));
    const kommt2 = normalizeTimeInput(formData.get('kommt2'));
    const geht2 = normalizeTimeInput(formData.get('geht2'));
    const pause = normalizePause(formData.get('pause'));
    const codeRaw = parseString(formData.get('code'));
    const code = codeRaw && codeRaw.trim().length ? codeRaw : 'RA';
    const mittag = (parseString(formData.get('mittag')) ?? 'Nein').toLowerCase() === 'ja' ? 'Ja' : 'Nein';
    const normalizedCode = (code ?? '').toUpperCase();

    if (normalizedCode === 'Ü' && (!kommt1 || !geht1)) {
      return { status: 'error', message: 'Für Überstundenabbau bitte Start- und Endzeit eingeben.' };
    }

    let rangeStart = dayDateRaw;
    let rangeEnd = dayDateRaw;

    if (rangeEndRaw && RANGE_ELIGIBLE_CODES.has(normalizedCode)) {
      if (!isIsoDate(rangeEndRaw)) {
        return { status: 'error', message: 'Der Zeitraum konnte nicht gelesen werden.' };
      }
      if (compareIsoDate(rangeEndRaw, rangeStart) < 0) {
        rangeStart = rangeEndRaw;
        rangeEnd = dayDateRaw;
      } else {
        rangeEnd = rangeEndRaw;
      }
    }

    const datesToProcess = enumerateIsoDates(rangeStart, rangeEnd);
    if (!datesToProcess.length) {
      return { status: 'error', message: 'Der Zeitraum konnte nicht gelesen werden.' };
    }

    for (const isoDate of datesToProcess) {
      const extracted = extractYearMonth(isoDate);
      if (!extracted) {
        return { status: 'error', message: 'Der Zeitraum enthält ein ungültiges Datum.' };
      }
      if (isMonthClosedForEmployee(employeeId, extracted.year, extracted.month)) {
        return {
          status: 'error',
          message: `Der Monat ${formatMonthLabel(extracted.year, extracted.month)} ist bereits abgeschlossen.`,
        };
      }
    }

    const federalState = normalizeHolidayRegion(validationProfile.federalState);

    const bruttoValue = Number.parseFloat(String(formData.get('brutto') ?? ''));
    const brutto = Number.isFinite(bruttoValue) ? bruttoValue : null;
    const bemerkungen = parseString(formData.get('bemerkungen'));
    const adminPerformer = {
      type: 'admin' as const,
      id: session.user.id ?? null,
      name: formatAdminName(session),
    };

    const warnings: string[] = [];
    let holidayCount = 0;

    for (const isoDate of datesToProcess) {
      const holidayInfo = normalizedCode === 'U' ? isHolidayIsoDate(isoDate, federalState) : { isHoliday: false };
      const effectiveCode = holidayInfo.isHoliday ? 'FT' : normalizedCode;
      if (holidayInfo.isHoliday) {
        holidayCount += 1;
      }

      const effectiveKommt1 = effectiveCode === 'FT' || normalizedCode === 'U' ? null : kommt1;
      const effectiveGeht1 = effectiveCode === 'FT' || normalizedCode === 'U' ? null : geht1;
      const effectiveKommt2 = effectiveCode === 'FT' || normalizedCode === 'U' ? null : kommt2;
      const effectiveGeht2 = effectiveCode === 'FT' || normalizedCode === 'U' ? null : geht2;
      const effectivePause = effectiveCode === 'FT' || normalizedCode === 'U' ? 'Keine' : pause;
      const effectiveMittag = effectiveCode === 'FT' || normalizedCode === 'U' ? 'Nein' : mittag;

      const planInfo = await getPlanHoursForDay(employeeId, isoDate);
      const validation = validateTimeEntry({
        kommt1: effectiveKommt1,
        geht1: effectiveGeht1,
        kommt2: effectiveKommt2,
        geht2: effectiveGeht2,
        pause: effectivePause,
        code: effectiveCode,
        mittag: effectiveMittag,
        planInfo,
        minPauseUnder6Minutes: validationProfile.minPauseUnder6Minutes,
        requiresMealFlag: (validationProfile.sachbezugVerpflegung ?? 'Nein').toLowerCase() === 'ja',
      });

      if (validation.errors.length) {
        const dateLabel = new Date(`${isoDate}T00:00:00`).toLocaleDateString('de-DE');
        return { status: 'error', message: `${dateLabel}: ${validation.errors[0]}` };
      }

      if (validation.warnings.length && !warnings.length) {
        warnings.push(validation.warnings[0]);
      }

      const activeCode = effectiveCode || 'RA';
      await saveTimeEntry({
        tenantId,
        employeeId,
        dayDate: isoDate,
        brutto,
        kommt1: effectiveKommt1,
        geht1: effectiveGeht1,
        kommt2: effectiveKommt2,
        geht2: effectiveGeht2,
        pause: effectivePause,
        code: activeCode,
        bemerkungen,
        mittag: effectiveMittag,
        performedBy: adminPerformer,
      });
    }

    revalidatePath(withAppBasePath(`/admin/mitarbeitende/${employeeId}`));
    const startLabel = new Date(`${rangeStart}T00:00:00`).toLocaleDateString('de-DE');
    const endLabel = new Date(`${rangeEnd}T00:00:00`).toLocaleDateString('de-DE');
    const messageBase = rangeStart === rangeEnd
      ? `Eintrag am ${startLabel} wurde gespeichert.`
      : `Zeitraum ${startLabel} – ${endLabel} wurde gespeichert.`;
    return {
      status: 'success',
      message: `${messageBase}${holidayCount ? ` ${holidayCount} ${holidayCount === 1 ? 'Tag wurde' : 'Tage wurden'} automatisch als Feiertag (FT) erfasst.` : ''}${warnings.length ? ` Hinweis: ${warnings[0]}` : ''}`,
    };
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

    if (!(await adminEmployeeExists(tenantId, employeeId))) {
      return { status: 'error', message: 'Mitarbeiter wurde nicht gefunden.' };
    }

    const dayDate = String(formData.get('dayDate') ?? '').trim();
    if (!dayDate) {
      return { status: 'error', message: 'Datum konnte nicht gelesen werden.' };
    }

    const extracted = extractYearMonth(dayDate);
    if (!extracted) {
      return { status: 'error', message: 'Ungültiges Datum.' };
    }

    if (isMonthClosedForEmployee(employeeId, extracted.year, extracted.month)) {
      return {
        status: 'error',
        message: `Der Monat ${formatMonthLabel(extracted.year, extracted.month)} ist abgeschlossen und kann nicht bearbeitet werden.`,
      };
    }

    await deleteTimeEntry(tenantId, employeeId, dayDate);
    revalidatePath(withAppBasePath(`/admin/mitarbeitende/${employeeId}`));
    return {
      status: 'success',
      message: `Tag ${new Date(`${dayDate}T00:00:00`).toLocaleDateString('de-DE')} wurde gelöscht.`,
    };
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

  if (!(await adminEmployeeExists(tenantId, employeeId))) {
    return { status: 'error', message: 'Mitarbeiter wurde nicht gefunden.' };
  }

  const existing = await getAdminEmployeeDetails(tenantId, employeeId);
  if (!existing) {
    return { status: 'error', message: 'Mitarbeiter wurde nicht gefunden.' };
  }

  const passwordRaw = parseString(formData.get('new_password'));
  const passwordHash = passwordRaw ? hashPassword(passwordRaw) : undefined;
  const federalStateRaw = parseString(formData.get('federal_state'));
  const federalState = federalStateRaw && isFederalStateCode(federalStateRaw)
    ? federalStateRaw
    : null;
  const bookingPinRaw = parseString(formData.get('booking_pin'));
  const bookingPin = bookingPinRaw ?? existing.booking_pin;
  if (!/^\d{4}$/.test(bookingPin)) {
    return { status: 'error', message: 'Die Buchungs-PIN muss aus genau 4 Ziffern bestehen.' };
  }
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

  const payload = {
    id: employeeId,
    first_name: existing.first_name,
    last_name: existing.last_name,
    street: existing.street ?? null,
    zip_code: existing.zip_code ?? null,
    city: existing.city ?? null,
    birth_date: existing.birth_date ?? null,
    entry_date: String(formData.get('entry_date') ?? existing.entry_date),
    phone: existing.phone ?? null,
    email: existing.email ?? null,
    booking_pin: bookingPin,
    federal_state: existing.federal_state ?? null,
    weekly_hours: parseNumberOrNull(formData.get('weekly_hours')),
    kinderfreibetrag: parseNumber(formData.get('kinderfreibetrag'), existing.kinderfreibetrag ?? 0),
    tax_class: parseString(formData.get('tax_class')),
    hourly_wage: parseNumberOrNull(formData.get('hourly_wage')),
    iban: iban,
    bic: bic,
    steuer_id: parseString(formData.get('steuer_id')),
    social_security_number: parseString(formData.get('social_security_number')),
    health_insurance: parseString(formData.get('health_insurance')),
    health_insurance_number: parseString(formData.get('health_insurance_number')),
    nationality: parseString(formData.get('nationality')),
    marital_status: parseString(formData.get('marital_status')),
    employment_type: parseString(formData.get('employment_type')),
    work_time_model: parseString(formData.get('work_time_model')),
    probation_months: parseNumberOrNull(formData.get('probation_months')),
    tarif_group: parseString(formData.get('tarif_group')),
    emergency_contact_name: parseString(formData.get('emergency_contact_name')),
    emergency_contact_phone: parseString(formData.get('emergency_contact_phone')),
    emergency_contact_relation: parseString(formData.get('emergency_contact_relation')),
    vacation_days: parseNumber(formData.get('vacation_days'), existing.vacation_days),
    vacation_days_last_year: parseNumber(
      formData.get('vacation_days_last_year'),
      existing.vacation_days_last_year
    ),
    vacation_days_total: parseNumber(formData.get('vacation_days_total'), existing.vacation_days_total),
    role_id: Number.parseInt(String(formData.get('role_id') ?? existing.role_id), 10),
    username: String(formData.get('username') ?? existing.username),
    passwordHash,
    imported_overtime_balance: parseNumber(formData.get('imported_overtime_balance'), existing.imported_overtime_balance),
    imported_minusstunden_balance: parseNumber(
      formData.get('imported_minusstunden_balance'),
      existing.imported_minusstunden_balance
    ),
    imported_vacation_taken: parseNumber(
      formData.get('imported_vacation_taken'),
      existing.imported_vacation_taken
    ),
    imported_bonus_earned: parseNumber(
      formData.get('imported_bonus_earned'),
      existing.imported_bonus_earned
    ),
    show_in_calendar: showInCalendar,
  };

  try {
    await saveAdminEmployeeDetails(tenantId, payload);
  } catch (error) {
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

  const existing = await getAdminEmployeeDetails(tenantId, employeeId);
  if (!existing) {
    return { status: 'error', message: 'Mitarbeiter nicht gefunden.' };
  }

  const mandatoryPauseEnabled = parseYesNo(formData.get('mandatoryPauseEnabled')) === 'Ja';
  const minPauseUnder6Minutes = mandatoryPauseEnabled ? 30 : 0;
  const monatlicherBonusProvided = formData.has('monatlicherBonusProzent');
  const monatlicherBonusProzent = monatlicherBonusProvided
    ? parseNumber(formData.get('monatlicherBonusProzent'))
    : Number(existing.monatlicher_bonus_prozent ?? 0);

  const payload = {
    employeeId,
    maxMinusHours: parseNumberOrNull(formData.get('maxMinusHours')),
    maxOvertimeHours: parseNumberOrNull(formData.get('maxOvertimeHours')),
    sachbezuege: parseYesNo(formData.get('sachbezuege')),
    sachbezuegeAmount: parseNumber(formData.get('sachbezuegeAmount')),
    mindJahresumsatz: parseNumber(formData.get('mindJahresumsatz')),
    sachbezugVerpflegung: parseYesNo(formData.get('sachbezugVerpflegung')),
    monatlicherBonusProzent,
    minPauseUnder6Minutes,
    mandatoryPauseEnabled,
  };

  await saveEmployeeSettings(tenantId, payload);
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

  saveFooterPreferences(employeeId, sanitized);
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

  const summary = await getMonthlyAdminSummary(tenantId, employeeId, year, month);
  const available = summary.bonus.available;
  const sanitizedPayout = Math.min(Math.max(payout, 0), available);
  const carryOver = roundTwo(Math.max(available - sanitizedPayout, 0));

  upsertEmployeeBonusEntry(employeeId, year, month, roundTwo(sanitizedPayout), carryOver);
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
  if (!Number.isFinite(payout) || payout < 0) {
    return { status: 'error', message: 'Ungültige Überstundenauszahlung.' };
  }

  const summary = await getMonthlyAdminSummary(tenantId, employeeId, year, month);
  const available = summary.overtime.maxPayout;
  const sanitizedPayout = roundTwo(Math.min(Math.max(payout, 0), available));
  const remaining = roundTwo(Math.max(available - sanitizedPayout, 0));

  upsertEmployeeOvertimePayout(employeeId, year, month, sanitizedPayout);
  revalidatePath(withAppBasePath(`/admin/mitarbeitende/${employeeId}?year=${year}&month=${month}`));
  return {
    status: 'success',
    message: `Überstundenauszahlung gespeichert. Verbleibend: ${remaining.toFixed(2).replace('.', ',')} h.`,
  };
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
    closeMonthlyClosing(employeeId, year, month, formatAdminName(session));
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
    reopenMonthlyClosing(employeeId, year, month);
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
  const monthlyClosing = getMonthlyClosingState(
    employeeId,
    dailyOverview.selectedYear,
    dailyOverview.selectedMonth
  );
  const monthlyClosingHistory = getMonthlyClosingHistory(employeeId, 12);
  const timeEntries = await listTimeEntries(employeeId);
  const validationProfile = await getEmployeeValidationInfo(tenantId, employeeId);
  const shiftPlan = await getShiftPlan(employeeId);
  const closings = listMonthlyClosings(employeeId, 24);
  const closedMonths = Array.from(
    new Set(
      closings
        .filter((item) => item.status === 'closed')
        .map((item) => `${item.year}-${String(item.month).padStart(2, '0')}`)
    )
  );
  const requiresMealFlag = (validationProfile?.sachbezugVerpflegung ?? 'Nein').toLowerCase() === 'ja';
  const minPauseUnder6Minutes = validationProfile?.minPauseUnder6Minutes ?? 0;
  const weekdayPauses = await getEmployeeWeekdayPauses(tenantId, employeeId);

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
      mandatoryPauseEnabled={employee.mandatoryPauseEnabled}
      weekdayPauses={weekdayPauses}
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
      closeMonthlyClosingAction={closeMonthlyClosingAction}
      closeMonthlyClosingInitialState={null}
      reopenMonthlyClosingAction={reopenMonthlyClosingAction}
      reopenMonthlyClosingInitialState={null}
    />
  );
}
