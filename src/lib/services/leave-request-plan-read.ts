import {
  getPlanHoursForDay,
  getWeeklyFallbackPlanHoursForDay,
  type PlanHoursInfo,
} from '@/lib/services/shift-plan-hours';

export async function getLeaveRequestPlanHoursForDay(
  employeeId: number,
  isoDate: string,
): Promise<PlanHoursInfo | null> {
  return await getPlanHoursForDay(employeeId, isoDate, null);
}

export async function getLeaveRequestWeeklyFallbackPlanHoursForDay(
  employeeId: number,
  isoDate: string,
): Promise<PlanHoursInfo | null> {
  return await getWeeklyFallbackPlanHoursForDay(employeeId, isoDate, null);
}
