'use client';

import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useFormStatus } from 'react-dom';
import { Info, Printer } from 'lucide-react';

import type {
  BonusScheme,
  BonusTier,
  DailyOverviewResult,
  EmployeeAdminDetails,
  EmployeeListItem,
} from '@/lib/services/admin/employee';
import type { MonthlySummaryResult } from '@/lib/services/admin/employee-summary';
import type {
  MonthlyClosingHistoryItem,
  MonthlyClosingState,
} from '@/lib/services/admin/monthly-closing';
import type { DailyDaySummary } from '@/lib/data/daily-days';
import type { ShiftPlanDay } from '@/lib/services/shift-plan';
import { FEDERAL_STATE_OPTIONS } from '@/lib/constants/federal-states';
import { DailyOverviewTable } from './DailyOverviewTable';
import type { ActionState } from './types';
import MonthlySummaryPanel from './MonthlySummaryPanel';
import MonthlyClosingPanel from './MonthlyClosingPanel';
import AdminTimeEntriesPanel from './AdminTimeEntriesPanel';
import AdminMandatoryPausePanel from './AdminMandatoryPausePanel';
import { useActionRefresh } from './useRefreshEffect';
import type { EntryActionState } from '@/app/mitarbeiter/types';

const ROLE_OPTIONS = [1, 2, 3, 4, 5];
const YES_NO_OPTIONS = ['Nein', 'Ja'];
const normalizeYesNoValue = (value: string | null | undefined): 'Ja' | 'Nein' =>
  value === 'Ja' ? 'Ja' : 'Nein';

const deriveHasRevenueShare = (
  employee: EmployeeAdminDetails,
  scheme: BonusScheme,
  tiers: BonusTier[]
): boolean => {
  if (Number(employee.mind_jahresumsatz ?? 0) > 0) {
    return true;
  }
  if (Number(employee.monatlicher_bonus_prozent ?? 0) > 0) {
    return true;
  }
  if (scheme.schemeType === 'linear' && Number(scheme.linearPercent ?? 0) > 0) {
    return true;
  }
  if (scheme.schemeType === 'stufen' && tiers.length > 0) {
    return true;
  }
  return false;
};

type TabId = 'overview' | 'closing' | 'time' | 'mandatory' | 'management';

const BASE_TABS: Array<{ id: TabId; label: string; requiresMandatory?: boolean }> = [
  { id: 'overview', label: 'Übersicht' },
  { id: 'closing', label: 'Monatsabschluss' },
  { id: 'time', label: 'Tageserfassung' },
  { id: 'mandatory', label: 'Pflichtpausen', requiresMandatory: true },
  { id: 'management', label: 'Verwaltung' },
];

function SubmitButton({ label, formId }: { label: string; formId?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      form={formId}
      className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
    >
      {pending ? `${label}…` : label}
    </button>
  );
}

function DangerButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="inline-flex items-center gap-2 rounded-md border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
    >
      {pending ? `${label}…` : label}
    </button>
  );
}

function formatDateInput(value: string | null): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatIbanForInput(value: string | null | undefined): string {
  if (!value) return '';
  const cleaned = value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (!cleaned) return '';
  return cleaned.replace(/(.{4})/g, '$1 ').trim();
}

function formatBicForInput(value: string | null | undefined): string {
  if (!value) return '';
  return value.toUpperCase();
}

type Props = {
  employees: EmployeeListItem[];
  selectedEmployeeId: number;
  employee: EmployeeAdminDetails;
  dailyOverview: DailyOverviewResult;
  bonusScheme: BonusScheme;
  bonusTiers: BonusTier[];
  monthlySummary: MonthlySummaryResult;
  monthlyClosing: MonthlyClosingState;
  monthlyClosingHistory: MonthlyClosingHistoryItem[];
  timeEntries: DailyDaySummary[];
  closedMonths: string[];
  shiftPlan: Record<string, ShiftPlanDay>;
  requiresMealFlag: boolean;
  minPauseUnder6Minutes: number;
  mandatoryPauseEnabled: boolean;
  weekdayPauses: { weekday: number; minutes: number }[];
  profileAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  profileInitialState: ActionState;
  deleteAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  deleteInitialState: ActionState;
  settingsAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  settingsInitialState: ActionState;
  bonusAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  bonusInitialState: ActionState;
  tillhubAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  tillhubInitialState: ActionState;
  createTimeEntryAction: (prev: EntryActionState, formData: FormData) => Promise<EntryActionState>;
  createTimeEntryInitialState: EntryActionState;
  deleteTimeEntryAction: (prev: EntryActionState, formData: FormData) => Promise<EntryActionState>;
  deleteTimeEntryInitialState: EntryActionState;
  mandatoryPauseAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  mandatoryPauseInitialState: ActionState;
  summaryPreferencesAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  summaryPreferencesInitialState: ActionState;
  bonusPayoutAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  bonusPayoutInitialState: ActionState;
  overtimePayoutAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  overtimePayoutInitialState: ActionState;
  closeMonthlyClosingAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  closeMonthlyClosingInitialState: ActionState;
  reopenMonthlyClosingAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  reopenMonthlyClosingInitialState: ActionState;
};

