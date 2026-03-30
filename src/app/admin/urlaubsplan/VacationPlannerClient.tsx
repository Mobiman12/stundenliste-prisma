'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useActionState, useMemo, useState, useEffect, useRef } from 'react';

import type { LeaveRequestView } from '@/lib/services/leave-requests';
import type { VacationPlannerData } from '@/lib/services/admin/vacation-planner';

import type { VacationPlanActionState } from './actions';

const INITIAL_ACTION_STATE: VacationPlanActionState = {
  status: 'idle',
  message: null,
};

type EntryBadge =
  | {
      kind: 'holiday';
      id: string;
      isoDate: string;
      label: string;
      background: string;
      text: string;
      border: string;
      title: string;
    }
  | {
      kind: 'request';
      id: string;
      isoDate: string;
      request: LeaveRequestView;
      label: string;
      background: string;
      text: string;
      border: string;
      title: string;
    }
  | {
      kind: 'lock';
      id: string;
      isoDate: string;
      lockId: number;
      label: string;
      background: string;
      text: string;
      border: string;
      title: string;
    }
  | {
      kind: 'daily';
      id: string;
      isoDate: string;
      employeeId: number;
      label: string;
      background: string;
      text: string;
      border: string;
      title: string;
    };

const MONTH_LABELS = [
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
] as const;

