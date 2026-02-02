'use client';

import type { DailyDaySummary } from '@/lib/data/daily-days';
import type { ShiftPlanDay } from '@/lib/services/shift-plan';
import EmployeeEntriesSection from '@/app/mitarbeiter/EmployeeEntriesSection';
import type { EntryActionState } from '@/app/mitarbeiter/types';

type Props = {
  entries: DailyDaySummary[];
  closedMonths: string[];
  requiresMealFlag: boolean;
  minPauseUnder6Minutes: number;
  shiftPlan: Record<string, ShiftPlanDay>;
  federalState: string | null;
  employeeId: number;
  tillhubUserId?: string | null;
  createAction: (prevState: EntryActionState, formData: FormData) => Promise<EntryActionState>;
  createInitialState: EntryActionState;
  deleteAction: (prevState: EntryActionState, formData: FormData) => Promise<EntryActionState>;
  deleteInitialState: EntryActionState;
};

export default function AdminTimeEntriesPanel({
  entries,
  closedMonths,
  requiresMealFlag,
  minPauseUnder6Minutes,
  shiftPlan,
  federalState,
  employeeId,
  tillhubUserId,
  createAction,
  createInitialState,
  deleteAction,
  deleteInitialState,
}: Props) {
  const hiddenFields = {
    employeeId: String(employeeId),
    tillhubUserId: tillhubUserId ?? '',
  };

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-900">Tageserfassung (Admin)</h2>
        <p className="text-sm text-slate-500">
          Du kannst hier fehlende Einträge ergänzen oder bestehende korrigieren. Abgeschlossene Monate bleiben gesperrt.
        </p>
      </header>
      <EmployeeEntriesSection
        entries={entries}
        closedMonths={closedMonths}
        requiresMealFlag={requiresMealFlag}
        minPauseUnder6Minutes={minPauseUnder6Minutes}
        shiftPlan={shiftPlan}
        federalState={federalState}
        createAction={createAction}
        createInitialState={createInitialState}
        deleteAction={deleteAction}
        deleteInitialState={deleteInitialState}
        hiddenFields={hiddenFields}
      />
    </section>
  );
}