export default function AdminEmployeeDetailClient({
  employees,
  selectedEmployeeId,
  employee,
  dailyOverview,
  bonusScheme,
  bonusTiers,
  monthlySummary,
  monthlyClosing,
  monthlyClosingHistory,
  timeEntries,
  closedMonths,
  shiftPlan,
  requiresMealFlag,
  minPauseUnder6Minutes,
  mandatoryPauseEnabled,
  weekdayPauses,
  profileAction,
  profileInitialState,
  deleteAction,
  deleteInitialState,
  settingsAction,
  settingsInitialState,
  bonusAction,
  bonusInitialState,
  tillhubAction,
  tillhubInitialState,
  createTimeEntryAction,
  createTimeEntryInitialState,
  deleteTimeEntryAction,
  deleteTimeEntryInitialState,
  mandatoryPauseAction,
  mandatoryPauseInitialState,
  summaryPreferencesAction,
  summaryPreferencesInitialState,
  bonusPayoutAction,
  bonusPayoutInitialState,
  overtimePayoutAction,
  overtimePayoutInitialState,
  closeMonthlyClosingAction,
  closeMonthlyClosingInitialState,
  reopenMonthlyClosingAction,
  reopenMonthlyClosingInitialState,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const [profileState, profileFormAction] = useActionState(profileAction, profileInitialState);
  const [deleteState, deleteFormAction] = useActionState(deleteAction, deleteInitialState);
  const [settingsState, settingsFormAction] = useActionState(settingsAction, settingsInitialState);
  const [bonusState, bonusFormAction] = useActionState(bonusAction, bonusInitialState);
  const [tillhubState, tillhubFormAction] = useActionState(tillhubAction, tillhubInitialState);
  const [localMandatoryPauseEnabled, setLocalMandatoryPauseEnabled] = useState(mandatoryPauseEnabled);
  const [hourLimitsEnabled, setHourLimitsEnabled] = useState(() =>
    (employee.max_minusstunden ?? null) !== null || (employee.max_ueberstunden ?? null) !== null
  );
  const [hasRevenueShare, setHasRevenueShare] = useState(() =>
    deriveHasRevenueShare(employee, bonusScheme, bonusTiers)
  );
  const [mindJahresumsatzValue, setMindJahresumsatzValue] = useState(() =>
    String(employee.mind_jahresumsatz ?? 0)
  );
  const [sachbezuegeValue, setSachbezuegeValue] = useState<'Ja' | 'Nein'>(() =>
    normalizeYesNoValue(employee.sachbezuege ?? 'Nein')
  );
  const [sachbezuegeAmount, setSachbezuegeAmount] = useState<string>(
    () => String(employee.sachbezuege_amount ?? 0)
  );
  const [localShowInCalendar, setLocalShowInCalendar] = useState(employee.show_in_calendar);
  const [closeClosingState, closeClosingFormAction] = useActionState(
    closeMonthlyClosingAction,
    closeMonthlyClosingInitialState
  );
  const [reopenClosingState, reopenClosingFormAction] = useActionState(
    reopenMonthlyClosingAction,
    reopenMonthlyClosingInitialState
  );
  const stammdatenRef = useRef<HTMLDivElement>(null);
  const handlePrintStammdaten = useCallback(() => {
    if (typeof window === 'undefined') return;
    const target = stammdatenRef.current;
    if (!target) {
      window.print();
      return;
    }
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) return;
    printWindow.document.write(`<!DOCTYPE html><html><head><title>Stammdaten</title><style>body{font-family:system-ui,Segoe UI,Roboto,sans-serif;margin:24px;background:#f8fafc;} .card{max-width:900px;margin:0 auto;padding:24px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 5px 20px rgba(15,23,42,0.08);} h2{font-size:20px;margin-bottom:12px;color:#0f172a;} .meta{font-size:13px;color:#475569;margin-bottom:16px;} table{width:100%;border-collapse:collapse;} td{padding:6px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top;font-size:13px;} strong{color:#0f172a;} </style></head><body><div class="card"><h2>Stammdaten</h2><div class="meta">Stand: ${new Date().toLocaleDateString('de-DE')}</div>`);
    printWindow.document.write(target.outerHTML);
    printWindow.document.write('</div></body></html>');
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  }, [stammdatenRef]);

  const tabs = useMemo(
    () => BASE_TABS.filter((tab) => !tab.requiresMandatory || mandatoryPauseEnabled),
    [mandatoryPauseEnabled]
  );

  const countryLabel = useMemo(() => {
    const code = employee.federal_state?.split('-')[0]?.toUpperCase();
    if (code === 'AT') return 'Österreich';
    if (code === 'CH') return 'Schweiz';
    return 'Deutschland';
  }, [employee.federal_state]);

  useEffect(() => {
    setLocalMandatoryPauseEnabled(mandatoryPauseEnabled);
  }, [mandatoryPauseEnabled]);

  useEffect(() => {
    setLocalShowInCalendar(employee.show_in_calendar);
    setSachbezuegeValue(normalizeYesNoValue(employee.sachbezuege ?? 'Nein'));
    setSachbezuegeAmount(String(employee.sachbezuege_amount ?? 0));
    setHasRevenueShare(deriveHasRevenueShare(employee, bonusScheme, bonusTiers));
    setMindJahresumsatzValue(String(employee.mind_jahresumsatz ?? 0));
    setHourLimitsEnabled(
      (employee.max_minusstunden ?? null) !== null || (employee.max_ueberstunden ?? null) !== null
    );
  }, [employee, bonusScheme, bonusTiers]);

  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const param = searchParams.get('tab');
    if (param && tabs.some((tab) => tab.id === param)) {
      return param as TabId;
    }
    return tabs[0]?.id ?? 'overview';
  });

  const updateTabUrl = useCallback((tab: TabId) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', url.toString());
  }, []);

  const handleShowInCalendarChange = useCallback((checked: boolean) => {
    setLocalShowInCalendar(checked);
  }, []);

  useEffect(() => {
    const currentParam = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('tab')
      : searchParams.get('tab');

    if (currentParam && tabs.some((tab) => tab.id === currentParam)) {
      if (currentParam !== activeTab) {
        setActiveTab(currentParam as TabId);
      }
      return;
    }

    if (!tabs.some((tab) => tab.id === activeTab)) {
      const fallback = tabs[0]?.id ?? 'overview';
      if (fallback !== activeTab) {
        setActiveTab(fallback);
        updateTabUrl(fallback);
      }
    }
  }, [searchParams, tabs, activeTab, updateTabUrl]);

  const handleTabChange = (tab: TabId) => {
    if (!tabs.some((item) => item.id === tab)) return;
    if (tab === activeTab) return;
    setActiveTab(tab);
    updateTabUrl(tab);
  };

  const [schemeType, setSchemeType] = useState<BonusSchemeType>(bonusScheme.schemeType);
  const [linearPercent, setLinearPercent] = useState<string>(bonusScheme.linearPercent.toString());
  const [tierText, setTierText] = useState<string>(
    bonusTiers.map((tier) => `${tier.threshold};${tier.percent}`).join('\n')
  );

  useActionRefresh(settingsState, () => {
    startTransition(() => {
      router.refresh();
    });
  });

  const currentYearParam = searchParams.get('year');
  const currentMonthParam = searchParams.get('month');

  const yearOptions = dailyOverview.years;
  const monthOptions = dailyOverview.months;

  const selectedYear = Number(currentYearParam ?? dailyOverview.selectedYear);
  const selectedMonth = Number(currentMonthParam ?? dailyOverview.selectedMonth);

  const handleYearChange = (year: string) => {
    const params = new URLSearchParams(searchParams?.toString());
    params.set('year', year);
    if (!params.has('month')) {
      params.set('month', String(dailyOverview.selectedMonth));
    }
    router.replace(`/admin/mitarbeitende/${selectedEmployeeId}?${params.toString()}`);
  };

  const handleMonthChange = (month: string) => {
    const params = new URLSearchParams(searchParams?.toString());
    params.set('month', month);
    if (!params.has('year')) {
      params.set('year', String(dailyOverview.selectedYear));
    }
    router.replace(`/admin/mitarbeitende/${selectedEmployeeId}?${params.toString()}`);
  };

  return (
    <section className="space-y-8">
      <div className="sticky top-[130px] z-30 space-y-3 border-b border-slate-200 bg-slate-100/95 px-1 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="employee" className="text-sm font-medium text-slate-700">
            Mitarbeiter auswählen
          </label>
          <select
            id="employee"
            name="employee"
            value={selectedEmployeeId}
            onChange={(event) => {
              router.replace(`/admin/mitarbeitende/${event.target.value}`);
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900"
            style={{ color: '#0f172a' }}
          >
            {employees.map((option) => (
              <option key={option.id} value={option.id} style={{ color: '#0f172a' }}>
                {option.displayName}{option.isActive ? '' : ' (inaktiv)'}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white/90 px-3 py-2 text-sm shadow-sm">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={`rounded-md px-3 py-1 font-medium transition ${
                  isActive
                    ? 'bg-brand text-white shadow'
                    : 'bg-white text-slate-600 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'overview' ? (
        <>
      <section className="space-y-4">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              {employee.first_name} {employee.last_name}
            </h1>
            <p className="text-sm text-slate-500">Personalnummer: {employee.personnel_number ?? '—'}</p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm text-slate-600">
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              Eintritt: {new Date(`${employee.entry_date}T00:00:00`).toLocaleDateString('de-DE')}
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              Rolle: {employee.role_id === 2 ? 'Admin' : 'Mitarbeiter'}
            </div>
            <div
              className={`rounded-md border px-3 py-2 text-xs font-semibold ${
                employee.isActive
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-slate-300 bg-slate-200 text-slate-700'
              }`}
            >
              Status: {employee.isActive ? 'Aktiv' : 'Deaktiviert'}
            </div>
            <div
              className={`rounded-md border px-3 py-2 text-xs font-semibold ${
                localShowInCalendar
                  ? 'border-brand/30 bg-brand/10 text-brand'
                  : 'border-slate-300 bg-slate-200 text-slate-700'
              }`}
            >
              Kalender: {localShowInCalendar ? 'Sichtbar' : 'Ausgeblendet'}
            </div>
          </div>
        </header>

        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Tagesübersicht</h2>
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <div className="flex flex-wrap gap-3 text-xs text-slate-600">
                <span className="rounded-md border border-slate-200 bg-white px-3 py-1">IST gesamt: {dailyOverview.totals.istHours.toFixed(2).replace('.', ',')} h</span>
                <span className="rounded-md border border-slate-200 bg-white px-3 py-1">SOLL gesamt: {dailyOverview.totals.sollHours.toFixed(2).replace('.', ',')} h</span>
                <span className="rounded-md border border-slate-200 bg-white px-3 py-1">Überstunden Δ: {dailyOverview.totals.overtimeDelta.toFixed(2).replace('.', ',')} h</span>
              </div>
              <label className="flex items-center gap-2 text-slate-700">
                <span>Jahr</span>
                <select
                  value={selectedYear}
                  onChange={(event) => handleYearChange(event.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-1"
                >
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-slate-700">
                <span>Monat</span>
                <select
                  value={selectedMonth}
                  onChange={(event) => handleMonthChange(event.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-1"
                >
                  {monthOptions.map((month) => (
                    <option key={month} value={month}>
                      {month.toString().padStart(2, '0')}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4">
              <DailyOverviewTable entries={dailyOverview.entries} showMealColumn={requiresMealFlag} />
            </div>
          </div>
        </div>
      </section>

      <MonthlySummaryPanel
        employeeId={selectedEmployeeId}
        summary={monthlySummary}
        preferencesAction={summaryPreferencesAction}
        preferencesInitialState={summaryPreferencesInitialState}
        bonusAction={bonusPayoutAction}
        bonusInitialState={bonusPayoutInitialState}
        overtimeAction={overtimePayoutAction}
        overtimeInitialState={overtimePayoutInitialState}
      />
        </>
      ) : null}
      {activeTab === 'closing' ? (
        <MonthlyClosingPanel
          employeeId={selectedEmployeeId}
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          closing={monthlyClosing}
          history={monthlyClosingHistory}
          closeAction={closeClosingFormAction}
          closeState={closeClosingState}
          reopenAction={reopenClosingFormAction}
          reopenState={reopenClosingState}
        />
      ) : null}
      {activeTab === 'time' ? (
        <AdminTimeEntriesPanel
          entries={timeEntries}
          closedMonths={closedMonths}
          requiresMealFlag={requiresMealFlag}
        minPauseUnder6Minutes={minPauseUnder6Minutes}
        shiftPlan={shiftPlan}
        federalState={employee.federal_state ?? null}
        employeeId={selectedEmployeeId}
        tillhubUserId={employee.tillhub_user_id}
        createAction={createTimeEntryAction}
        createInitialState={createTimeEntryInitialState}
        deleteAction={deleteTimeEntryAction}
        deleteInitialState={deleteTimeEntryInitialState}
      />
      ) : null}
      {activeTab === 'mandatory' && mandatoryPauseEnabled ? (
        localMandatoryPauseEnabled ? (
          <AdminMandatoryPausePanel
            employeeId={selectedEmployeeId}
            schedule={weekdayPauses}
            action={mandatoryPauseAction}
            initialState={mandatoryPauseInitialState}
          />
        ) : (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-700">
            <p className="font-medium">Pflichtpause wird bei Speichern deaktiviert</p>
            <p className="mt-1 text-sm">
              Damit die Pflichtpausen aus dem Reiter entfernt werden, speichere die Einstellung unter „Verwaltung“.
            </p>
          </section>
        )
      ) : null}
      {activeTab === 'management' ? (
        <>
      <section className="grid gap-6 lg:grid-cols-2">
        <div ref={stammdatenRef} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Stammdaten aktualisieren</h2>
          <p className="text-sm text-slate-600">
            Vorname, Nachname, E-Mail, Telefon, Adresse, Bundesland und Geburtsdatum werden zentral im Tenant-Dashboard gepflegt.
          </p>
          {profileState?.message ? (
            <div
              className={`rounded-md border px-3 py-2 text-sm ${
                profileState.status === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {profileState.message}
            </div>
          ) : null}
          <form id="profile-form" action={profileFormAction} className="space-y-4">
            <input type="hidden" name="employeeId" value={selectedEmployeeId} />
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Vorname</span>
                <input
                  name="first_name"
                  defaultValue={employee.first_name}
                  className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500"
                  disabled
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Nachname</span>
                <input
                  name="last_name"
                  defaultValue={employee.last_name}
                  className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500"
                  disabled
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Straße</span>
                <input
                  name="street"
                  defaultValue={employee.street ?? ''}
                  className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500"
                  disabled
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>PLZ</span>
                <input
                  name="zip_code"
                  defaultValue={employee.zip_code ?? ''}
                  className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500"
                  disabled
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Ort</span>
                <input
                  name="city"
                  defaultValue={employee.city ?? ''}
                  className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500"
                  disabled
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Land</span>
                <input
                  name="country_display"
                  value={countryLabel}
                  className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500"
                  disabled
                  readOnly
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Bundesland (Feiertage)</span>
                <select
                  name="federal_state"
                  defaultValue={employee.federal_state ?? ''}
                  className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500"
                  disabled
                >
                  <option value="">Nur bundesweite Feiertage</option>
                  {FEDERAL_STATE_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Geburtsdatum</span>
                <input
                  name="birth_date"
                  type="date"
                  defaultValue={formatDateInput(employee.birth_date)}
                  className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500"
                  disabled
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Telefon</span>
                <input
                  name="phone"
                  defaultValue={employee.phone ?? ''}
                  className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500"
                  disabled
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>E-Mail</span>
                <input
                  name="email"
                  type="email"
                  defaultValue={employee.email ?? ''}
                  className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500"
                  disabled
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Nationalität</span>
                <input
                  name="nationality"
                  defaultValue={employee.nationality ?? ''}
                  className="rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Familienstand</span>
                <input
                  name="marital_status"
                  defaultValue={employee.marital_status ?? ''}
                  className="rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Steuerklasse</span>
                <input
                  name="tax_class"
                  defaultValue={employee.tax_class ?? ''}
                  className="rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Kinderfreibetrag (KfB)</span>
                <input
                  name="kinderfreibetrag"
                  type="number"
                  step="0.5"
                  min="0"
                  defaultValue={employee.kinderfreibetrag ?? 0}
                  className="rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Steuer-ID</span>
                <input
                  name="steuer_id"
                  inputMode="numeric"
                  pattern="[0-9]{11}"
                  title="11-stellige Steuer-ID eingeben"
                  defaultValue={employee.steuer_id ?? ''}
                  className="rounded-md border border-slate-300 px-3 py-2 tracking-wider"
                  placeholder="12 345 678 901"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Sozialversicherungsnummer</span>
                <input
                  name="social_security_number"
                  defaultValue={employee.social_security_number ?? ''}
                  className="rounded-md border border-slate-300 px-3 py-2 tracking-wide"
                  placeholder="12 345678 A 123"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Krankenkasse</span>
                <input
                  name="health_insurance"
                  defaultValue={employee.health_insurance ?? ''}
                  className="rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Versichertennummer</span>
                <input
                  name="health_insurance_number"
                  defaultValue={employee.health_insurance_number ?? ''}
                  className="rounded-md border border-slate-300 px-3 py-2 tracking-wide"
                  placeholder="123456789"
                />
              </label>
              <div className="md:col-span-2 rounded-md border border-slate-200 bg-white/80 p-4">
                <p className="text-sm font-semibold text-slate-800">Bankverbindung</p>
                <p className="mt-1 text-xs text-slate-500">
                  IBAN bitte im Format <span className="font-mono">DE12 3456 7890 1234 5678 90</span> eingeben.
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>IBAN</span>
                    <input
                      name="iban"
                      inputMode="text"
                      autoCapitalize="characters"
                      pattern="[A-Z0-9 ]{5,34}"
                      title="Bitte eine gültige IBAN (Großbuchstaben & Ziffern) eingeben."
                      defaultValue={formatIbanForInput(employee.iban ?? null)}
                      placeholder="DE00 0000 0000 0000 0000 00"
                      className="rounded-md border border-slate-300 px-3 py-2 tracking-wider"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>BIC</span>
                    <input
                      name="bic"
                      inputMode="text"
                      autoCapitalize="characters"
                      pattern="[A-Z0-9]{8}([A-Z0-9]{3})?"
                      title="Bitte eine gültige BIC (8 oder 11 Zeichen) eingeben."
                      defaultValue={formatBicForInput(employee.bic ?? null)}
                      placeholder="BANKDEFFXXX"
                      className="rounded-md border border-slate-300 px-3 py-2 tracking-wider"
                    />
                  </label>
                </div>
              </div>
              <div className="md:col-span-2 rounded-md border border-slate-200 bg-white/80 p-4">
                <p className="text-sm font-semibold text-slate-800">Notfallkontakt</p>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>Name</span>
                    <input
                      name="emergency_contact_name"
                      defaultValue={employee.emergency_contact_name ?? ''}
                      className="rounded-md border border-slate-300 px-3 py-2"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>Telefonnummer</span>
                    <input
                      name="emergency_contact_phone"
                      type="tel"
                      defaultValue={employee.emergency_contact_phone ?? ''}
                      className="rounded-md border border-slate-300 px-3 py-2"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>Beziehung</span>
                    <input
                      name="emergency_contact_relation"
                      defaultValue={employee.emergency_contact_relation ?? ''}
                      className="rounded-md border border-slate-300 px-3 py-2"
                    />
                  </label>
                </div>
              </div>
              <div className="md:col-span-2 rounded-md border border-slate-200 bg-white/80 p-4">
                <p className="text-sm font-semibold text-slate-800">Vertragsdaten</p>
                <label className="mt-4 flex flex-col gap-1 text-sm text-slate-700">
                  <span>Tarifgruppe/Jobtitel</span>
                  <input
                    name="tarif_group"
                    defaultValue={employee.tarif_group ?? ''}
                    className="rounded-md border border-slate-300 px-3 py-2"
                  />
                </label>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>Eintrittsdatum</span>
                    <input
                      name="entry_date"
                      type="date"
                      defaultValue={formatDateInput(employee.entry_date)}
                      className="rounded-md border border-slate-300 px-3 py-2"
                      required
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>Einstellungsart</span>
                    <select
                      name="employment_type"
                      defaultValue={employee.employment_type ?? 'befristet'}
                      className="rounded-md border border-slate-300 bg-white px-3 py-2"
                    >
                      <option value="befristet">Befristet</option>
                      <option value="unbefristet">Unbefristet</option>
                    </select>
                  </label>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>Arbeitszeitmodell</span>
                    <select
                      name="work_time_model"
                      defaultValue={employee.work_time_model ?? 'vollzeit'}
                      className="rounded-md border border-slate-300 bg-white px-3 py-2"
                    >
                      <option value="vollzeit">Vollzeit</option>
                      <option value="teilzeit">Teilzeit</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span className="flex items-center gap-2">
                      Probezeit (Monate)
                      <span className="group relative inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-[11px] font-semibold text-slate-500">
                        i
                        <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-72 -translate-x-1/2 rounded-md border border-slate-300 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-lg group-hover:block">
                          Die Probezeit für ein Arbeitsverhältnis darf nach dem Gesetz maximal sechs Monate dauern. Unter bestimmten Bedingungen kann sie kürzer sein; für Auszubildende gelten 1-4 Monate.
                        </span>
                      </span>
                    </span>
                    <select
                      name="probation_months"
                      defaultValue={employee.probation_months?.toString() ?? '0'}
                      className="rounded-md border border-slate-300 bg-white px-3 py-2"
                    >
                      <option value="0">Keine</option>
                      {[1, 2, 3, 4, 5, 6].map((value) => (
                        <option key={value} value={value.toString()}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>Std/Woche</span>
                    <input
                      name="weekly_hours"
                      type="number"
                      step="0.5"
                      defaultValue={employee.weekly_hours ?? ''}
                      className="rounded-md border border-slate-300 px-3 py-2"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span className="flex items-center gap-2">
                      Vergütung (€)
                      <span className="group relative inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-[11px] font-semibold text-slate-500">
                        i
                        <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-64 -translate-x-1/2 rounded-md border border-slate-300 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-lg group-hover:block">
                          Monatslohn oder Stundenlohn eintragen – Grundlage für Vergütung und Auswertungen.
                        </span>
                      </span>
                    </span>
                    <input
                      name="hourly_wage"
                      type="number"
                      step="0.01"
                      defaultValue={employee.hourly_wage ?? ''}
                      className="rounded-md border border-slate-300 px-3 py-2"
                    />
                  </label>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>Urlaubstage (aktuell)</span>
                    <input
                      name="vacation_days"
                      type="number"
                      min="0"
                      defaultValue={employee.vacation_days}
                      className="rounded-md border border-slate-300 px-3 py-2"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>Urlaubstage (Gesamt)</span>
                    <input
                      name="vacation_days_total"
                      type="number"
                      min="0"
                      defaultValue={employee.vacation_days_total}
                      className="rounded-md border border-slate-300 px-3 py-2"
                    />
                  </label>
                </div>
                <label className="mt-4 flex flex-col gap-1 text-sm text-slate-700">
                  <span>Resturlaub Vorjahr</span>
                  <input
                    name="vacation_days_last_year"
                    type="number"
                    min="0"
                    defaultValue={employee.vacation_days_last_year}
                    className="rounded-md border border-slate-300 px-3 py-2"
                  />
                </label>
                <div className="mt-4 flex flex-wrap gap-3">
                  <SubmitButton label="Stammdaten speichern" />
                </div>
              </div>
            </div>
          </form>
          <div className="mt-4 flex items-center justify-between gap-3">
            <form action={deleteFormAction} className="inline-flex flex-col gap-2">
              <input type="hidden" name="employeeId" value={selectedEmployeeId} />
              <DangerButton label="Löschen" />
              {deleteState?.message ? (
                <p className="text-sm text-red-600">{deleteState.message}</p>
              ) : null}
            </form>
            <button
              type="button"
              onClick={handlePrintStammdaten}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
              aria-label="Stammdaten drucken"
            >
              <Printer className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Einstellungen & Limits</h2>
          <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="hidden" name="showInCalendar" value="0" form="profile-form" />
              <input
                type="checkbox"
                name="showInCalendar"
                value="1"
                checked={localShowInCalendar}
                onChange={(event) => handleShowInCalendarChange(event.target.checked)}
                className="rounded border-slate-300 text-brand focus:ring-brand"
                form="profile-form"
              />
              <span className="flex items-center gap-1">
                Im Kalender anzeigen
                <span className="group relative inline-flex">
                  <Info aria-hidden="true" className="h-4 w-4 text-slate-400" />
                  <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-60 -translate-x-1/2 rounded-md border border-slate-300 bg-slate-900/90 px-3 py-2 text-xs text-white shadow-lg group-hover:block">
                    Zeigt den Namen im Kalender an.
                  </span>
                </span>
              </span>
            </label>
          </section>
          <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-800">Zugang</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Benutzername</span>
                <input
                  name="username"
                  defaultValue={employee.username}
                  className="rounded-md border border-slate-300 px-3 py-2"
                  required
                  form="profile-form"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Neues Passwort (optional)</span>
                <input
                  name="new_password"
                  type="password"
                  placeholder="Leer lassen, um Passwort beizubehalten"
                  className="rounded-md border border-slate-300 px-3 py-2"
                  form="profile-form"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Rolle</span>
                <select
                  name="role_id"
                  defaultValue={employee.role_id}
                  className="rounded-md border border-slate-300 px-3 py-2"
                  form="profile-form"
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span className="flex items-center gap-2">
                  Buchungs-PIN *
                  <span className="group relative inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-[10px] font-semibold text-slate-500">
                    i
                    <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-56 -translate-x-1/2 rounded-md border border-slate-300 bg-slate-900/90 px-3 py-2 text-xs text-white shadow-lg group-hover:block">
                      Vierstellige PIN für Buchungen im Kalender erforderlich.
                    </span>
                  </span>
                </span>
                <input
                  name="booking_pin"
                  defaultValue={employee.booking_pin}
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  minLength={4}
                  maxLength={4}
                  className="rounded-md border border-slate-300 px-3 py-2"
                  required
                  title="Bitte geben Sie eine vierstellige PIN ein."
                  form="profile-form"
                />
              </label>
            </div>

          </section>
          {settingsState?.message ? (
            <div
              className={`rounded-md border px-3 py-2 text-sm ${
                settingsState.status === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {settingsState.message}
            </div>
          ) : null}
          <form action={settingsFormAction} className="space-y-4">
            <input type="hidden" name="employeeId" value={selectedEmployeeId} />
            <input
              type="hidden"
              name="monatlicherBonusProzent"
              value={employee.monatlicher_bonus_prozent ?? 0}
            />
            <div className="grid gap-4">
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span className="flex items-center gap-2">
                  Sollen Limits für Mehr- oder Minderstunden gesetzt werden?
                  <span className="group relative inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-[11px] font-semibold text-slate-500">
                    i
                    <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-72 -translate-x-1/2 rounded-md border border-slate-300 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-lg group-hover:block">
                      Wenn nicht aktiviert, kann der Mitarbeiter unbegrenzt Minus- oder Plustunden ansammeln.
                    </span>
                  </span>
                </span>
                <select
                  value={hourLimitsEnabled ? 'Ja' : 'Nein'}
                  onChange={(event) => setHourLimitsEnabled(event.target.value === 'Ja')}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900"
                >
                  {YES_NO_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              {hourLimitsEnabled ? (
                <>
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span className="flex items-center gap-2">
                      Max. Minusstunden (h)
                      <span className="group relative inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-[11px] font-semibold text-slate-500">
                        i
                        <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-64 -translate-x-1/2 rounded-md border border-slate-300 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-lg group-hover:block">
                          Obergrenze an Minusstunden, ab der für diesen Mitarbeitenden aktiv nachjustiert werden soll.
                        </span>
                      </span>
                    </span>
                    <input
                      name="maxMinusHours"
                      type="number"
                      step="0.5"
                      defaultValue={employee.max_minusstunden ?? ''}
                      className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span className="flex items-center gap-2">
                      Max. Überstunden (h)
                      <span className="group relative inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-[11px] font-semibold text-slate-500">
                        i
                        <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-64 -translate-x-1/2 rounded-md border border-slate-300 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-lg group-hover:block">
                          Maximale Überstundenreserve, bevor Ausgleich oder Auszahlung angestoßen werden sollte.
                        </span>
                      </span>
                    </span>
                    <input
                      name="maxOvertimeHours"
                      type="number"
                      step="0.5"
                      defaultValue={employee.max_ueberstunden ?? ''}
                      className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                    />
                  </label>
                </>
              ) : (
                <>
                  <input type="hidden" name="maxMinusHours" value="" />
                  <input type="hidden" name="maxOvertimeHours" value="" />
                </>
              )}
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span className="flex items-center gap-2">
                  Sachbezug
                  <span className="group relative inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-[11px] font-semibold text-slate-500">
                    i
                    <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-64 -translate-x-1/2 rounded-md border border-slate-300 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-lg group-hover:block">
                      Aktiviert, ob geldwerte Sachbezüge für diesen Mitarbeitenden geführt und exportiert werden.
                    </span>
                  </span>
                </span>
                <select
                  name="sachbezuege"
                  value={sachbezuegeValue}
                  onChange={(event) => setSachbezuegeValue(normalizeYesNoValue(event.target.value))}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900"
                >
                  {YES_NO_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              {sachbezuegeValue === 'Ja' ? (
                <label className="flex flex-col gap-1 text-sm text-slate-700">
                  <span className="flex items-center gap-2">
                    Sachbezugsbetrag (€)
                    <span className="group relative inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-[11px] font-semibold text-slate-500">
                      i
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-64 -translate-x-1/2 rounded-md border border-slate-300 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-lg group-hover:block">
                        Nach § 8 Abs. 2 Satz 11 EstG sind pro Mitarbeiter und Monat Sachbezüge bis zu einem gesamten Wert von 50&nbsp;€ steuer- und sozialversicherungsfrei. Wird der Wert überschritten, muss der gesamte Betrag versteuert werden.
                      </span>
                    </span>
                  </span>
                  <input
                    name="sachbezuegeAmount"
                    type="number"
                    step="0.01"
                    value={sachbezuegeAmount}
                    onChange={(event) => setSachbezuegeAmount(event.target.value)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900"
                  />
                </label>
              ) : (
                <input type="hidden" name="sachbezuegeAmount" value="0" />
              )}
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span className="flex items-center gap-2">
                  Bekommt der Mitarbeiter eine Umsatzbeteiligung?
                  <span className="group relative inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-[11px] font-semibold text-slate-500">
                    i
                    <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-72 -translate-x-1/2 rounded-md border border-slate-300 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-lg group-hover:block">
                      Steuert, ob für diesen Mitarbeitenden Umsatzziele und Bonusmodelle gepflegt werden.
                    </span>
                  </span>
                </span>
                <select
                  value={hasRevenueShare ? 'Ja' : 'Nein'}
                  onChange={(event) => setHasRevenueShare(event.target.value === 'Ja')}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900"
                >
                  {YES_NO_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              {hasRevenueShare ? (
                <label className="flex flex-col gap-1 text-sm text-slate-700">
                  <span className="flex items-center gap-2">
                    Mindest-Jahresumsatz (€)
                    <span className="group relative inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-[11px] font-semibold text-slate-500">
                      i
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-64 -translate-x-1/2 rounded-md border border-slate-300 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-lg group-hover:block">
                        Jahreszielumsatz, der als Basis für Bonusberechnungen und Ampeln herangezogen wird.
                      </span>
                    </span>
                  </span>
                  <input
                    name="mindJahresumsatz"
                    type="number"
                    step="100"
                    value={mindJahresumsatzValue}
                    onChange={(event) => setMindJahresumsatzValue(event.target.value)}
                    className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                  />
                </label>
              ) : (
                <input type="hidden" name="mindJahresumsatz" value="0" />
              )}
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span className="flex items-center gap-2">
                  Verpflegung?
                  <span className="group relative inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-[11px] font-semibold text-slate-500">
                    i
                    <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-64 -translate-x-1/2 rounded-md border border-slate-300 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-lg group-hover:block">
                      Steuert, ob Sachbezug Verpflegung aktiv ist – beeinflusst Zeiterfassung und Pausenprüfung.
                    </span>
                  </span>
                </span>
                <select
                  key={`verpflegung-${employee.sachbezug_verpflegung ?? 'Nein'}`}
                  name="sachbezugVerpflegung"
                  defaultValue={employee.sachbezug_verpflegung ?? 'Nein'}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900"
                >
                  {YES_NO_OPTIONS.map((value) => (
                    <option key={value} value={value} className="text-slate-900">
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
              <span className="flex items-center gap-2">
                Pflichtpause?
                <span className="group relative inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-[11px] font-semibold text-slate-500">
                  i
                  <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-64 -translate-x-1/2 rounded-md border border-slate-300 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-lg group-hover:block">
                    Einstellung einer Pflichtpause unabhängig der gesetzl. Pause nach § 4 ArbZG. Die Einstellung erscheint im Reiter.
                  </span>
                </span>
              </span>
              <select
                name="mandatoryPauseEnabled"
                  value={localMandatoryPauseEnabled ? 'Ja' : 'Nein'}
                  onChange={(event) => setLocalMandatoryPauseEnabled(event.target.value === 'Ja')}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900"
              >
                {YES_NO_OPTIONS.map((value) => (
                  <option key={value} value={value} className="text-slate-900">
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-800">Importierte Werte</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Importierte Überstunden (h)</span>
                <input
                  name="imported_overtime_balance"
                  type="number"
                  step="0.25"
                  defaultValue={employee.imported_overtime_balance}
                  className="rounded-md border border-slate-300 px-3 py-2"
                  form="profile-form"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Importierte Minusstunden (h)</span>
                <input
                  name="imported_minusstunden_balance"
                  type="number"
                  step="0.25"
                  defaultValue={employee.imported_minusstunden_balance}
                  className="rounded-md border border-slate-300 px-3 py-2"
                  form="profile-form"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Importierter Urlaub (Tage)</span>
                <input
                  name="imported_vacation_taken"
                  type="number"
                  step="0.5"
                  defaultValue={employee.imported_vacation_taken}
                  className="rounded-md border border-slate-300 px-3 py-2"
                  form="profile-form"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Importierter Bonus (€)</span>
                <input
                  name="imported_bonus_earned"
                  type="number"
                  step="0.5"
                  defaultValue={employee.imported_bonus_earned}
                  className="rounded-md border border-slate-300 px-3 py-2"
                  form="profile-form"
                />
              </label>
            </div>
          </div>
          <SubmitButton label="Einstellungen speichern" />
        </form>
      </div>
    </section>
      {hasRevenueShare ? (
        <section className="space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Bonusmodell</h2>
          {bonusState?.message ? (
            <span
              className={`text-sm ${
                bonusState.status === 'success' ? 'text-emerald-700' : 'text-red-600'
              }`}
            >
              {bonusState.message}
            </span>
          ) : null}
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <p className="font-medium text-slate-700">So wird der Bonus berechnet:</p>
          <ul className="mt-2 space-y-2 text-slate-600">
            <li><span className="font-semibold text-slate-700">Lineares Modell:</span> Du hinterlegst einen Prozentwert. Alle Umsätze über dem Monatsziel werden mit diesem Prozent als Bonus vergütet.</li>
            <li><span className="font-semibold text-slate-700">Stufenmodell:</span> Du definierst mehrere Schwellen (Netto-Umsatz) und den jeweiligen Bonus pro zusätzlichem Euro. Sobald eine Schwelle erreicht ist, gilt die nächste Stufe nur für den Umsatz oberhalb der jeweiligen Schwelle. Beispiel: <code className="rounded bg-slate-200 px-1">15000;5</code> bedeutet 5&nbsp;% auf den Teil über 15&nbsp;000&nbsp;€.</li>
            <li>Die Umsätze werden automatisch vom Brutto-Nachweis auf Netto umgerechnet (Basis 119 % = 19&nbsp;% MwSt.).</li>
          </ul>
        </div>
        <form action={bonusFormAction} className="space-y-4">
          <input type="hidden" name="employeeId" value={selectedEmployeeId} />
          <div className="flex flex-col gap-2 text-sm text-slate-700">
            <label className="flex items-center gap-2 text-slate-700">
              <input
                type="radio"
                name="schemeType"
                value="linear"
                checked={schemeType === 'linear'}
                onChange={() => setSchemeType('linear')}
              />
              Lineares Modell
            </label>
            <label className="flex items-center gap-2 text-slate-700">
              <input
                type="radio"
                name="schemeType"
                value="stufen"
                checked={schemeType === 'stufen'}
                onChange={() => setSchemeType('stufen')}
              />
              Stufenmodell
            </label>
          </div>
          {schemeType === 'linear' ? (
            <label className="flex flex-col gap-1 text-sm text-slate-700">
              <span>Bonus in Prozent</span>
              <input
                name="linearPercent"
                type="number"
                step="0.5"
                value={linearPercent}
                onChange={(event) => setLinearPercent(event.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-sm text-slate-700">
              <span>Stufen (jede Zeile: Schwelle;Prozent)</span>
              <textarea
                name="tiersData"
                rows={5}
                value={tierText}
                onChange={(event) => setTierText(event.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
                placeholder="10000;3\n15000;5"
              />
              <input type="hidden" name="linearPercent" value="0" />
            </label>
          )}
          {schemeType === 'linear' ? (
            <input type="hidden" name="tiersData" value={tierText} />
          ) : null}
          <SubmitButton label="Bonus speichern" />
        </form>
        </section>
      ) : null}

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">API-Integration</h2>
        {tillhubState?.message ? (
          <div
            className={`rounded-md border px-3 py-2 text-sm ${
              tillhubState.status === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {tillhubState.message}
          </div>
        ) : null}
        <form action={tillhubFormAction} className="space-y-3">
          <input type="hidden" name="employeeId" value={selectedEmployeeId} />
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            <span>Tillhub User-ID</span>
            <input
              name="tillhubUserId"
              defaultValue={employee.tillhub_user_id ?? ''}
              className="rounded-md border border-slate-300 px-3 py-2"
              placeholder="z. B. 123456"
            />
          </label>
          <SubmitButton label="API-Daten speichern" />
        </form>
      </section>

        </>
      ) : null}
    </section>
  );
}

export type BonusSchemeType = 'linear' | 'stufen';
