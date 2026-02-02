import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import { listDailyDayRecords } from '@/lib/data/daily-days';
import { listEmployeeBonusHistory } from '@/lib/data/employee-bonus';
import { listEmployeeOvertimeHistory } from '@/lib/data/employee-overtime-payouts';
import { getEmployeeSelfSummaryData, getEmployeeValidationInfo } from '@/lib/data/employees';
import { calculateIstHours } from '@/lib/services/time-calculations';
import { fetchTillhubStaffOverview } from '@/lib/services/tillhub';

import DateRangeFilter from './DateRangeFilter';

type SearchParams = {
  year?: string;
  month?: string;
  from?: string;
  to?: string;
  date?: string;
};

type ParsedRecord = {
  isoDate: string;
  date: Date;
  year: number;
  month: number;
  revenue: number;
  istHours: number;
  sollHours: number;
  overtimeDelta: number;
  pauseMinutes: number;
  mealCount: number;
  code: string;
  sickHours: number;
  childSickHours: number;
  shortWorkHours: number;
  vacationHours: number;
  holidayHours: number;
  forcedOverflow: number;
};

type MonthStats = {
  year: number;
  month: number;
  revenue: number;
  istHours: number;
  sollHours: number;
  overtimeDelta: number;
  days: number;
  daysWithRevenue: number;
  daysWithHours: number;
};

type CodeStats = {
  code: string;
  days: number;
  revenue: number;
  istHours: number;
  sollHours: number;
};

