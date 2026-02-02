import { getPlanHoursForDayFromPlan, type ShiftPlan } from '@/lib/services/shift-plan';

describe('getPlanHoursForDayFromPlan', () => {
  const samplePlan: ShiftPlan = {
    employeeId: 1,
    days: {
      '2025-01-06': { start: '08:00', end: '16:00', requiredPauseMinutes: 0 },
      '2025-01-07': { start: '08:30', end: '16:30', requiredPauseMinutes: 30 },
    },
  };

  it('returns soll hours subtracting legal pause', () => {
    const info = getPlanHoursForDayFromPlan(samplePlan, '2025-01-06');
    expect(info).not.toBeNull();
    expect(info?.rawHours).toBeCloseTo(8);
    expect(info?.sollHours).toBeCloseTo(7.5); // >6h => 0.5h gesetzliche Pause
  });

  it('respects hinterlegte Pflichtpause', () => {
    const info = getPlanHoursForDayFromPlan(samplePlan, '2025-01-07');
    expect(info).not.toBeNull();
    expect(info?.rawHours).toBeCloseTo(8);
    // Gesetzliche Pause ebenfalls 30 Minuten, also insgesamt 30 Minuten Abzug
    expect(info?.sollHours).toBeCloseTo(7.5);
  });

  it('returns null when kein Eintrag existiert', () => {
    const info = getPlanHoursForDayFromPlan(samplePlan, '2025-01-05');
    expect(info).toBeNull();
  });
});
