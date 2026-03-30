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
import type { VacationCarryNotificationRow } from '@/lib/data/vacation-carry-notifications';
import { FEDERAL_STATE_OPTIONS } from '@/lib/constants/federal-states';
import { withAppBasePath } from '@/lib/routes';
import { DailyOverviewTable } from './DailyOverviewTable';
import type { ActionState } from './types';
import MonthlySummaryPanel from './MonthlySummaryPanel';
import MonthlyClosingPanel from './MonthlyClosingPanel';
import AdminTimeEntriesPanel from './AdminTimeEntriesPanel';
import AdminMandatoryPausePanel from './AdminMandatoryPausePanel';
import { useActionRefresh } from './useRefreshEffect';
import type { EntryActionState } from '@/app/mitarbeiter/types';

const YES_NO_OPTIONS = ['Nein', 'Ja'];
const MANDATORY_PAUSE_MINUTES_OPTIONS = [15, 30, 45, 60, 90, 120] as const;
const normalizeYesNoValue = (value: string | null | undefined): 'Ja' | 'Nein' =>
  value === 'Ja' ? 'Ja' : 'Nein';

function formatDurationHoursLabel(minutes: number): string {
  const safe = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  const hh = Math.floor(safe / 60);
  const mm = safe % 60;
  return `${hh}:${String(mm).padStart(2, '0')} h`;
}