const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function parseIsoDate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function enumerateDates(startIso: string, endIso: string): string[] {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  if (!start || !end) return [];
  const dates: string[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
  }
  return dates;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function monthIso(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function toHexWithAlpha(hex: string, alpha: string): string {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
  if (normalized.length !== 6) return '#2563eb22';
  return `#${normalized}${alpha}`;
}

function isDarkColor(hex: string): boolean {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
  if (normalized.length !== 6) return false;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma < 0.6;
}

export default function VacationPlannerClient({
  data,
  decideRangeAction,
  createManualVacationAction,
  createVacationLockAction,
  deactivateVacationLockAction,
}: {
  data: VacationPlannerData;
  decideRangeAction: (
    prevState: VacationPlanActionState,
    formData: FormData,
  ) => Promise<VacationPlanActionState>;
  createManualVacationAction: (
    prevState: VacationPlanActionState,
    formData: FormData,
  ) => Promise<VacationPlanActionState>;
  createVacationLockAction: (
    prevState: VacationPlanActionState,
    formData: FormData,
  ) => Promise<VacationPlanActionState>;
  deactivateVacationLockAction: (
    prevState: VacationPlanActionState,
    formData: FormData,
  ) => Promise<VacationPlanActionState>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedRequest, setSelectedRequest] = useState<LeaveRequestView | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const manualFormRef = useRef<HTMLFormElement | null>(null);
  const [manualAllowUnpaid, setManualAllowUnpaid] = useState(false);
  const [decisionRangeStart, setDecisionRangeStart] = useState<string>('');
  const [decisionRangeEnd, setDecisionRangeEnd] = useState<string>('');

  const [decisionState, decisionAction] = useActionState(decideRangeAction, INITIAL_ACTION_STATE);
  const [manualState, manualAction] = useActionState(createManualVacationAction, INITIAL_ACTION_STATE);
  const [lockState, lockAction] = useActionState(createVacationLockAction, INITIAL_ACTION_STATE);
  const [deactivateLockState, deactivateLockAction] = useActionState(
    deactivateVacationLockAction,
    INITIAL_ACTION_STATE,
  );

  const employeeMap = useMemo(() => {
    return new Map(data.employees.map((item) => [item.employeeId, item]));
  }, [data.employees]);

  const daysByMonth = useMemo(() => {
    return MONTH_LABELS.map((_label, monthIndex) => {
      const dayCount = daysInMonth(data.year, monthIndex);
      return Array.from({ length: dayCount }, (_, idx) => monthIso(data.year, monthIndex, idx + 1));
    });
  }, [data.year]);

  const entriesByDate = useMemo(() => {
    const map = new Map<string, EntryBadge[]>();
    const requestDateByEmployee = new Set<string>();
    const holidayDateSet = new Set(data.holidays.map((holiday) => holiday.isoDate));
    const holidayDatesByRequestId = new Map<number, Set<string>>(
      Object.entries(data.holidayDatesByRequestId).map(([requestId, dates]) => [
        Number(requestId),
        new Set(dates),
      ]),
    );

    for (const holiday of data.holidays) {
      if (!holiday.isoDate.startsWith(`${data.year}-`)) continue;
      const list = map.get(holiday.isoDate) ?? [];
      const holidayTitle =
        holiday.names.length > 0
          ? `Feiertag: ${holiday.names.join(', ')}`
          : 'Feiertag';
      list.push({
        kind: 'holiday',
        id: `holiday-${holiday.isoDate}`,
        isoDate: holiday.isoDate,
        label: 'FT',
        background: '#e0e7ff',
        text: '#3730a3',
        border: '#6366f1',
        title: holidayTitle,
      });
      map.set(holiday.isoDate, list);
    }

    for (const request of data.leaveRequests) {
      if (request.type !== 'vacation') continue;
      const employee = employeeMap.get(request.employeeId);
      const initials = employee?.initials ?? 'MA';
      const color = employee?.color ?? '#2563eb';
      const holidayOverlap = data.holidayOverlapByRequestId[request.id] ?? 0;
      const effectiveVacationDays = Math.max(0, request.totalDays - holidayOverlap);
      const background =
        request.status === 'pending'
          ? '#ffffff'
          : request.status === 'approved'
          ? toHexWithAlpha(color, 'E6')
          : '#d1d5db';
      const border =
        request.status === 'pending'
          ? '#dc2626'
          : request.status === 'approved'
          ? color
          : '#94a3b8';
      const text = request.status === 'approved' ? (isDarkColor(color) ? '#ffffff' : '#111827') : '#1f2937';

      const title = [
        `Name: ${request.employeeName ?? `Mitarbeiter #${request.employeeId}`}`,
        `Status: ${request.statusLabel}`,
        request.isUnpaid ? `Typ: Unbezahlter Urlaub (${request.unpaidDays} Tage)` : null,
        `Zeitraum: ${formatDate(request.startDate)} bis ${formatDate(request.endDate)}`,
        `Urlaubstage (ohne Feiertage): ${effectiveVacationDays}`,
        holidayOverlap > 0 ? `Abzug Feiertage: ${holidayOverlap}` : null,
        `Antrag gestellt: ${request.createdAt}`,
        request.decidedAt ? `Entschieden: ${request.decidedAt}` : 'Entschieden: offen',
        request.adminNote ? `Notiz: ${request.adminNote}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      for (const isoDate of enumerateDates(request.startDate, request.endDate)) {
        if (!isoDate.startsWith(`${data.year}-`)) continue;
        if (holidayDateSet.has(isoDate)) {
          continue;
        }
        if (holidayDatesByRequestId.get(request.id)?.has(isoDate)) {
          continue;
        }
        const list = map.get(isoDate) ?? [];
        list.push({
          kind: 'request',
          id: `req-${request.id}-${isoDate}`,
          isoDate,
          request,
          label: request.isUnpaid ? `${initials}*` : initials,
          background,
          text,
          border,
          title,
        });
        requestDateByEmployee.add(`${request.employeeId}:${isoDate}`);
        map.set(isoDate, list);
      }
    }

    for (const day of data.recordedVacationDays) {
      if (!day.isoDate.startsWith(`${data.year}-`)) continue;
      if (holidayDateSet.has(day.isoDate)) continue;
      if (requestDateByEmployee.has(`${day.employeeId}:${day.isoDate}`)) continue;
      const employee = employeeMap.get(day.employeeId);
      const initials = employee?.initials ?? 'MA';
      const color = employee?.color ?? '#2563eb';
      const list = map.get(day.isoDate) ?? [];
      list.push({
        kind: 'daily',
        id: `daily-${day.employeeId}-${day.isoDate}`,
        isoDate: day.isoDate,
        employeeId: day.employeeId,
        label: day.amount === 0.5 ? `${initials}\u00bd` : initials,
        background: toHexWithAlpha(color, '2E'),
        text: '#1f2937',
        border: toHexWithAlpha(color, '9E'),
        title: `${employee?.name ?? `Mitarbeiter #${day.employeeId}`}\nAus Tageserfassung: Urlaub (${day.amount === 0.5 ? '0,5' : '1'} Tag)`,
      });
      map.set(day.isoDate, list);
    }

    for (const lock of data.locks) {
      for (const isoDate of enumerateDates(lock.start_date, lock.end_date)) {
        if (!isoDate.startsWith(`${data.year}-`)) continue;
        const list = map.get(isoDate) ?? [];
        list.push({
          kind: 'lock',
          id: `lock-${lock.id}-${isoDate}`,
          isoDate,
          lockId: lock.id,
          label: 'S',
          background: lock.is_active === 1 ? '#111827' : '#9ca3af',
          text: '#ffffff',
          border: '#111827',
          title: `Urlaubssperre ${lock.branch_name ? `(${lock.branch_name})` : '(global)'}\n${formatDate(lock.start_date)} bis ${formatDate(lock.end_date)}${lock.reason ? `\nGrund: ${lock.reason}` : ''}`,
        });
        map.set(isoDate, list);
      }
    }

    for (const [key, value] of map.entries()) {
      value.sort((a, b) => {
        if (a.kind === b.kind) {
          if (a.kind === 'request' && b.kind === 'request') return a.request.employeeId - b.request.employeeId;
          if (a.kind === 'daily' && b.kind === 'daily') return a.employeeId - b.employeeId;
          return a.id.localeCompare(b.id);
        }
        if (a.kind === 'lock') return -1;
        if (b.kind === 'lock') return 1;
        if (a.kind === 'holiday') return -1;
        if (b.kind === 'holiday') return 1;
        if (a.kind === 'daily') return 1;
        if (b.kind === 'daily') return -1;
        return 0;
      });
      map.set(key, value);
    }

    return map;
  }, [
    data.leaveRequests,
    data.locks,
    data.holidays,
    data.recordedVacationDays,
    data.holidayOverlapByRequestId,
    data.holidayDatesByRequestId,
    employeeMap,
    data.year,
  ]);

  useEffect(() => {
    if (!selectedRequest) return;
    setDecisionRangeStart(selectedRequest.startDate);
    setDecisionRangeEnd(selectedRequest.endDate);
  }, [selectedRequest]);

  useEffect(() => {
    if (decisionState.status === 'success') {
      setSelectedRequest(null);
    }
  }, [decisionState.status]);

  useEffect(() => {
    if (manualState.status === 'success' || lockState.status === 'success') {
      setSelectedDate(null);
      setManualAllowUnpaid(false);
    }
  }, [manualState.status, lockState.status]);

  useEffect(() => {
    if (selectedDate) {
      setManualAllowUnpaid(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    if (!manualState.requiresUnpaidConfirmation) return;
    const unpaidDays = Number(manualState.unpaidDays ?? 0);
    const confirmed = window.confirm(
      `Resturlaub reicht nicht aus. ${unpaidDays.toFixed(2)} Tage werden als unbezahlter Urlaub gespeichert. Fortfahren?`,
    );
    if (!confirmed) return;
    setManualAllowUnpaid(true);
    queueMicrotask(() => {
      manualFormRef.current?.requestSubmit();
    });
  }, [manualState.requiresUnpaidConfirmation, manualState.unpaidDays]);

  const locationLabel =
    data.selectedBranchId != null
      ? data.branchOptions.find((item) => item.id === data.selectedBranchId)?.name ?? 'Standort'
      : 'Alle Standorte';

  const approvedRequests = data.leaveRequests.filter(
    (item) => item.type === 'vacation' && item.status === 'approved',
  );

  function onYearChange(nextYear: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('year', nextYear);
    router.push(`${pathname}?${params.toString()}`);
  }

  function onBranchChange(nextBranch: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (!nextBranch) {
      params.delete('branchId');
    } else {
      params.set('branchId', nextBranch);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function exportExcel() {
    const header = `<h1>Urlaubsplan ${locationLabel} ${data.year}</h1>`;
    const monthTables = MONTH_LABELS.map((month, monthIndex) => {
      const dayCount = daysInMonth(data.year, monthIndex);
      const headerRow = Array.from({ length: dayCount }, (_, idx) => `<th>${idx + 1}</th>`).join('');
      const rows = data.employees
        .map((employee) => {
          const cells = Array.from({ length: dayCount }, (_, idx) => {
            const iso = monthIso(data.year, monthIndex, idx + 1);
            const entries = entriesByDate.get(iso) ?? [];
            const labels = entries
              .map((entry) => (entry.kind === 'request' ? entry.label : 'S'))
              .join(' | ');
            return `<td>${labels || ''}</td>`;
          }).join('');
          return `<tr><td>${employee.name}</td>${cells}</tr>`;
        })
        .join('');
      return `<h2>${month}</h2><table border="1"><thead><tr><th>Mitarbeiter</th>${headerRow}</tr></thead><tbody>${rows}</tbody></table>`;
    }).join('');

    const html = `<html><head><meta charset="utf-8" /></head><body>${header}${monthTables}</body></html>`;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `urlaubsplan-${data.year}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function exportPdf() {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(14);
    doc.text(`Urlaubsplan ${locationLabel} ${data.year}`, 12, 12);
    doc.setFontSize(9);

    let y = 20;
    doc.text('Genehmigte Urlaube', 12, y);
    y += 5;

    for (const item of approvedRequests) {
      const employee = employeeMap.get(item.employeeId);
      const label = `${employee?.initials ?? 'MA'} - ${item.employeeName ?? 'Mitarbeiter'}: ${formatDate(item.startDate)} bis ${formatDate(item.endDate)}`;
      const resolvedLabel = item.isUnpaid ? `${label} (unbezahlt ${item.unpaidDays} Tage)` : label;
      if (y > 190) {
        doc.addPage('a4', 'landscape');
        y = 15;
      }
      doc.text(resolvedLabel, 12, y);
      y += 5;
    }

    y += 4;
    if (y > 180) {
      doc.addPage('a4', 'landscape');
      y = 15;
    }
    doc.text('Legende:', 12, y);
    y += 5;
    for (const employee of data.employees) {
      if (y > 190) {
        doc.addPage('a4', 'landscape');
        y = 15;
      }
      doc.text(`${employee.initials} = ${employee.name}`, 12, y);
      y += 5;
    }

    doc.save(`urlaubsplan-${data.year}.pdf`);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Urlaubsplan {locationLabel} {data.year}</h1>
            <p className="text-sm text-slate-500">
              Jahreskalender mit Urlaubsanträgen, manuellen Einträgen und Urlaubssperren.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-slate-600">
              Jahr
              <select
                className="ml-2 rounded border border-slate-300 px-2 py-1"
                value={String(data.year)}
                onChange={(event) => onYearChange(event.target.value)}
              >
                {Array.from({ length: 7 }, (_, idx) => new Date().getFullYear() - 2 + idx).map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-600">
              Standort
              <select
                className="ml-2 rounded border border-slate-300 px-2 py-1"
                value={data.selectedBranchId ? String(data.selectedBranchId) : ''}
                onChange={(event) => onBranchChange(event.target.value)}
              >
                <option value="">Alle</option>
                {data.branchOptions.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={exportExcel}
              className="rounded bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Export Excel
            </button>
            <button
              type="button"
              onClick={exportPdf}
              className="rounded bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Export PDF
            </button>
          </div>
        </div>
      </section>

      <p className="text-xs text-slate-500 lg:hidden">
        Nach rechts wischen, um die Spalte <span className="font-semibold">Mitarbeiter & Urlaubstage</span> zu sehen.
      </p>

      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 lg:grid lg:grid-cols-[2fr_1fr] lg:gap-6 lg:overflow-visible lg:pb-0">
        <section className="min-w-full snap-start space-y-4 lg:min-w-0">
          {MONTH_LABELS.map((monthLabel, monthIndex) => (
            <article key={monthLabel} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-lg font-semibold text-slate-900">{monthLabel} {data.year}</h2>
              <div className="overflow-x-auto">
                <div className="grid min-w-[760px] grid-cols-7 gap-1.5">
                  {WEEKDAY_LABELS.map((weekday) => (
                    <div key={`${monthLabel}-${weekday}`} className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                      {weekday}
                    </div>
                  ))}

                  {(() => {
                    const firstDate = parseIsoDate(monthIso(data.year, monthIndex, 1));
                    const leading = firstDate ? (firstDate.getDay() + 6) % 7 : 0;
                    const placeholders = Array.from({ length: leading }, (_, idx) => (
                      <div key={`${monthLabel}-empty-${idx}`} className="h-11 rounded border border-dashed border-slate-200 bg-slate-50" />
                    ));
                    const dayCells = daysByMonth[monthIndex]!.map((isoDate) => {
                      const dayNum = Number.parseInt(isoDate.slice(-2), 10);
                      const badges = entriesByDate.get(isoDate) ?? [];
                      return (
                        <button
                          key={isoDate}
                          type="button"
                          onClick={() => setSelectedDate(isoDate)}
                          className="min-h-11 rounded border border-slate-200 bg-white p-1 text-left hover:border-brand/60"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-700">{dayNum}</span>
                            <span className="text-[10px] text-slate-400">{badges.length}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {badges.slice(0, 6).map((badge) => (
                              <span
                                key={badge.id}
                                title={badge.title}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  if (badge.kind === 'request') {
                                    setSelectedRequest(badge.request);
                                  }
                                }}
                                className="inline-flex min-w-5 items-center justify-center rounded px-1 text-[10px] font-semibold"
                                style={{
                                  backgroundColor: badge.background,
                                  color: badge.text,
                                  border: `1px solid ${badge.border}`,
                                }}
                              >
                                {badge.label}
                              </span>
                            ))}
                          </div>
                        </button>
                      );
                    });
                    return [...placeholders, ...dayCells];
                  })()}
                </div>
              </div>
            </article>
          ))}
        </section>

        <aside className="min-w-full snap-start space-y-4 lg:min-w-0">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Mitarbeiter & Urlaubstage</h2>
            <p className="mt-1 text-xs text-slate-500">
              Urlaubstage pro Jahr, Resturlaub und verfügbarer Rest (Feiertage werden nicht als Urlaubstage gezählt).
            </p>
            <div className="mt-3 space-y-2">
              {data.employees.map((employee) => (
                <div key={employee.employeeId} className="rounded border border-slate-200 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-white"
                        style={{ backgroundColor: employee.color }}
                      >
                        {employee.initials}
                      </span>
                      <span className="text-sm font-medium text-slate-800">{employee.name}</span>
                    </div>
                    <span className="text-xs text-slate-500">verfügbar {employee.availableDays}</span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-slate-600">
                    <dt>Urlaubstage/Jahr</dt>
                    <dd className="text-right font-medium text-slate-800">{employee.annualDays}</dd>
                    <dt>Resturlaub Vorjahr</dt>
                    <dd className="text-right font-medium text-slate-800">{employee.carryDays}</dd>
                    <dt>Bereits genommene Urlaubstage ({data.year})</dt>
                    <dd className="text-right font-medium text-slate-800">{employee.takenDays}</dd>
                    <dt>Angefragt</dt>
                    <dd className="text-right font-medium text-slate-800">{employee.pendingDays}</dd>
                  </dl>
                  {employee.carryExpiryDate ? (
                    <p className="mt-1 text-[11px] text-amber-700">Resturlaub aus Vorjahr bis {formatDate(employee.carryExpiryDate)}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Urlaubssperren</h2>
            <div className="mt-2 space-y-2">
              {data.locks.length === 0 ? (
                <p className="text-sm text-slate-500">Keine Urlaubssperren vorhanden.</p>
              ) : (
                data.locks.map((lock) => (
                  <form key={lock.id} action={deactivateLockAction} className="rounded border border-slate-200 p-2">
                    <input type="hidden" name="lock_id" value={lock.id} />
                    <p className="text-sm font-medium text-slate-800">
                      {formatDate(lock.start_date)} - {formatDate(lock.end_date)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {lock.branch_name ? lock.branch_name : 'Global'}{lock.reason ? ` · ${lock.reason}` : ''}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-semibold ${lock.is_active === 1 ? 'bg-rose-100 text-rose-700' : 'bg-slate-200 text-slate-600'}`}
                      >
                        {lock.is_active === 1 ? 'Aktiv' : 'Inaktiv'}
                      </span>
                      {lock.is_active === 1 ? (
                        <button type="submit" className="rounded bg-slate-700 px-2 py-1 text-xs text-white hover:bg-slate-600">
                          Deaktivieren
                        </button>
                      ) : null}
                    </div>
                  </form>
                ))
              )}
            </div>
            {deactivateLockState.message ? (
              <p className={`mt-2 text-xs ${deactivateLockState.status === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>
                {deactivateLockState.message}
              </p>
            ) : null}
          </section>
        </aside>
      </div>

      {selectedRequest ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-xl rounded-xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Urlaubsantrag bearbeiten</h3>
                <p className="text-sm text-slate-600">
                  {selectedRequest.employeeName ?? `Mitarbeiter #${selectedRequest.employeeId}`} · {formatDate(selectedRequest.startDate)} bis {formatDate(selectedRequest.endDate)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRequest(null)}
                className="rounded border border-slate-300 px-2 py-1 text-sm text-slate-600"
              >
                Schließen
              </button>
            </div>

            <form action={decisionAction} className="mt-4 space-y-3">
              <input type="hidden" name="request_id" value={selectedRequest.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm text-slate-600">
                  Von
                  <input
                    type="date"
                    name="range_start"
                    value={decisionRangeStart}
                    min={selectedRequest.startDate}
                    max={selectedRequest.endDate}
                    onChange={(event) => setDecisionRangeStart(event.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                    required
                  />
                </label>
                <label className="text-sm text-slate-600">
                  Bis
                  <input
                    type="date"
                    name="range_end"
                    value={decisionRangeEnd}
                    min={selectedRequest.startDate}
                    max={selectedRequest.endDate}
                    onChange={(event) => setDecisionRangeEnd(event.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                    required
                  />
                </label>
              </div>
              <label className="text-sm text-slate-600">
                Notiz (bei Ablehnung empfohlen)
                <textarea name="admin_note" rows={2} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
              </label>

              <div className="flex flex-wrap gap-2">
                {selectedRequest.status !== 'approved' ? (
                  <button
                    type="submit"
                    name="decision"
                    value="approve"
                    className="rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
                  >
                    Genehmigen
                  </button>
                ) : null}
                {selectedRequest.status !== 'rejected' ? (
                  <button
                    type="submit"
                    name="decision"
                    value="reject"
                    className="rounded bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-500"
                  >
                    Ablehnen
                  </button>
                ) : null}
              </div>
            </form>

            {decisionState.message ? (
              <p className={`mt-3 text-sm ${decisionState.status === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>
                {decisionState.message}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {selectedDate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-xl rounded-xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Eintrag für {formatDate(selectedDate)}</h3>
                <p className="text-sm text-slate-600">Manuellen Urlaub eintragen oder Urlaubssperre setzen.</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDate(null)}
                className="rounded border border-slate-300 px-2 py-1 text-sm text-slate-600"
              >
                Schließen
              </button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <form ref={manualFormRef} action={manualAction} className="space-y-2 rounded border border-slate-200 p-3">
                <h4 className="text-sm font-semibold text-slate-900">Urlaub manuell eintragen</h4>
                <input type="hidden" name="allow_unpaid" value={manualAllowUnpaid ? '1' : '0'} />
                <label className="block text-sm text-slate-600">
                  Mitarbeiter
                  <select name="employee_id" className="mt-1 w-full rounded border border-slate-300 px-2 py-1" required>
                    <option value="">Bitte wählen</option>
                    {data.employees.map((employee) => (
                      <option key={`manual-${employee.employeeId}`} value={employee.employeeId}>
                        {employee.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-sm text-slate-600">
                    Von
                    <input type="date" name="start_date" defaultValue={selectedDate} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" required />
                  </label>
                  <label className="text-sm text-slate-600">
                    Bis
                    <input type="date" name="end_date" defaultValue={selectedDate} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" required />
                  </label>
                </div>
                <label className="block text-sm text-slate-600">
                  Notiz
                  <input type="text" name="note" className="mt-1 w-full rounded border border-slate-300 px-2 py-1" placeholder="Optional" />
                </label>
                <button type="submit" className="rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
                  Urlaub speichern
                </button>
                {manualState.message ? (
                  <p className={`text-xs ${manualState.status === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>
                    {manualState.message}
                  </p>
                ) : null}
              </form>

              <form action={lockAction} className="space-y-2 rounded border border-slate-200 p-3">
                <h4 className="text-sm font-semibold text-slate-900">Urlaubssperre setzen</h4>
                <label className="block text-sm text-slate-600">
                  Standort
                  <select
                    name="branch_id"
                    defaultValue={data.selectedBranchId ? String(data.selectedBranchId) : ''}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                  >
                    <option value="">Global</option>
                    {data.branchOptions.map((branch) => (
                      <option key={`lock-${branch.id}`} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-sm text-slate-600">
                    Von
                    <input type="date" name="start_date" defaultValue={selectedDate} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" required />
                  </label>
                  <label className="text-sm text-slate-600">
                    Bis
                    <input type="date" name="end_date" defaultValue={selectedDate} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" required />
                  </label>
                </div>
                <label className="block text-sm text-slate-600">
                  Grund
                  <input type="text" name="reason" className="mt-1 w-full rounded border border-slate-300 px-2 py-1" placeholder="z. B. Weihnachtsgeschäft" />
                </label>
                <button type="submit" className="rounded bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                  Sperre speichern
                </button>
                {lockState.message ? (
                  <p className={`text-xs ${lockState.status === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>
                    {lockState.message}
                  </p>
                ) : null}
              </form>
            </div>
          </div>
        </div>
      ) : null}

      <p className="text-xs text-slate-500">
        Hinweis: Entscheidungen basieren auf den vorhandenen Urlaubs- und Antragsdaten. Für rechtliche Bewertung gelten interne Richtlinien und gesetzliche Vorgaben.
      </p>
    </div>
  );
}
