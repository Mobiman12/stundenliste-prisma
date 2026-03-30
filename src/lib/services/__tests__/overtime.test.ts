import { recalculateOvertime } from '@/lib/services/overtime';

const settings = {
  maxMinusHours: 10,
  maxOvertimeHours: 20,
};

describe('recalculateOvertime', () => {
  it('keeps entries unchanged when net matches plan', () => {
    const entries = [
      {
        dayDate: '2025-01-01',
        planHours: 8,
        kommt1: '08:00',
        geht1: '12:00',
        kommt2: '12:30',
        geht2: '17:00',
        pause: '30min',
        code: '',
        overtimeDelta: 0,
        forcedOverflow: 0,
      },
    ];

    const result = recalculateOvertime(entries, settings);
    expect(result.updatedDays).toHaveLength(0);
    expect(result.balanceHours).toBe(0);
  });

  it('accrues overtime when working longer than plan', () => {
    const entries = [
      {
        dayDate: '2025-01-01',
        planHours: 8,
        kommt1: '08:00',
        geht1: '12:00',
        kommt2: '12:30',
        geht2: '18:00',
        pause: '30min',
        code: '',
        overtimeDelta: 0,
        forcedOverflow: 0,
      },
    ];

    const result = recalculateOvertime(entries, settings);
    expect(result.updatedDays).toHaveLength(1);
    expect(result.updatedDays[0].overtimeDelta).toBeGreaterThan(0);
    expect(result.balanceHours).toBeGreaterThan(0);
  });

  it('deducts overtime when working less than plan', () => {
    const entries = [
      {
        dayDate: '2025-01-01',
        planHours: 8,
        kommt1: '08:00',
        geht1: '12:00',
        kommt2: '12:30',
        geht2: '15:30',
        pause: '30min',
        code: '',
        overtimeDelta: 0,
        forcedOverflow: 0,
      },
    ];

    const result = recalculateOvertime(entries, settings);
    expect(result.updatedDays).toHaveLength(1);
    expect(result.updatedDays[0].overtimeDelta).toBeLessThanOrEqual(0);
    expect(result.balanceHours).toBeLessThanOrEqual(0);
  });

  it('handles vacation days (code U)', () => {
    const entries = [
      {
        dayDate: '2025-01-01',
        planHours: 8,
        kommt1: '00:00',
        geht1: '00:00',
        kommt2: '00:00',
        geht2: '00:00',
        pause: 'Keine',
        code: 'U',
        vacationHours: 0,
      },
    ];

    const result = recalculateOvertime(entries, settings);
    expect(result.updatedDays).toHaveLength(1);
    expect(result.updatedDays[0].vacationHours).toBe(8);
    expect(result.updatedDays[0].overtimeDelta).toBeCloseTo(0);
  });

  it('sends overflow to payout bank when exceeding max overtime', () => {
    const customSettings = { maxMinusHours: 10, maxOvertimeHours: 1 };
    const entries = [
      {
        dayDate: '2025-01-01',
        planHours: 8,
        kommt1: '08:00',
        geht1: '12:00',
        kommt2: '12:30',
        geht2: '20:00',
        pause: '30min',
        code: '',
        overtimeDelta: 0,
        forcedOverflow: 0,
      },
    ];

    const result = recalculateOvertime(entries, customSettings);
    expect(result.updatedDays).toHaveLength(1);
    expect(result.updatedDays[0].forcedOverflow).toBeGreaterThan(0);
    expect(result.balanceHours).toBeLessThanOrEqual(customSettings.maxOvertimeHours);
    expect(result.payoutBankHours).toBeGreaterThan(0);
  });
});
