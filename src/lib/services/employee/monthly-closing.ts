import { getMonthlyClosing } from '@/lib/data/monthly-closings';

export async function isMonthClosedForEmployee(
  employeeId: number,
  year: number,
  month: number
): Promise<boolean> {
  const record = await getMonthlyClosing(employeeId, year, month);
  return record?.status === 'closed';
}