const MONTH_NAMES = [
  'Januar',
  'Februar',
  'Maerz',
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

const CODE_LABELS: Record<string, string> = {
  RA: 'Regulaer',
  U: 'Urlaub',
  UH: 'Urlaub halb',
  K: 'Krank',
  KK: 'Kind krank',
  KR: 'Krank Rest',
  KKR: 'Kind krank Rest',
  KU: 'Kurzarbeit',
  FT: 'Feiertag',
  UEB: 'Ueberstundenabbau',
  UE: 'Ueberstundenabbau',
  UEBERSTUNDEN: 'Ueberstundenabbau',
};

const DECIMAL_FACTOR = 100;

function parseYear(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMonth(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 1 || parsed > 12) return null;
  return parsed;
}

function parseIsoDate(value: string | undefined): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function formatIsoDateLabel(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('de-DE');
}

function formatRangeLabel(startIso: string, endIso: string): string {
  if (startIso === endIso) {
    return formatIsoDateLabel(startIso);
  }
  return `${formatIsoDateLabel(startIso)} - ${formatIsoDateLabel(endIso)}`;
}

function buildMonthRange(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(year, month, 0);
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(
    endDate.getDate()
  ).padStart(2, '0')}`;
  return { start, end };
}

function roundTwo(value: number): number {
  return Math.round(value * DECIMAL_FACTOR) / DECIMAL_FACTOR;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatHours(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatMinutes(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('de-DE').format(value);
}

function monthLabel(month: number): string {
  return MONTH_NAMES[Math.max(0, Math.min(11, month - 1))] ?? '';
}

function normalizeCode(raw: string | null | undefined): string {
  const normalized = (raw ?? '').trim().toUpperCase();
  return normalized || 'RA';
}

function flattenTillhubResults(payload: unknown): unknown[] {
  if (!payload) return [];
  if (Array.isArray(payload)) {
    return payload.flatMap((entry) => flattenTillhubResults(entry));
  }
  if (typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    const buckets: unknown[] = [];
    if (Array.isArray(obj.results)) buckets.push(...obj.results);
    if (Array.isArray(obj.data)) buckets.push(...obj.data);
    if (Array.isArray(obj.values)) buckets.push(...obj.values);
    if (buckets.length > 0) {
      return buckets.flatMap((entry) => flattenTillhubResults(entry));
    }
  }
  return [payload];
}

function findFirstNumber(entry: Record<string, unknown>, candidates: string[]): number | null {
  for (const key of candidates) {
    const value = entry[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function extractTillhubGross(entry: unknown, staffId: string): number | null {
  if (!entry || typeof entry !== 'object') return null;
  const obj = entry as Record<string, unknown>;
  const nested = (value: unknown, key: string): unknown =>
    value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;

  const candidates: Array<string | undefined> = [
    obj.staff_id as string | undefined,
    obj.staffId as string | undefined,
    obj.staff_uuid as string | undefined,
    nested(obj.staff, 'id') as string | undefined,
    nested(obj.staff, 'uuid') as string | undefined,
    obj.user_id as string | undefined,
    obj.userId as string | undefined,
    nested(obj.user, 'id') as string | undefined,
    obj.id as string | undefined,
    obj.staff_number as string | undefined,
  ].filter(Boolean);

  const normalizedStaff = staffId.trim().toLowerCase();
  const matches = candidates.some((value) => String(value).trim().toLowerCase() === normalizedStaff);
  if (!matches) return null;

  return findFirstNumber(entry, [
    'amount_gross_total',
    'brutto',
    'gross',
    'gross_total',
    'total_gross',
    'revenue',
    'revenue_gross',
    'sales',
    'sales_total',
    'total',
    'amount',
    'sum',
  ]);
}

function summarizeMonths(records: ParsedRecord[]): MonthStats[] {
  const map = new Map<string, MonthStats>();
  for (const record of records) {
    const key = `${record.year}-${String(record.month).padStart(2, '0')}`;
    const entry = map.get(key) ?? {
      year: record.year,
      month: record.month,
      revenue: 0,
      istHours: 0,
      sollHours: 0,
      overtimeDelta: 0,
      days: 0,
      daysWithRevenue: 0,
      daysWithHours: 0,
    };
    entry.revenue += record.revenue;
    entry.istHours += record.istHours;
    entry.sollHours += record.sollHours;
    entry.overtimeDelta += record.overtimeDelta;
    entry.days += 1;
    if (record.revenue > 0) entry.daysWithRevenue += 1;
    if (record.istHours > 0) entry.daysWithHours += 1;
    map.set(key, entry);
  }
  return Array.from(map.values())
    .map((entry) => ({
      ...entry,
      revenue: roundTwo(entry.revenue),
      istHours: roundTwo(entry.istHours),
      sollHours: roundTwo(entry.sollHours),
      overtimeDelta: roundTwo(entry.overtimeDelta),
    }))
    .sort((a, b) => (a.year === b.year ? a.month - b.month : a.year - b.year));
}

function summarizeCodes(records: ParsedRecord[]): CodeStats[] {
  const map = new Map<string, CodeStats>();
  for (const record of records) {
    const key = record.code;
    const entry = map.get(key) ?? {
      code: key,
      days: 0,
      revenue: 0,
      istHours: 0,
      sollHours: 0,
    };
    entry.days += 1;
    entry.revenue += record.revenue;
    entry.istHours += record.istHours;
    entry.sollHours += record.sollHours;
    map.set(key, entry);
  }
  return Array.from(map.values())
    .map((entry) => ({
      ...entry,
      revenue: roundTwo(entry.revenue),
      istHours: roundTwo(entry.istHours),
      sollHours: roundTwo(entry.sollHours),
    }))
    .sort((a, b) => b.days - a.days);
}

export default async function MitarbeiterStatistikPage({ searchParams }: { searchParams?: SearchParams }) {
  const session = await getServerAuthSession();
  if (!session?.user) {
    redirect(withAppBasePath('/login?mode=employee'));
  }
  if (!session.user.employeeId) {
    redirect(withAppBasePath('/admin'));
  }

  const employeeId = session.user.employeeId;
  const tenantId = session.tenantId;
  if (!tenantId) {
    redirect(withAppBasePath('/login?mode=employee'));
  }

  const resolvedSearchParams = await searchParams;
  const preferredYear = parseYear(resolvedSearchParams?.year);
  const preferredMonth = parseMonth(resolvedSearchParams?.month);
  const preferredFrom = parseIsoDate(resolvedSearchParams?.from);
  const preferredTo = parseIsoDate(resolvedSearchParams?.to);
  const preferredDate = parseIsoDate(resolvedSearchParams?.date);

  const [records, validationInfo, summaryData, bonusHistory, overtimeHistory] = await Promise.all([
    listDailyDayRecords(employeeId),
    getEmployeeValidationInfo(tenantId, employeeId),
    getEmployeeSelfSummaryData(tenantId, employeeId),
    listEmployeeBonusHistory(employeeId, { limit: 240 }),
    listEmployeeOvertimeHistory(employeeId, { limit: 240 }),
  ]);

  const parsedRecords: ParsedRecord[] = records
    .map((record) => {
      const date = new Date(`${record.day_date}T00:00:00`);
      if (Number.isNaN(date.getTime())) {
        return null;
      }
      const { netHours, effectivePauseHours } = calculateIstHours(
        record.kommt1,
        record.geht1,
        record.kommt2,
        record.geht2,
        record.pause
      );
      const code = normalizeCode(record.code);
      return {
        isoDate: record.day_date,
        date,
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        revenue: Number(record.brutto ?? 0),
        istHours: Number(netHours ?? 0),
        sollHours: Number(record.plan_hours ?? 0),
        overtimeDelta: Number(record.overtime_delta ?? 0),
        pauseMinutes: Number(effectivePauseHours ?? 0) * 60,
        mealCount: (record.mittag ?? '').toString().trim().toLowerCase() === 'ja' ? 1 : 0,
        code,
        sickHours: Number(record.sick_hours ?? 0),
        childSickHours: Number(record.child_sick_hours ?? 0),
        shortWorkHours: Number(record.short_work_hours ?? 0),
        vacationHours: Number(record.vacation_hours ?? 0),
        holidayHours: Number(record.holiday_hours ?? 0),
        forcedOverflow: Number(record.forced_overflow ?? 0),
      };
    })
    .filter((record): record is ParsedRecord => Boolean(record));

  const recordsByYear = new Map<number, ParsedRecord[]>();
  for (const record of parsedRecords) {
    const yearRecords = recordsByYear.get(record.year) ?? [];
    yearRecords.push(record);
    recordsByYear.set(record.year, yearRecords);
  }

  const earliestIso = parsedRecords.reduce<string | null>((acc, record) => {
    if (!acc) return record.isoDate;
    return record.isoDate < acc ? record.isoDate : acc;
  }, null);
  const latestIso = parsedRecords.reduce<string | null>((acc, record) => {
    if (!acc) return record.isoDate;
    return record.isoDate > acc ? record.isoDate : acc;
  }, null);

  const yearOptions = Array.from(recordsByYear.keys()).sort((a, b) => b - a);
  if (!yearOptions.length) {
    return (
      <section className="space-y-4">
        <header>
          <h2 className="text-xl font-semibold text-slate-900">Statistik</h2>
          <p className="text-sm text-slate-500">
            Es sind noch keine Tagesdaten erfasst. Sobald Eintraege vorhanden sind, erscheinen hier alle Kennzahlen.
          </p>
        </header>
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-8 text-sm text-slate-500">
          Lege zuerst eine Tageserfassung an. Danach werden Umsatz, Stunden, Abwesenheiten und Bonus automatisch ausgewertet.
        </div>
      </section>
    );
  }
  const selectedYear = preferredYear && yearOptions.includes(preferredYear) ? preferredYear : yearOptions[0];
  const monthYear = preferredYear && yearOptions.includes(preferredYear) ? preferredYear : selectedYear;
  const monthFilterRange = preferredMonth && monthYear ? buildMonthRange(monthYear, preferredMonth) : null;

  const safeEarliestIso = earliestIso ?? `${selectedYear}-01-01`;
  const safeLatestIso = latestIso ?? `${selectedYear}-12-31`;

  let filterStart = selectedYear ? `${selectedYear}-01-01` : safeEarliestIso;
  let filterEnd = selectedYear ? `${selectedYear}-12-31` : safeLatestIso;
  let filteredRecords = selectedYear ? recordsByYear.get(selectedYear) ?? [] : parsedRecords;

  if (preferredDate) {
    filterStart = preferredDate;
    filterEnd = preferredDate;
    filteredRecords = parsedRecords.filter((record) => record.isoDate === preferredDate);
  } else if (preferredFrom || preferredTo) {
    const start = preferredFrom ?? preferredTo ?? '';
    const end = preferredTo ?? preferredFrom ?? '';
    if (start && end) {
      const normalizedStart = start <= end ? start : end;
      const normalizedEnd = start <= end ? end : start;
      filterStart = normalizedStart;
      filterEnd = normalizedEnd;
      filteredRecords = parsedRecords.filter(
        (record) => record.isoDate >= normalizedStart && record.isoDate <= normalizedEnd
      );
    }
  } else if (preferredMonth && monthFilterRange) {
    filterStart = monthFilterRange.start;
    filterEnd = monthFilterRange.end;
    filteredRecords = parsedRecords.filter(
      (record) => record.year === monthYear && record.month === preferredMonth
    );
  }

  const filterLabel = formatRangeLabel(filterStart, filterEnd);

  const latestDate = parsedRecords.reduce<Date | null>((acc, record) => {
    if (!acc || record.date > acc) return record.date;
    return acc;
  }, null);

  const totals = filteredRecords.reduce(
    (acc, record) => {
      acc.revenue += record.revenue;
      acc.istHours += record.istHours;
      acc.sollHours += record.sollHours;
      acc.overtimeDelta += record.overtimeDelta;
      acc.days += 1;
      if (record.revenue > 0) acc.daysWithRevenue += 1;
      if (record.istHours > 0) acc.daysWithHours += 1;
      acc.pauseMinutes += record.pauseMinutes;
      acc.mealCount += record.mealCount;
      acc.sickHours += record.sickHours;
      acc.childSickHours += record.childSickHours;
      acc.shortWorkHours += record.shortWorkHours;
      acc.vacationHours += record.vacationHours;
      acc.holidayHours += record.holidayHours;
      acc.forcedOverflow += record.forcedOverflow;
      return acc;
    },
    {
      revenue: 0,
      istHours: 0,
      sollHours: 0,
      overtimeDelta: 0,
      days: 0,
      daysWithRevenue: 0,
      daysWithHours: 0,
      pauseMinutes: 0,
      mealCount: 0,
      sickHours: 0,
      childSickHours: 0,
      shortWorkHours: 0,
      vacationHours: 0,
      holidayHours: 0,
      forcedOverflow: 0,
    }
  );

  const monthlyRows = summarizeMonths(filteredRecords);
  const codeRows = summarizeCodes(filteredRecords);
  const showMonthYear = new Set(monthlyRows.map((row) => row.year)).size > 1;

  const averageRevenuePerDay =
    totals.daysWithRevenue > 0 ? roundTwo(totals.revenue / totals.daysWithRevenue) : 0;
  const averageRevenuePerHour =
    totals.istHours > 0 ? roundTwo(totals.revenue / totals.istHours) : 0;
  const averagePauseMinutes =
    totals.daysWithHours > 0 ? roundTwo(totals.pauseMinutes / totals.daysWithHours) : 0;
  const missingRevenueDays = filteredRecords.filter((record) => record.istHours > 0 && record.revenue <= 0).length;
  const missingHoursDays = filteredRecords.filter((record) => record.istHours <= 0 && record.sollHours > 0).length;

  const bonusPaidTotal = roundTwo(bonusHistory.reduce((acc, entry) => acc + entry.payout, 0));
  const bonusCarryTotal = roundTwo(bonusHistory.reduce((acc, entry) => acc + entry.carryOver, 0));
  const overtimePayoutTotal = roundTwo(overtimeHistory.reduce((acc, entry) => acc + entry.payoutHours, 0));

  let tillhubGross: number | null = null;
  let tillhubError: string | null = null;
  const tillhubUserId = validationInfo?.tillhubUserId ?? null;

  if (tillhubUserId) {
    try {
      const resolvedStart = filterStart ?? (selectedYear ? `${selectedYear}-01-01` : null);
      const resolvedEnd = filterEnd ?? (selectedYear ? `${selectedYear}-12-31` : null);
      const start = resolvedStart ? `${resolvedStart}T00:00:00.000Z` : null;
      const end = resolvedEnd ? `${resolvedEnd}T23:59:59.999Z` : null;
      if (!start || !end) {
        throw new Error('Tillhub Zeitraum konnte nicht bestimmt werden.');
      }
      const overview = await fetchTillhubStaffOverview({
        start,
        end,
        tenantId,
      });
      const buckets = flattenTillhubResults(overview.results ?? overview.data ?? overview);
      const grossValues = buckets
        .map((bucket) => extractTillhubGross(bucket, tillhubUserId))
        .filter((value): value is number => value !== null);
      if (grossValues.length > 0) {
        tillhubGross = roundTwo(grossValues.reduce((acc, value) => acc + value, 0));
      }
    } catch (error) {
      console.warn('[tillhub] statistik konnte nicht geladen werden', error);
      tillhubError = 'Tillhub nicht verbunden.';
    }
  }

  return (
    <section className="space-y-8">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold text-slate-900">Statistik</h2>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
          <span>Auswertung basierend auf erfassten Tagesdaten.</span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
            Zeitraum: {filterLabel}
          </span>
          {latestDate ? (
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
              Datenstand: {latestDate.toLocaleDateString('de-DE')}
            </span>
          ) : null}
        </div>
      </header>

      <DateRangeFilter
        initialStart={filterStart}
        initialEnd={filterEnd}
        minDate={safeEarliestIso}
        maxDate={safeLatestIso}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard title="Umsatz gesamt" value={formatCurrency(roundTwo(totals.revenue))} subtitle={filterLabel} />
        <MetricCard title="Ist-Stunden" value={`${formatHours(roundTwo(totals.istHours))} h`} subtitle="Netto (erfasst)" />
        <MetricCard title="Soll-Stunden" value={`${formatHours(roundTwo(totals.sollHours))} h`} subtitle="Aus Planung" />
        <MetricCard title="Ueberstunden-Delta" value={`${formatHours(roundTwo(totals.overtimeDelta))} h`} subtitle={filterLabel} />
        <MetricCard title="Umsatz pro Tag" value={formatCurrency(averageRevenuePerDay)} subtitle="Tage mit Umsatz" />
        <MetricCard title="Umsatz pro Stunde" value={formatCurrency(averageRevenuePerHour)} subtitle="Auf Basis Ist-Stunden" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <StatBlock
          title="Arbeitszeit & Pausen"
          rows={[
            { label: 'Erfasste Tage', value: formatCount(totals.days) },
            { label: 'Tage mit Umsatz', value: formatCount(totals.daysWithRevenue) },
            { label: 'Tage ohne Umsatz', value: formatCount(missingRevenueDays) },
            { label: 'Tage ohne Zeiten', value: formatCount(missingHoursDays) },
            { label: 'Durchschnittliche Pause', value: `${formatMinutes(averagePauseMinutes)} min` },
            { label: 'Verpflegung (Ja)', value: formatCount(totals.mealCount) },
          ]}
        />
        <StatBlock
          title="Abwesenheiten"
          rows={[
            { label: 'Urlaubsstunden', value: `${formatHours(roundTwo(totals.vacationHours))} h` },
            { label: 'Krankstunden', value: `${formatHours(roundTwo(totals.sickHours))} h` },
            { label: 'Kind krank', value: `${formatHours(roundTwo(totals.childSickHours))} h` },
            { label: 'Kurzarbeit', value: `${formatHours(roundTwo(totals.shortWorkHours))} h` },
            { label: 'Feiertage', value: `${formatHours(roundTwo(totals.holidayHours))} h` },
          ]}
        />
        <StatBlock
          title="Bonus & Auszahlung"
          rows={[
            { label: 'Bonus ausgezahlt', value: formatCurrency(bonusPaidTotal) },
            { label: 'Bonus uebertragen', value: formatCurrency(bonusCarryTotal) },
            { label: 'Ueberstunden-Auszahlung', value: `${formatHours(overtimePayoutTotal)} h` },
            { label: 'Jahresziel Umsatz', value: formatCurrency(Number(summaryData?.mindJahresumsatz ?? 0)) },
            { label: 'Bonus-Prozent', value: `${formatHours(Number(summaryData?.monatlicherBonusProzent ?? 0))} %` },
          ]}
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-base font-semibold text-slate-900">Monatsverlauf</h3>
          <p className="text-xs text-slate-500">Umsatz und Stunden im ausgewaehlten Zeitraum.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Monat</th>
                <th className="px-4 py-3 text-right">Umsatz</th>
                <th className="px-4 py-3 text-right">Ist</th>
                <th className="px-4 py-3 text-right">Soll</th>
                <th className="px-4 py-3 text-right">Delta</th>
                <th className="px-4 py-3 text-right">Tage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {monthlyRows.length > 0 ? (
                monthlyRows.map((row) => (
                  <tr key={`${row.year}-${row.month}`}>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {showMonthYear ? `${monthLabel(row.month)} ${row.year}` : monthLabel(row.month)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(row.revenue)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatHours(row.istHours)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatHours(row.sollHours)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatHours(row.overtimeDelta)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatCount(row.days)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={6}>
                    Keine Monatswerte fuer dieses Jahr vorhanden.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-base font-semibold text-slate-900">Statuscodes</h3>
          <p className="text-xs text-slate-500">Verteilung nach erfassten Codes.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3 text-right">Tage</th>
                <th className="px-4 py-3 text-right">Ist</th>
                <th className="px-4 py-3 text-right">Soll</th>
                <th className="px-4 py-3 text-right">Umsatz</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {codeRows.length > 0 ? (
                codeRows.map((row) => (
                  <tr key={row.code}>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {CODE_LABELS[row.code] ?? row.code}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatCount(row.days)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatHours(row.istHours)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatHours(row.sollHours)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(row.revenue)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={5}>
                    Noch keine Codes erfasst.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-base font-semibold text-slate-900">Tillhub (falls verbunden)</h3>
          <p className="text-xs text-slate-500">
            Wenn eine Tillhub-ID hinterlegt ist, wird der externe Umsatz fuer das Jahr geladen.
          </p>
        </div>
        <div className="grid gap-4 px-4 py-4 md:grid-cols-2">
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tillhub Umsatz</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">
              {tillhubGross !== null ? formatCurrency(tillhubGross) : 'Nicht verfuegbar'}
            </p>
            <p className="text-xs text-slate-500">
              {filterLabel}
              {tillhubUserId ? '' : ' · Keine Tillhub-ID hinterlegt'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Abgleich erfasst vs. Tillhub</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">
              {tillhubGross !== null
                ? formatCurrency(roundTwo(tillhubGross - totals.revenue))
                : 'Nicht verfuegbar'}
            </p>
            <p className="text-xs text-slate-500">
              Differenz (Tillhub minus erfasst)
              {tillhubError ? ` · ${tillhubError}` : ''}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function MetricCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      <p className="text-xs text-slate-500">{subtitle}</p>
    </div>
  );
}

function StatBlock({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <dl className="mt-3 space-y-2 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between text-slate-600">
            <dt>{row.label}</dt>
            <dd className="font-medium text-slate-900">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
