import { describe, expect, it } from 'vitest';
import { bodyQuery, dayStart, interpolateSeries, normalizedEpoch, parseHorizonsSeries, type HorizonsSample } from '../src/ephemeris';
import { REAL_EARTH_BODY } from './normalizedFixture';

const START = Date.UTC(2026, 9, 19);
describe('strict Horizons daily state parser', () => {
  it('parses the captured authoritative Earth ICRF/UT/AU-D body and preserves reference vectors', () => {
    const states = parseHorizonsSeries(REAL_EARTH_BODY, 'Earth', START);
    expect(states).toHaveLength(25); expect(states[0]!.epochMs).toBe(START);
    expect(states[0]!.positionAU.x).toBeCloseTo(0.9009991381606978, 14);
    expect(states[0]!.positionAU.y).toBeCloseTo(0.3899567165297788, 14);
    expect(states[0]!.positionAU.z).toBeCloseTo(0.1690342249136131, 14);
    expect(states[0]!.velocityAUPerDay.x).toBeCloseTo(-0.007624568810009288, 15);
    expect(states.at(-1)!.epochMs).toBe(START + 86_400_000);
  });
  it.each([
    ['Earth (399)', 'Earth (499)'], ['Sun (10)', 'Earth (399)'], ['BODY CENTER', 'OTHER SITE'],
    ['AU-D', 'KM-S'], ['Gregorian', 'Mixed'], ['GEOMETRIC cartesian states', 'APPARENT cartesian states'],
    ['2 (position and velocity)', '3 (position and velocity)'], ['Reference frame : ICRF', 'Reference frame : Ecliptic J2000'],
    ['60 minutes', '120 minutes'], ['JDUT', 'JDTDB'], ['Calendar Date (UT )', 'Calendar Date (TDB)'],
    ['2461332.500000000', '2461332.600000000'], ['2026-Oct-19 01:00:00.0000', '2026-Oct-19 02:00:00.0000'],
    ['9.009991381606978E-01', 'NaN'], ['"1.2"', '"1.3"'],
  ])('rejects mismatched metadata, malformed rows and epochs %s', (from, to) => {
    expect(() => parseHorizonsSeries(REAL_EARTH_BODY.replace(from, to), 'Earth', START)).toThrow();
  });
  it('rejects a different requested body or source time window', () => {
    expect(() => parseHorizonsSeries(REAL_EARTH_BODY, 'Moon', START)).toThrow();
    expect(() => parseHorizonsSeries(REAL_EARTH_BODY, 'Earth', START + 3_600_000)).toThrow();
  });
  it('canonicalizes all requests for a UTC day to a shared per-body source query', () => {
    const at = START + 12_345;
    expect(dayStart(at)).toBe(START);
    expect(new URLSearchParams(bodyQuery('Moon', START)).get('COMMAND')).toBe("'301'");
    expect(normalizedEpoch(new URL(`https://example.com/api/ephemeris?at=${new Date(at).toISOString()}`))).toBe(at);
    for (const query of ['', 'at=notUTC', `at=${new Date(at).toISOString()}&at=${new Date(at).toISOString()}`, `at=${new Date(at).toISOString()}&url=https://evil.example`]) {
      expect(() => normalizedEpoch(new URL(`https://example.com/api/ephemeris?${query}`))).toThrow();
    }
  });
});

describe('bounded cubic Hermite state interpolation', () => {
  it('reproduces an analytic cubic and its velocity using AU/day units', () => {
    const sample = (timeDays: number): HorizonsSample => ({ epochMs: START + timeDays * 86_400_000,
      positionAU: { x: 1 + timeDays ** 3, y: 2 + 2 * timeDays ** 2, z: 3 - timeDays },
      velocityAUPerDay: { x: 3 * timeDays ** 2, y: 4 * timeDays, z: -1 } });
    const samples = [sample(0), sample(1 / 24)];
    const time = 1 / 48;
    const result = interpolateSeries(samples, START + time * 86_400_000);
    expect(result.positionAU.x).toBeCloseTo(1 + time ** 3, 14);
    expect(result.positionAU.y).toBeCloseTo(2 + 2 * time ** 2, 14);
    expect(result.velocityAUPerDay.x).toBeCloseTo(3 * time ** 2, 12);
    expect(result.velocityAUPerDay.y).toBeCloseTo(4 * time, 12);
    expect(result.velocityAUPerDay.z).toBeCloseTo(-1, 12);
  });
  it('preserves exact sample states and refuses extrapolation or gaps above one hour', () => {
    const states = parseHorizonsSeries(REAL_EARTH_BODY, 'Earth', START);
    expect(interpolateSeries(states, START).positionAU).toEqual(states[0]!.positionAU);
    expect(interpolateSeries(states, START + 86_400_000).velocityAUPerDay).toEqual(states.at(-1)!.velocityAUPerDay);
    expect(() => interpolateSeries(states, START - 1)).toThrow();
    expect(() => interpolateSeries(states, START + 86_400_001)).toThrow();
    expect(() => interpolateSeries([states[0]!, states[2]!], START + 3_600_000)).toThrow('one hour');
  });
});
