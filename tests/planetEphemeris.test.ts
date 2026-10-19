import { describe, expect, it } from 'vitest';
import { Body, HelioVector } from 'astronomy-engine';
import { createSolarSnapshot, sampleSolarTrajectories, PLANET_NAMES } from '../src/astronomy/planetEphemeris';

describe('immutable solar renderer snapshots', () => {
  const date = new Date('2026-10-19T12:00:00Z');
  it('gives all eight planets one explicit time, unit, origin and frame', () => {
    const snapshot = createSolarSnapshot(date);
    expect(snapshot.epoch).toBe('2026-10-19T12:00:00.000Z');
    expect(snapshot.referenceFrame).toBe('EQJ/J2000');
    expect(snapshot.origin).toBe('Sun'); expect(snapshot.units).toBe('AU');
    expect(Object.keys(snapshot.planets)).toEqual(PLANET_NAMES);
    expect(Object.isFrozen(snapshot)).toBe(true);
    for (const position of Object.values(snapshot.planets)) {
      expect(Object.isFrozen(position)).toBe(true);
      expect(Math.hypot(position.x, position.y, position.z)).toBeGreaterThan(.3);
      expect(Math.hypot(position.x, position.y, position.z)).toBeLessThan(31);
    }
  });
  it('keeps Moon geocentric and reconstructs its independently exposed heliocentric vector', () => {
    const snapshot = createSolarSnapshot(date), expectedMoon = HelioVector(Body.Moon, date);
    const earth = snapshot.planets.Earth, moon = snapshot.moonGeocentricAU;
    expect(Math.hypot(moon.x, moon.y, moon.z)).toBeGreaterThan(.0023);
    expect(Math.hypot(moon.x, moon.y, moon.z)).toBeLessThan(.0028);
    for (const axis of ['x', 'y', 'z'] as const) expect(earth[axis] + moon[axis]).toBeCloseTo(expectedMoon[axis], 12);
  });
  it('has continuous positions across a wall-clock second', () => {
    const before = createSolarSnapshot(date), after = createSolarSnapshot(new Date(date.getTime() + 1000));
    for (const name of PLANET_NAMES) {
      const p = before.planets[name], q = after.planets[name];
      expect(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)).toBeLessThan(.000001);
    }
  });
  it('samples actual ephemerides with shared midpoint positions and independent Moon origin', () => {
    const snapshot = createSolarSnapshot(date), trajectories = sampleSolarTrajectories(date, 48);
    expect(Object.isFrozen(trajectories.planets.Earth.positions)).toBe(true);
    for (const name of PLANET_NAMES) {
      const trajectory = trajectories.planets[name];
      expect(trajectory.positions).toHaveLength(49);
      expect(trajectory.positions[24]).toEqual(snapshot.planets[name]);
      expect(Date.parse(trajectory.validFrom)).toBeLessThan(date.getTime());
      expect(Date.parse(trajectory.validUntil)).toBeGreaterThan(date.getTime());
    }
    expect(trajectories.moonGeocentric.positions[24]).toEqual(snapshot.moonGeocentricAU);
    expect(trajectories.planets.Mercury.positions.some(p => Math.abs(p.z) > .01)).toBe(true);
  });
  it('rejects unbounded trajectory budgets or invalid dates', () => {
    for (const segments of [0, 20, 513, 1.5]) expect(() => sampleSolarTrajectories(date, segments)).toThrow(RangeError);
    expect(() => createSolarSnapshot(new Date(NaN))).toThrow(RangeError);
  });
});
