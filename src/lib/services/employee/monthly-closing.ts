import { getMonthlyClosing } from '@/lib/data/monthly-closings';

export function isMonthClosedForEmployee(employeeId: number, year: number, month: number): boolean {
  const record = getMonthlyClosing(employeeId, year, month);
  return record?.status === 'closed';
}
