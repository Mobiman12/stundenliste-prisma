import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import { listMonthlyClosings } from '@/lib/data/monthly-closings';
import { getEmployeeValidationInfo } from '@/lib/data/employees';
import { isMonthClosedForEmployee } from '@/lib/services/employee/monthly-closing';
import { getPlanHoursForDay, getShiftPlan } from '@/lib/services/shift-plan';
import { deleteTimeEntry, listTimeEntries, saveTimeEntry } from '@/lib/services/time-entry';
import { validateTimeEntry } from '@/lib/services/time-entry-validation';
import { isHolidayIsoDate, normalizeHolidayRegion } from '@/lib/services/holidays';

import EmployeeEntriesSection from './EmployeeEntriesSection';
import type { EntryActionState } from './types';

async function requireEmployeeId(): Promise<{ employeeId: number; tenantId: string }> {
  const session = await getServerAuthSession();
  if (!session?.user) {
    redirect(withAppBasePath('/login?mode=employee'));
  }
  if (!session.user.employeeId) {
    redirect(withAppBasePath('/admin'));
  }
  const tenantId = session.tenantId;
  if (!tenantId) {
    redirect(withAppBasePath('/login?mode=employee'));
  }
  return { employeeId: session.user.employeeId, tenantId };
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

async function createEntry(
  _prevState: EntryActionState,
  formData: FormData
): Promise<EntryActionState> {
  'use server';
  const { employeeId, tenantId } = await requireEmployeeId();

  const dayDateRaw = String(formData.get('dayDate') ?? '').trim();
  if (!dayDateRaw) {
    return { status: 'error', message: 'Bitte ein Datum auswählen.' };
  }

  if (!isIsoDate(dayDateRaw)) {
    return { status: 'error', message: 'Ungültiges Datum.' };
  }

  const rangeEndRaw = String(formData.get('rangeEndDate') ?? '').trim();

  const kommt1 = normalizeTimeInput(formData.get('kommt1'));
  const geht1 = normalizeTimeInput(formData.get('geht1'));
  const kommt2 = normalizeTimeInput(formData.get('kommt2'));
  const geht2 = normalizeTimeInput(formData.get('geht2'));
  const pause = normalizePause(formData.get('pause'));
  const code = normalizeString(formData.get('code')) ?? 'RA';
  const mittag = normalizeString(formData.get('mittag')) ?? 'Nein';
  const normalizedCode = code ? code.toUpperCase() : '';

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

  const validationProfile = await getEmployeeValidationInfo(tenantId, employeeId);

  if (!validationProfile) {
    return { status: 'error', message: 'Mitarbeiterdaten konnten nicht geladen werden.' };
  }

  const bruttoValue = parseFloat(String(formData.get('brutto') ?? ''));
  const brutto = Number.isFinite(bruttoValue) ? bruttoValue : null;
  const bemerkungen = normalizeString(formData.get('bemerkungen'));

  const warnings: string[] = [];
  let holidayCount = 0;

  const federalState = normalizeHolidayRegion(validationProfile.federalState);

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
      requiresMealFlag: validationProfile.sachbezugVerpflegung.toLowerCase() === 'ja',
    });

    if (validation.errors.length) {
      const dateLabel = new Date(`${isoDate}T00:00:00`).toLocaleDateString('de-DE');
      return { status: 'error', message: `${dateLabel}: ${validation.errors[0]}` };
    }

    if (validation.warnings.length && !warnings.length) {
      warnings.push(validation.warnings[0]);
    }

    const activeCode = effectiveCode || 'RA';
    try {
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
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Der Eintrag konnte nicht gespeichert werden.';
      const dateLabel = new Date(`${isoDate}T00:00:00`).toLocaleDateString('de-DE');
      return { status: 'error', message: `${dateLabel}: ${message}` };
    }
  }
  revalidatePath(withAppBasePath('/mitarbeiter'));

  const firstLabel = new Date(`${rangeStart}T00:00:00`).toLocaleDateString('de-DE');
  const lastLabel = new Date(`${rangeEnd}T00:00:00`).toLocaleDateString('de-DE');
  const messageBase = rangeStart === rangeEnd
    ? `Eintrag am ${firstLabel} wurde gespeichert.`
    : `Zeitraum ${firstLabel} – ${lastLabel} wurde gespeichert.`;

  return {
    status: 'success',
    message: `${messageBase}${holidayCount ? ` ${holidayCount} ${holidayCount === 1 ? 'Tag wurde' : 'Tage wurden'} automatisch als Feiertag (FT) erfasst.` : ''}${warnings.length ? ` Hinweis: ${warnings[0]}` : ''}`,
  };
}

async function removeEntry(
  _prevState: EntryActionState,
  formData: FormData
): Promise<EntryActionState> {
  'use server';
  const { employeeId, tenantId } = await requireEmployeeId();
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
  revalidatePath(withAppBasePath('/mitarbeiter'));
  return {
    status: 'success',
    message: `Tag ${new Date(`${dayDate}T00:00:00`).toLocaleDateString('de-DE')} wurde gelöscht.`,
  };
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
  const raw = normalizeString(value);
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    return `${raw}min.`;
  }
  return raw;
}

function normalizeString(value: FormDataEntryValue | null): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  return raw ? raw : null;
}

export default async function MitarbeiterHomePage() {
  const session = await getServerAuthSession();
  if (!session?.user) {
    redirect(withAppBasePath('/login?mode=employee'));
  }

  if (!session.user.employeeId) {
    redirect(withAppBasePath('/admin'));
  }

  const tenantId = session.tenantId;
  if (!tenantId) {
    redirect(withAppBasePath('/login?mode=employee'));
  }

  const employeeId = session.user.employeeId;
  const entries = await listTimeEntries(employeeId);
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
  const greeting = session.user.firstName ?? session.user.username;

  return (
    <section className="space-y-8">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold text-slate-900">Hallo {greeting}!</h2>
        <p className="text-sm text-slate-500">
          Erfasse deine Arbeitszeiten direkt hier. Die Werte werden in der bestehenden Datenbank gespeichert,
          einschließlich Pausen, Codes und Umsatz.
        </p>
      </header>

      <EmployeeEntriesSection
        entries={entries}
        closedMonths={closedMonths}
        shiftPlan={shiftPlan.days}
        requiresMealFlag={(validationProfile?.sachbezugVerpflegung ?? 'Nein').toLowerCase() === 'ja'}
        minPauseUnder6Minutes={validationProfile?.minPauseUnder6Minutes ?? 0}
        federalState={validationProfile?.federalState ?? null}
        createAction={createEntry}
        createInitialState={null}
        deleteAction={removeEntry}
        deleteInitialState={null}
        hiddenFields={{
          employeeId: String(employeeId),
          tillhubUserId: validationProfile?.tillhubUserId ?? '',
        }}
      />
    </section>
  );
}
