export const SHIFT_PLAN_DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type ShiftPlanDayKey = typeof SHIFT_PLAN_DAY_KEYS[number];

export const SHIFT_PLAN_DAY_LABELS: Record<ShiftPlanDayKey, string> = {
  mon: 'Montag',
  tue: 'Dienstag',
  wed: 'Mittwoch',
  thu: 'Donnerstag',
  fri: 'Freitag',
  sat: 'Samstag',
  sun: 'Sonntag',
};
