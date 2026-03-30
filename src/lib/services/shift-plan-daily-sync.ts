import { getDailyDay } from '@/lib/data/daily-days';
import { deriveCodeFromPlanLabel } from '@/lib/services/shift-plan-hours';
import { isHolidayIsoDate } from '@/lib/services/holidays';

export type ShiftPlanDailyDaySyncInput = {
  tenantId: string;
  employeeId: number;
  isoDate: string;
  label: string | null;
  holidayRegion?: string | null;
};

export async function syncShiftPlanAbsenceWithDailyDay({
  tenantId,
  employeeId,
  isoDate,
  label,
  holidayRegion,
}: ShiftPlanDailyDaySyncInput): Promise<void> {
  let derivedCode = deriveCodeFromPlanLabel(label);
  const existing = await getDailyDay(employeeId, isoDate);
  const existingActor = (existing?.admin_last_change_by ?? '').trim().toLowerCase();
  const isShiftPlanManaged = existingActor.includes('schichtplan');

  if (derivedCode === 'U' && holidayRegion) {
    const holidayInfo = isHolidayIsoDate(isoDate, holidayRegion);
    if (holidayInfo.isHoliday) {
      derivedCode = 'FT';
    }
  }

  const { deleteTimeEntry, saveTimeEntry } = await import('./time-entry');

  if (!derivedCode) {
    if (existing && isShiftPlanManaged) {
      await deleteTimeEntry(tenantId, employeeId, isoDate);
    }
    return;
  }

  if (existing && !isShiftPlanManaged) {
    return;
  }

  try {
    await saveTimeEntry({
      tenantId,
      employeeId,
      dayDate: isoDate,
      code: derivedCode,
      schicht: label ?? '',
      kommt1: '00:00',
      geht1: '00:00',
      kommt2: null,
      geht2: null,
      pause: 'Keine',
      mittag: 'Nein',
      performedBy: { type: 'admin', id: null, name: 'Schichtplan' },
    });
  } catch (error) {
    console.error('Failed to synchronise shift plan entry', { employeeId, isoDate, label, error });
  }
}