function parseNumberInput(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

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

function formatDateTimeLabel(value: string | null): string {
  if (!value) return '–';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseCarryExpiryMonthDay(value: string | null | undefined): { month: number; day: number } | null {
  if (!value) return null;
  const normalized = value.trim();
  const mdMatch = /^(\d{2})-(\d{2})$/.exec(normalized);
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  const month = Number.parseInt((mdMatch?.[1] ?? isoMatch?.[2] ?? ''), 10);
  const day = Number.parseInt((mdMatch?.[2] ?? isoMatch?.[3] ?? ''), 10);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(2024, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { month, day };
}

function normalizeCarryExpiryMonthDay(value: string | null | undefined): { month: number; day: number } {
  const parsed = parseCarryExpiryMonthDay(value);
  if (!parsed) {
    return { month: 3, day: 31 };
  }
  if (parsed.month < 3) {
    return { month: 3, day: 31 };
  }
  if (parsed.month === 3 && parsed.day < 31) {
    return { month: 3, day: 31 };
  }
  return parsed;
}

function getDaysInMonth(month: number): number {
  if (!Number.isFinite(month) || month < 1 || month > 12) return 31;
  return new Date(Date.UTC(2024, month, 0)).getUTCDate();
}

function describeVacationCarryStatus(status: VacationCarryNotificationRow['status']): string {
  if (status === 'smtp_accepted') return 'Zugestellt (SMTP akzeptiert)';
  if (status === 'failed') return 'Fehlgeschlagen';
  return 'Ausstehend';
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
  mandatoryPauseMinWorkMinutes: number;
  mandatoryPauseEnabled: boolean;
  weekdayPauses: { weekday: number; minutes: number }[];
  vacationCarryNotifications: VacationCarryNotificationRow[];
  onboardingSubmission: {
    inviteId: number;
    inviteCreatedAtLabel: string;
    submittedAtLabel: string | null;
    inviteEmail: string;
    inviteFirstName: string | null;
    inviteLastName: string | null;
    signatureName: string | null;
    signatureAcceptedAtLabel: string | null;
    adminPreset: {
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
    } | null;
    submission: Record<string, string | number | boolean | null>;
  } | null;
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
  overtimeBalanceAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  overtimeBalanceInitialState: ActionState;
  acceptOnboardingAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  acceptOnboardingInitialState: ActionState;
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
  mandatoryPauseMinWorkMinutes,
  mandatoryPauseEnabled,
  weekdayPauses,
  vacationCarryNotifications,
  onboardingSubmission,
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
  overtimeBalanceAction,
  overtimeBalanceInitialState,
  acceptOnboardingAction,
  acceptOnboardingInitialState,
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
  const [acceptOnboardingState, acceptOnboardingFormAction] = useActionState(
    acceptOnboardingAction,
    acceptOnboardingInitialState
  );
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
  const [compensationType, setCompensationType] = useState<'hourly' | 'fixed'>(
    employee.compensation_type === 'fixed' ? 'fixed' : 'hourly'
  );
  const [weeklyHoursInput, setWeeklyHoursInput] = useState<string>(
    employee.weekly_hours === null || employee.weekly_hours === undefined ? '' : String(employee.weekly_hours)
  );
  const [monthlySalaryInput, setMonthlySalaryInput] = useState<string>(
    employee.monthly_salary_gross === null || employee.monthly_salary_gross === undefined
      ? ''
      : String(employee.monthly_salary_gross)
  );
  const [localShowInCalendar, setLocalShowInCalendar] = useState(employee.show_in_calendar);
  const [vacationCarryExpiryEnabled, setVacationCarryExpiryEnabled] = useState(
    employee.vacation_carry_expiry_enabled
  );
  const [vacationCarryExpiryMonth, setVacationCarryExpiryMonth] = useState<number>(() => {
    const parsed = normalizeCarryExpiryMonthDay(employee.vacation_carry_expiry_date);
    return parsed?.month ?? 3;
  });
  const [vacationCarryExpiryDay, setVacationCarryExpiryDay] = useState<number>(() => {
    const parsed = normalizeCarryExpiryMonthDay(employee.vacation_carry_expiry_date);
    return parsed?.day ?? 31;
  });
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

  const onboardingRows = useMemo(() => {
    if (!onboardingSubmission) return [] as Array<{ label: string; value: string }>;
    const submission = onboardingSubmission.submission ?? {};
    const preset = onboardingSubmission.adminPreset;

    const getValue = (key: string): string | number | boolean | null => {
      if (submission[key] !== undefined && submission[key] !== null && `${submission[key]}`.trim() !== '') {
        return submission[key];
      }
      if (!preset) return null;
      switch (key) {
        case 'entryDate':
          return preset.entryDate;
        case 'tarifGroup':
          return preset.tarifGroup;
        case 'employmentType':
          return preset.employmentType;
        case 'workTimeModel':
          return preset.workTimeModel;
        case 'weeklyHours':
          return preset.weeklyHours;
        case 'probationMonths':
          return preset.probationMonths;
        case 'compensationType':
          return preset.compensationType;
        case 'hourlyWage':
          return preset.hourlyWage;
        case 'monthlySalaryGross':
          return preset.monthlySalaryGross;
        case 'vacationDaysTotal':
          return preset.vacationDaysTotal;
        default:
          return null;
      }
    };

    const toDisplay = (key: string, raw: string | number | boolean | null): string => {
      if (raw === null || raw === undefined) return '—';
      const value = String(raw).trim();
      if (!value) return '—';
      if ((key === 'birthDate' || key === 'entryDate' || key === 'submittedAt') && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
        if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString('de-DE');
      }
      if (key === 'country') {
        if (value === 'AT') return 'Österreich';
        if (value === 'CH') return 'Schweiz';
        return 'Deutschland';
      }
      if (key === 'federalState') {
        const option = FEDERAL_STATE_OPTIONS.find((entry) => entry.code === value);
        return option?.label ?? value;
      }
      if (key === 'compensationType') {
        return value === 'fixed' ? 'Festgehalt (Brutto)' : 'Stundenlohn';
      }
      if (
        key === 'hourlyWage' ||
        key === 'monthlySalaryGross'
      ) {
        const numeric = Number.parseFloat(value.replace(',', '.'));
        if (Number.isFinite(numeric)) return `${numeric.toFixed(2).replace('.', ',')} €`;
      }
      if (key === 'weeklyHours') {
        const numeric = Number.parseFloat(value.replace(',', '.'));
        if (Number.isFinite(numeric)) return `${numeric.toFixed(2).replace('.', ',')} h`;
      }
      return value;
    };

    const fields: Array<{ label: string; key: string }> = [
      { label: 'Vorname', key: 'firstName' },
      { label: 'Nachname', key: 'lastName' },
      { label: 'E-Mail', key: 'email' },
      { label: 'Telefon', key: 'phone' },
      { label: 'Straße', key: 'street' },
      { label: 'Hausnummer', key: 'houseNumber' },
      { label: 'Land', key: 'country' },
      { label: 'PLZ', key: 'zipCode' },
      { label: 'Ort', key: 'city' },
      { label: 'Bundesland/Kanton', key: 'federalState' },
      { label: 'Geburtsdatum', key: 'birthDate' },
      { label: 'Nationalität', key: 'nationality' },
      { label: 'Familienstand', key: 'maritalStatus' },
      { label: 'Steuerklasse', key: 'taxClass' },
      { label: 'Kinderfreibetrag', key: 'kinderfreibetrag' },
      { label: 'Steuer-ID', key: 'steuerId' },
      { label: 'Sozialversicherungsnummer', key: 'socialSecurityNumber' },
      { label: 'Krankenkasse', key: 'healthInsurance' },
      { label: 'Versichertennummer', key: 'healthInsuranceNumber' },
      { label: 'IBAN', key: 'iban' },
      { label: 'BIC', key: 'bic' },
      { label: 'Notfallkontakt Name', key: 'emergencyContactName' },
      { label: 'Notfallkontakt Telefon', key: 'emergencyContactPhone' },
      { label: 'Notfallkontakt Beziehung', key: 'emergencyContactRelation' },
      { label: 'Eintrittsdatum', key: 'entryDate' },
      { label: 'Tarifgruppe / Jobtitel', key: 'tarifGroup' },
      { label: 'Einstellungsart', key: 'employmentType' },
      { label: 'Arbeitszeitmodell', key: 'workTimeModel' },
      { label: 'Std/Woche', key: 'weeklyHours' },
      { label: 'Probezeit (Monate)', key: 'probationMonths' },
      { label: 'Vergütungsart', key: 'compensationType' },
      { label: 'Stundenlohn (€)', key: 'hourlyWage' },
      { label: 'Monatsgehalt Brutto (€)', key: 'monthlySalaryGross' },
      { label: 'Urlaubstage/Jahr', key: 'vacationDaysTotal' },
      { label: 'Signaturname', key: 'signatureName' },
    ];

    const rows = fields.map((field) => {
      const raw = field.key === 'signatureName' ? onboardingSubmission.signatureName : getValue(field.key);
      return { label: field.label, value: toDisplay(field.key, raw) };
    });

    rows.push({ label: 'Einladung erstellt', value: onboardingSubmission.inviteCreatedAtLabel });
    rows.push({ label: 'Personalbogen eingegangen', value: onboardingSubmission.submittedAtLabel ?? '—' });
    rows.push({ label: 'Signatur bestätigt', value: onboardingSubmission.signatureAcceptedAtLabel ?? '—' });
    rows.push({ label: 'Einladungs-E-Mail', value: onboardingSubmission.inviteEmail });

    return rows;
  }, [onboardingSubmission]);

  const onboardingSubmissionComplete = useMemo(() => {
    if (!onboardingSubmission) return false;
    const requiredKeys = [
      'firstName',
      'lastName',
      'email',
      'phone',
      'street',
      'houseNumber',
      'country',
      'zipCode',
      'city',
      'federalState',
      'birthDate',
      'taxClass',
      'steuerId',
      'socialSecurityNumber',
      'healthInsurance',
      'healthInsuranceNumber',
      'iban',
      'bic',
      'entryDate',
      'tarifGroup',
      'employmentType',
      'workTimeModel',
      'weeklyHours',
      'probationMonths',
      'compensationType',
      'vacationDaysTotal',
    ];
    return requiredKeys.every((key) => {
      const value = onboardingSubmission.submission[key];
      if (value !== undefined && value !== null) return String(value).trim().length > 0;
      const preset = onboardingSubmission.adminPreset;
      if (!preset) return false;
      switch (key) {
        case 'entryDate':
          return Boolean(preset.entryDate);
        case 'tarifGroup':
          return Boolean(preset.tarifGroup);
        case 'employmentType':
          return Boolean(preset.employmentType);
        case 'workTimeModel':
          return Boolean(preset.workTimeModel);
        case 'weeklyHours':
          return Number.isFinite(preset.weeklyHours) && preset.weeklyHours > 0;
        case 'probationMonths':
          return Number.isFinite(preset.probationMonths) && preset.probationMonths >= 0;
        case 'compensationType':
          return preset.compensationType === 'hourly' || preset.compensationType === 'fixed';
        case 'vacationDaysTotal':
          return Number.isFinite(preset.vacationDaysTotal) && preset.vacationDaysTotal > 0;
        default:
          return false;
      }
    });
  }, [onboardingSubmission]);

  const handlePrintOnboardingSubmission = useCallback(() => {
    if (typeof window === 'undefined' || !onboardingSubmissionComplete) return;

    const printUrl = new URL(
      withAppBasePath(`/admin/mitarbeitende/${selectedEmployeeId}/personalbogen`, 'external'),
      window.location.origin
    );
    printUrl.searchParams.set('print', '1');
    window.open(printUrl.toString(), '_blank', 'noopener,noreferrer');
  }, [onboardingSubmissionComplete, selectedEmployeeId]);

  const handleExportOnboardingCsv = useCallback(() => {
    if (typeof window === 'undefined' || !onboardingSubmissionComplete || !onboardingRows.length) return;
    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const csvContent = [
      ['Feld', 'Wert'],
      ...onboardingRows.map((row) => [row.label, row.value]),
    ]
      .map((row) => row.map((column) => escapeCsv(column)).join(';'))
      .join('\n');

    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const fileName = `personalbogen_${employee.last_name}_${employee.first_name}_${selectedEmployeeId}.csv`
      .toLowerCase()
      .replace(/\s+/g, '_');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }, [employee.first_name, employee.last_name, onboardingRows, onboardingSubmissionComplete, selectedEmployeeId]);

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
  const onboardingPending = employee.onboarding_status === 'pending';
  const statusLabel = onboardingPending ? 'Ausstehend' : employee.isActive ? 'Aktiv' : 'Deaktiviert';
  const statusBadgeClass = onboardingPending
    ? 'border-amber-200 bg-amber-50 text-amber-700'
    : employee.isActive
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-slate-300 bg-slate-200 text-slate-700';
  const profilePhotoUrl = employee.profile_photo_file_name
    ? `/api/documents/${selectedEmployeeId}/${encodeURIComponent(employee.profile_photo_file_name)}`
    : null;
  const onboardingViewUrl = onboardingSubmission
    ? withAppBasePath(`/admin/mitarbeitende/${selectedEmployeeId}/personalbogen`, 'external')
    : undefined;

  useEffect(() => {
    setLocalMandatoryPauseEnabled(mandatoryPauseEnabled);
  }, [mandatoryPauseEnabled]);

  useEffect(() => {
    setLocalShowInCalendar(employee.show_in_calendar);
    setVacationCarryExpiryEnabled(employee.vacation_carry_expiry_enabled);
    const parsedCarryExpiry = normalizeCarryExpiryMonthDay(employee.vacation_carry_expiry_date);
    setVacationCarryExpiryMonth(parsedCarryExpiry?.month ?? 3);
    setVacationCarryExpiryDay(parsedCarryExpiry?.day ?? 31);
    setSachbezuegeValue(normalizeYesNoValue(employee.sachbezuege ?? 'Nein'));
    setSachbezuegeAmount(String(employee.sachbezuege_amount ?? 0));
    setCompensationType(employee.compensation_type === 'fixed' ? 'fixed' : 'hourly');
    setWeeklyHoursInput(
      employee.weekly_hours === null || employee.weekly_hours === undefined ? '' : String(employee.weekly_hours)
    );
    setMonthlySalaryInput(
      employee.monthly_salary_gross === null || employee.monthly_salary_gross === undefined
        ? ''
        : String(employee.monthly_salary_gross)
    );
    setHasRevenueShare(deriveHasRevenueShare(employee, bonusScheme, bonusTiers));
    setMindJahresumsatzValue(String(employee.mind_jahresumsatz ?? 0));
    setHourLimitsEnabled(
      (employee.max_minusstunden ?? null) !== null || (employee.max_ueberstunden ?? null) !== null
    );
  }, [employee, bonusScheme, bonusTiers]);

  const derivedFixedHourlyWage = useMemo(() => {
    if (compensationType !== 'fixed') return null;
    const weeklyHours = parseNumberInput(weeklyHoursInput);
    const monthlySalary = parseNumberInput(monthlySalaryInput);
    if (weeklyHours === null || weeklyHours <= 0 || monthlySalary === null || monthlySalary < 0) {
      return null;
    }
    const avgMonthlyHours = (weeklyHours * 13) / 3;
    if (!Number.isFinite(avgMonthlyHours) || avgMonthlyHours <= 0) {
      return null;
    }
    return Math.round((monthlySalary / avgMonthlyHours) * 100) / 100;
  }, [compensationType, weeklyHoursInput, monthlySalaryInput]);

  useEffect(() => {
    const maxDay = getDaysInMonth(vacationCarryExpiryMonth);
    const minDay = vacationCarryExpiryMonth === 3 ? 31 : 1;
    if (vacationCarryExpiryDay > maxDay) {
      setVacationCarryExpiryDay(maxDay);
      return;
    }
    if (vacationCarryExpiryDay < minDay) {
      setVacationCarryExpiryDay(minDay);
    }
  }, [vacationCarryExpiryMonth, vacationCarryExpiryDay]);

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

  useActionRefresh(profileState, () => {
    startTransition(() => {
      router.refresh();
    });
  });

  useActionRefresh(acceptOnboardingState, () => {
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
          <div className="flex items-center gap-4">
            {profilePhotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profilePhotoUrl}
                alt={`Profilfoto ${employee.first_name} ${employee.last_name}`}
                className="h-14 w-14 rounded-full border border-slate-200 object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-xs font-semibold text-slate-500">
                {`${employee.first_name?.[0] ?? ''}${employee.last_name?.[0] ?? ''}`.toUpperCase() || 'MA'}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">
                {employee.first_name} {employee.last_name}
              </h1>
              <p className="text-sm text-slate-500">Personalnummer: {employee.personnel_number ?? '—'}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-sm text-slate-600">
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              Eintritt: {new Date(`${employee.entry_date}T00:00:00`).toLocaleDateString('de-DE')}
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              Rolle: {employee.role_id === 2 ? 'Admin' : 'Mitarbeiter'}
            </div>
            <div className={`rounded-md border px-3 py-2 text-xs font-semibold ${statusBadgeClass}`}>
              Status: {statusLabel}
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

        {onboardingSubmission ? (
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Personalbogen</h2>
                <p className="text-xs text-slate-600">
                  Eingegangen: {onboardingSubmission.submittedAtLabel ?? '—'} · Einladung: {onboardingSubmission.inviteCreatedAtLabel}
                </p>
                {!onboardingSubmissionComplete ? (
                  <p className="mt-1 text-xs text-amber-700">
                    Export/Druck ist aktiv, sobald alle Pflichtdaten vollständig übermittelt wurden.
                  </p>
                ) : null}
                {acceptOnboardingState?.message ? (
                  <p
                    className={`mt-1 text-xs ${
                      acceptOnboardingState.status === 'success' ? 'text-emerald-700' : 'text-red-600'
                    }`}
                  >
                    {acceptOnboardingState.message}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href={onboardingViewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Personalbogen öffnen
                </a>
                <button
                  type="button"
                  onClick={handlePrintOnboardingSubmission}
                  disabled={!onboardingSubmissionComplete}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Printer className="h-4 w-4" />
                  Personalbogen drucken
                </button>
                <button
                  type="button"
                  onClick={handleExportOnboardingCsv}
                  disabled={!onboardingSubmissionComplete}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Export (CSV)
                </button>
                {onboardingPending ? (
                  <form action={acceptOnboardingFormAction}>
                    <input type="hidden" name="employee_id" value={selectedEmployeeId} />
                    <button
                      type="submit"
                      disabled={!onboardingSubmissionComplete}
                      className="inline-flex items-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white shadow hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Daten übernehmen
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

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
        balanceAction={overtimeBalanceAction}
        balanceInitialState={overtimeBalanceInitialState}
      />
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Aktivität: Resturlaub-Verfall</h2>
        <p className="mt-1 text-sm text-slate-600">
          Versandnachweise für automatische Resturlaubs-Hinweise.
        </p>
        {vacationCarryNotifications.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Zeitpunkt</th>
                  <th className="px-3 py-2 text-left font-semibold">Weg</th>
                  <th className="px-3 py-2 text-left font-semibold">Empfänger</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-left font-semibold">Nachweis</th>
                  <th className="px-3 py-2 text-left font-semibold">Inhalt (Auszug)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {vacationCarryNotifications.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2">{formatDateTimeLabel(row.sentAt ?? row.createdAt)}</td>
                    <td className="px-3 py-2">{row.channel.toUpperCase()}</td>
                    <td className="px-3 py-2">{row.recipient ?? '–'}</td>
                    <td className="px-3 py-2">{describeVacationCarryStatus(row.status)}</td>
                    <td className="px-3 py-2">
                      {row.providerMessageId
                        ? `Message-ID: ${row.providerMessageId}`
                        : row.errorMessage || row.providerResponse || '–'}
                    </td>
                    <td className="px-3 py-2">
                      {row.subject
                        ? `${row.subject}${row.bodyText?.includes('verfällt am') ? ' | Verfallhinweis enthalten' : ''}`
                        : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">Noch keine Benachrichtigung protokolliert.</p>
        )}
      </section>
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
          mandatoryPauseMinWorkMinutes={mandatoryPauseMinWorkMinutes}
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
                <span>Hausnummer</span>
                <input
                  name="house_number"
                  defaultValue={employee.house_number ?? ''}
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
                <div className="mt-4 grid gap-4 md:grid-cols-2">
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
                <div className="mt-4 grid gap-4 md:grid-cols-3">
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
                    <span>Austrittsdatum (optional)</span>
                    <input
                      name="exit_date"
                      type="date"
                      defaultValue={formatDateInput(employee.exit_date)}
                      className="rounded-md border border-slate-300 px-3 py-2"
                    />
                  </label>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
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
                      value={weeklyHoursInput}
                      onChange={(event) => setWeeklyHoursInput(event.target.value)}
                      className="rounded-md border border-slate-300 px-3 py-2"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>Vergütungsart</span>
                    <select
                      name="compensation_type"
                      value={compensationType}
                      onChange={(event) =>
                        setCompensationType(event.target.value === 'fixed' ? 'fixed' : 'hourly')
                      }
                      className="rounded-md border border-slate-300 bg-white px-3 py-2"
                    >
                      <option value="hourly">Stundenlohn</option>
                      <option value="fixed">Festgehalt (Brutto)</option>
                    </select>
                  </label>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span className="flex items-center gap-2">
                      Vergütung (€)
                      <span className="group relative inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-[11px] font-semibold text-slate-500">
                        i
                        <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-64 -translate-x-1/2 rounded-md border border-slate-300 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-lg group-hover:block">
                          Bei Festgehalt wird der Stundenlohn automatisch über die 13-Wochen-Formel berechnet:
                          Monatsgehalt / ((Wochenstunden * 13) / 3).
                        </span>
                      </span>
                    </span>
                    {compensationType === 'fixed' ? (
                      <>
                        <input
                          name="monthly_salary_gross"
                          type="number"
                          step="0.01"
                          min="0"
                          value={monthlySalaryInput}
                          onChange={(event) => setMonthlySalaryInput(event.target.value)}
                          className="rounded-md border border-slate-300 px-3 py-2"
                        />
                        <input
                          type="hidden"
                          name="hourly_wage"
                          value={derivedFixedHourlyWage === null ? '' : String(derivedFixedHourlyWage)}
                        />
                      </>
                    ) : (
                      <>
                        <input
                          name="hourly_wage"
                          type="number"
                          step="0.01"
                          min="0"
                          defaultValue={employee.hourly_wage ?? ''}
                          className="rounded-md border border-slate-300 px-3 py-2"
                        />
                        <input type="hidden" name="monthly_salary_gross" value="" />
                      </>
                    )}
                  </label>
                  {compensationType === 'fixed' ? (
                    <label className="flex flex-col gap-1 text-sm text-slate-700">
                      <span>Errechneter Stundenlohn (€)</span>
                      <input
                        type="text"
                        readOnly
                        value={derivedFixedHourlyWage === null ? '—' : derivedFixedHourlyWage.toFixed(2)}
                        className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-700"
                      />
                    </label>
                  ) : null}
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
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
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>Soll Resturlaub aus Vorjahr verfallen?</span>
                    <select
                      name="vacation_carry_expiry_enabled"
                      value={vacationCarryExpiryEnabled ? 'Ja' : 'Nein'}
                      onChange={(event) => setVacationCarryExpiryEnabled(event.target.value === 'Ja')}
                      className="rounded-md border border-slate-300 bg-white px-3 py-2"
                    >
                      {YES_NO_OPTIONS.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {vacationCarryExpiryEnabled ? (
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm text-slate-700">
                      <span>Verfall ab (Monat)</span>
                      <select
                        name="vacation_carry_expiry_month"
                        value={String(vacationCarryExpiryMonth)}
                        onChange={(event) => setVacationCarryExpiryMonth(Number.parseInt(event.target.value, 10))}
                        className="rounded-md border border-slate-300 bg-white px-3 py-2"
                      >
                        {Array.from({ length: 10 }, (_, index) => index + 3).map((month) => (
                          <option key={month} value={String(month)}>
                            {String(month).padStart(2, '0')}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm text-slate-700">
                      <span>Verfall ab (Tag)</span>
                      <select
                        name="vacation_carry_expiry_day"
                        value={String(vacationCarryExpiryDay)}
                        onChange={(event) => setVacationCarryExpiryDay(Number.parseInt(event.target.value, 10))}
                        className="rounded-md border border-slate-300 bg-white px-3 py-2"
                      >
                        {Array.from({ length: getDaysInMonth(vacationCarryExpiryMonth) }, (_, index) => index + 1)
                          .filter((day) => vacationCarryExpiryMonth !== 3 || day >= 31)
                          .map((day) => (
                          <option key={day} value={String(day)}>
                            {String(day).padStart(2, '0')}
                          </option>
                          ))}
                      </select>
                    </label>
                    <p className="md:col-span-2 text-xs text-slate-500">
                      Das Verfallsdatum wiederholt sich jedes Jahr und darf gesetzlich nicht vor dem 31.03. liegen.
                    </p>
                  </div>
                ) : null}
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
            <p className="text-sm font-semibold text-slate-800">Mitarbeiter Zugang</p>
            <div className="mt-3 flex flex-col gap-2 text-sm text-slate-700">
              <p className="text-xs text-slate-500">
                Zugangsdaten werden zentral in der Control-Plane verwaltet.
              </p>
              {employee.control_plane_staff_id ? (
                <a
                  href={`https://app.timevex.com/tenant/staff/${encodeURIComponent(employee.control_plane_staff_id)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-fit items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Mitarbeiter Zugang
                  <span className="text-slate-400">↗</span>
                </a>
              ) : (
                <p className="text-sm text-amber-700">
                  Kein zentraler Mitarbeiter verknüpft. Bitte Sync/Provisioning prüfen.
                </p>
              )}
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
                    Einstellung einer Pflichtpause unabhaengig der gesetzl. Pause nach § 4 ArbZG. Die Einstellung erscheint im Reiter. Diese Einstellung macht Sinn, wenn laut AV 6h oder weniger vereinbart ist, aber dennoch eine Pause gemacht werden soll.
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
              {localMandatoryPauseEnabled ? (
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span className="flex items-center gap-2">
                      Tägliche Arbeitszeit
                      <span className="group relative inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-[11px] font-semibold text-slate-500">
                        i
                        <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-80 -translate-x-1/2 rounded-md border border-slate-300 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-lg group-hover:block">
                          Unter 6&nbsp;Stunden gibt es keine gesetzliche Pause. Wenn „Pflichtpause“ aktiv ist, wird ab der hier gewählten täglichen Arbeitszeit trotzdem eine Pause erzwungen. Ab 6&nbsp;Stunden gilt immer die gesetzliche Pausenregelung nach §&nbsp;4 ArbZG.
                        </span>
                      </span>
                    </span>
                    <select
                      name="mandatoryPauseMinWorkMinutes"
                      defaultValue={String(Math.max(mandatoryPauseMinWorkMinutes, 0) || 60)}
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900"
                    >
                      {Array.from({ length: 21 }, (_, idx) => 60 + idx * 15).map((minutes) => (
                        <option key={minutes} value={String(minutes)} className="text-slate-900">
                          {formatDurationHoursLabel(minutes)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>Pflichtpause (Minuten)</span>
                    <select
                      name="minPauseUnder6Minutes"
                      defaultValue={String(Math.max(minPauseUnder6Minutes, 0) || 30)}
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900"
                    >
                      {MANDATORY_PAUSE_MINUTES_OPTIONS.map((minutes) => (
                        <option key={minutes} value={String(minutes)} className="text-slate-900">
                          {minutes}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : (
                <>
                  <input type="hidden" name="mandatoryPauseMinWorkMinutes" value="0" />
                  <input type="hidden" name="minPauseUnder6Minutes" value="0" />
                </>
              )}
            </label>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-800">Eroeffnungswerte (einmalig)</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Mitarbeiterstatus beim Start</span>
                <select
                  name="opening_type"
                  defaultValue={employee.opening_type}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2"
                >
                  <option value="new">Neu im Unternehmen</option>
                  <option value="existing">Bestandsmitarbeiter</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Eröffnungswerte gesperrt</span>
                <select
                  name="opening_values_locked"
                  defaultValue={employee.opening_values_locked ? 'Ja' : 'Nein'}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2"
                >
                  {YES_NO_OPTIONS.map((value) => (
                    <option key={`opening-lock-${value}`} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Stichtag</span>
                <input
                  name="opening_effective_date"
                  type="date"
                  defaultValue={employee.opening_effective_date ?? employee.entry_date}
                  className="rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Eroeffnungssaldo Stundenkonto (h)</span>
                <input
                  name="opening_overtime_balance"
                  type="number"
                  step="0.25"
                  defaultValue={employee.opening_overtime_balance}
                  className="rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Resturlaub Vorjahr zum Stichtag (Tage)</span>
                <input
                  name="opening_vacation_carry_days"
                  type="number"
                  step="0.5"
                  defaultValue={employee.opening_vacation_carry_days}
                  className="rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Bereits genommener Urlaub im Jahr (Tage)</span>
                <input
                  name="opening_vacation_taken_ytd"
                  type="number"
                  step="0.5"
                  defaultValue={employee.opening_vacation_taken_ytd}
                  className="rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Bonus-Stand zum Stichtag (€)</span>
                <input
                  name="opening_bonus_carry"
                  type="text"
                  inputMode="decimal"
                  defaultValue={String(employee.opening_bonus_carry ?? 0)}
                  className="rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Diese Werte bilden die Eröffnungsbilanz. Nach Sperrung sind Änderungen nur nach Entsperren möglich.
            </p>
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
