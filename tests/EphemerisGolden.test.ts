import { describe, expect, it } from 'vitest';
import referenceJson from './fixtures/jpl-snapshot-2026-10-19.json';
import provenance from './fixtures/jpl-snapshot-2026-10-19.source.json';
import { EPHEMERIS_IDS, compareEphemerisSnapshot, validateEphemerisSnapshot, type EphemerisBodyId, type EphemerisVector } from '../src/astronomy/ephemerisSnapshot';
import { createSolarSnapshot } from '../src/astronomy/planetEphemeris';

const AU_KM = 149_597_870.7;
const reference = validateEphemerisSnapshot(referenceJson, Date.parse(provenance.recordedAt));
const epoch = new Date(reference.epoch);
const local = createSolarSnapshot(epoch);
const separation = (a: EphemerisVector, b: EphemerisVector) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function localHeliocentric(id: EphemerisBodyId, at: Date): EphemerisVector {
  expect(at.toISOString()).toBe(reference.epoch);
  if (id !== 'Moon') return local.planets[id];
  return { x: local.planets.Earth.x + local.moonGeocentricAU.x, y: local.planets.Earth.y + local.moonGeocentricAU.y, z: local.planets.Earth.z + local.moonGeocentricAU.z };
}

describe('captured JPL nine-body reference at 2026-10-19T00:00:00Z', () => {
  it('compares all local Sun-centered EQJ positions at the exact captured ICRF UTC epoch', () => {
    expect(reference.states.map((state) => state.id)).toEqual(EPHEMERIS_IDS);
    expect(reference.origin).toBe('Sun'); expect(reference.units).toBe('AU, AU/day');
    expect(reference.referenceFrame).toBe('ICRF'); expect(local.referenceFrame).toBe('EQJ/J2000');
    expect(local.epoch).toBe(reference.epoch);
    const comparison = compareEphemerisSnapshot(reference, localHeliocentric);
    for (const check of comparison.checks) expect(check.residualAU, `${check.id}: ICRF/EQJ model sanity tolerance`).toBeLessThanOrEqual(check.toleranceAU);
    expect(comparison.passed).toBe(true);
    const worst = [...comparison.checks].sort((a, b) => b.residualAU - a.residualAU)[0]!;
    console.info('Captured JPL/local comparison', JSON.stringify({ worstBody: worst.id, maxResidualAU: worst.residualAU, maxResidualKm: worst.residualAU * AU_KM,
      toleranceAU: worst.toleranceAU, policy: '1 arcminute times heliocentric distance + 1e-5 AU; ICRF and EQJ are not identical' }));
  });

  it('adds the Earth parent exactly once for Moon and separately checks the geocentric reference', () => {
    const earth = reference.states.find((state) => state.id === 'Earth')!.positionAU;
    const moon = reference.states.find((state) => state.id === 'Moon')!.positionAU;
    const expectedGeocentric = { x: moon.x - earth.x, y: moon.y - earth.y, z: moon.z - earth.z };
    const geocentricRadius = Math.hypot(expectedGeocentric.x, expectedGeocentric.y, expectedGeocentric.z);
    const toleranceAU = geocentricRadius * Math.PI / (180 * 60) + 1e-7;
    const residualAU = separation(local.moonGeocentricAU, expectedGeocentric);
    expect(geocentricRadius).toBeGreaterThan(.0023); expect(geocentricRadius).toBeLessThan(.0028);
    expect(residualAU).toBeLessThanOrEqual(toleranceAU);
    const unparented = compareEphemerisSnapshot(reference, (id, at) => id === 'Moon' ? local.moonGeocentricAU : localHeliocentric(id, at));
    expect(unparented.checks.find((check) => check.id === 'Moon')!.passed).toBe(false);
    expect(unparented.passed).toBe(false);
    console.info('Captured JPL Moon parent comparison', JSON.stringify({ geocentricResidualAU: residualAU, geocentricResidualKm: residualAU * AU_KM, toleranceAU }));
  });
});
