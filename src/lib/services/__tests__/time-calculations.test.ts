import {
  calcHoursLegalGermany,
  calculateIstHours,
  calculateLegalPauseHours,
  parseTimeString,
  pauseStringToHours,
  timeToDecimalHours,
} from '@/lib/services/time-calculations';

describe('parseTimeString', () => {
  it('parses valid hh:mm strings', () => {
    expect(parseTimeString('08:30')).toEqual({ hour: 8, minute: 30 });
    expect(parseTimeString('00:00')).toEqual({ hour: 0, minute: 0 });
  });

  it('returns null for invalid formats', () => {
    expect(parseTimeString('')).toBeNull();
    expect(parseTimeString('25:00')).toBeNull();
    expect(parseTimeString('08-30')).toBeNull();
  });
});

describe('pauseStringToHours', () => {
  it('maps textual pauses to hours', () => {
    expect(pauseStringToHours('30min')).toBeCloseTo(0.5);
    expect(pauseStringToHours('45min.')).toBeCloseTo(0.75);
  });

  it('handles special values', () => {
    expect(pauseStringToHours('Keine')).toBe(0);
    expect(pauseStringToHours('0min.')).toBe(0);
    expect(pauseStringToHours('abc')).toBe(0);
  });
});

describe('calculateLegalPauseHours', () => {
  it('applies ArbZG thresholds', () => {
    expect(calculateLegalPauseHours(5.5)).toBe(0);
    expect(calculateLegalPauseHours(6.5)).toBe(0.5);
    expect(calculateLegalPauseHours(9.5)).toBe(0.75);
  });
});

describe('calculateIstHours', () => {
  it('enforces legal minimum pause', () => {
    const result = calculateIstHours('08:00', '12:00', '12:30', '17:00', 'keine');
    expect(result.rawHours).toBeCloseTo(8.5);
    expect(result.effectivePauseHours).toBeCloseTo(0.5);
    expect(result.netHours).toBeCloseTo(8);
  });

  it('respects manual pause when longer than legal', () => {
    const result = calculateIstHours('08:00', '12:00', '12:30', '17:00', '60min');
    expect(result.effectivePauseHours).toBeCloseTo(1);
    expect(result.netHours).toBeCloseTo(7.5);
  });

  it('handles overnight spans', () => {
    const result = calculateIstHours('22:00', '23:59', '00:15', '02:00', '15min');
    expect(result.rawHours).toBeCloseTo(3.73, 1);
    expect(result.netHours).toBeGreaterThan(0);
  });
});

describe('calcHoursLegalGermany', () => {
  it('applies legal deductions for single span', () => {
    const start = parseTimeString('08:00');
    const end = parseTimeString('17:00');
    expect(calcHoursLegalGermany(start, end)).toBeCloseTo(8.5);
  });
});

describe('timeToDecimalHours', () => {
  it('converts parsed time to decimal', () => {
    expect(timeToDecimalHours(parseTimeString('01:30'))).toBeCloseTo(1.5);
  });
});
