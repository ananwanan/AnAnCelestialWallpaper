import { describe, expect, it } from 'vitest';
import { formatUtcInput, parseUtcInput } from '../src/app/utcInput';

describe('UTC datetime-local controls', () => {
  it('interprets a bare input as UTC even on local daylight-saving transition dates', () => {
    expect(parseUtcInput('2026-03-08T02:30')?.toISOString()).toBe('2026-03-08T02:30:00.000Z');
    expect(parseUtcInput('2026-11-01T01:30:45')?.toISOString()).toBe('2026-11-01T01:30:45.000Z');
  });

  it.each(['1962-01-01T00:00:00', '2000-02-29T23:59:59', '2026-10-19T13:45:06', '2100-12-31T23:59:59'])(
    'round trips %s at second precision', (value) => {
      const parsed = parseUtcInput(value);
      expect(parsed).not.toBeNull();
      expect(formatUtcInput(parsed!)).toBe(value);
      expect(parseUtcInput(formatUtcInput(parsed!))?.getTime()).toBe(parsed!.getTime());
    },
  );

  it('discards subsecond display precision without changing UTC seconds', () => {
    const value = new Date('2026-10-19T13:45:06.789Z');
    expect(formatUtcInput(value)).toBe('2026-10-19T13:45:06');
    expect(parseUtcInput(formatUtcInput(value))?.getTime()).toBe(value.getTime() - 789);
  });

  it.each([
    '', '2026-10-19', '2026-10-19 12:00', '2026-10-19T12:00Z', '2026-10-19T12:00+08:00',
    '2026-10-19T12:00:00.000', '2026-1-01T01:00', ' 2026-10-19T12:00', '2026-10-19T12:00 ',
    '2026-02-29T12:00', '2100-02-29T12:00', '2026-04-31T00:00', '2026-00-01T00:00',
    '2026-13-01T00:00', '2026-10-00T00:00', '2026-10-19T24:00', '2026-10-19T12:60',
    '2026-10-19T12:00:60', '1961-12-31T23:59:59', '2101-01-01T00:00',
  ])('rejects invalid, ambiguous or out-of-range input %s', (value) => {
    expect(parseUtcInput(value)).toBeNull();
  });

  it('fails explicitly when asked to format an invalid date', () => {
    expect(() => formatUtcInput(new Date(NaN))).toThrow(RangeError);
  });
});
