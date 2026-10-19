import { describe, expect, it } from 'vitest';
import { Matrix4, SphereGeometry, Vector3 } from 'three';
import { createEarthOrientation, createEarthViewSnapshot, ecefToEqj, eqjToEcef, AU_KM, EARTH_RADIUS_KM, MOON_RADIUS_KM } from '../src/astronomy/earthOrientation';
import { createSolarSnapshot } from '../src/astronomy/planetEphemeris';
import { DISPLAY_SCALE, earthFocusPositionKm, earthSphereBasis, earthTextureDirection } from '../src/render/visualModel';

const components = (p: { x: number; y: number; z: number }) => [p.x, p.y, p.z];

describe('calibrated Earth orientation', () => {
  it('agrees with the independent ERFA/SOFA C2t06a 2006 epoch within 1 arcsecond', () => {
    // Reference: liberfa/erfa src/t_erfa_c.c t_c2t06a, MJD UT1=TT=53736.0.
    // Rows of celestial→terrestrial are columns of its inverse. Its nonzero
    // polar motion (xp=.0526", yp=.3837") and frame bias are inside 5e-6 rad.
    const reference = [
      [-.1810332128305897282, .9834769806938592296, .00006555550962998436505],
      [-.9834768134136214897, -.1810332203649130832, .0005749800844905594110],
      [.0005773474024748545878, .00003961816829632690581, .9999998325501747785],
    ];
    const basis = createEarthOrientation(new Date('2006-01-01T00:00:00Z'));
    [basis.greenwich, basis.east, basis.north].forEach((axis, index) => {
      expect(Math.hypot(...components(axis).map((v, i) => v - reference[index]![i]!))).toBeLessThan(5e-6);
    });
  });

  it.each(['2000-01-01T12:00:00Z', '2026-10-19T00:00:00Z', '2100-12-31T23:59:59Z'])('is orthonormal and preserves km at %s', epoch => {
    const orientation = createEarthOrientation(new Date(epoch));
    const axes = [orientation.greenwich, orientation.east, orientation.north];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const dot = components(axes[i]!).reduce((sum, value, k) => sum + value * components(axes[j]!)[k]!, 0);
      expect(dot).toBeCloseTo(i === j ? 1 : 0, 12);
    }
    const km = { x: 5000, y: -1200, z: 4800 };
    const restored = eqjToEcef(ecefToEqj(km, orientation), orientation);
    components(restored).forEach((v, i) => expect(v).toBeCloseTo(components(km)[i]!, 9));
    expect(orientation.epoch).toBe(new Date(epoch).toISOString());
    expect(Object.isFrozen(orientation.north)).toBe(true);
  });

  it('rotates eastward by a sidereal quarter-turn in six UTC hours, including date rollover', () => {
    const a = createEarthOrientation(new Date('2026-10-18T22:00:00Z'));
    const b = createEarthOrientation(new Date('2026-10-19T04:00:00Z'));
    const rotated = eqjToEcef(b.greenwich, a);
    expect(rotated.y).toBeGreaterThan(.9999);
    expect(Math.abs(rotated.x)).toBeLessThan(.005);
    expect(Math.abs(rotated.z)).toBeLessThan(.00001);
    // EQJ is an equatorial frame. Adding another 23.44° tilt is incorrect.
    expect(a.north.z).toBeGreaterThan(.9999);
    expect(() => createEarthOrientation(new Date(NaN))).toThrow(RangeError);
  });
});

describe('Earth texture calibration and physical geocentric scale', () => {
  it('maps the actual SphereGeometry UVs to Greenwich, east and north without mirroring', () => {
    const geometry = new SphereGeometry(1, 8, 4), uv = geometry.getAttribute('uv'), vertices = geometry.getAttribute('position');
    const orientation = createEarthOrientation(new Date('2026-10-19T00:00:00Z'));
    const axes = earthSphereBasis(orientation).map(p => new Vector3(p.x, p.y, p.z));
    const matrix = new Matrix4().makeBasis(axes[0]!, axes[1]!, axes[2]!);
    for (let i = 0; i < vertices.count; i++) {
      const expected = ecefToEqj(earthTextureDirection(uv.getX(i), uv.getY(i)), orientation);
      const actual = new Vector3(vertices.getX(i), vertices.getY(i), vertices.getZ(i)).applyMatrix4(matrix);
      expect(actual.distanceTo(new Vector3(expected.x, expected.z, -expected.y))).toBeLessThan(1e-7);
    }
    expect(earthTextureDirection(.5, .5).x).toBeCloseTo(1, 12);
    expect(earthTextureDirection(.75, .5).y).toBeCloseTo(1, 12);
    expect(earthTextureDirection(.5, 1).z).toBeCloseTo(1, 12);
    expect(matrix.determinant()).toBeCloseTo(1, 12);
    geometry.dispose();
  });

  it('uses the same snapshot epoch and one km scale for Earth, Moon and their separation', () => {
    const solar = createSolarSnapshot(new Date('2026-10-19T00:00:00Z'));
    const earth = createEarthViewSnapshot(solar);
    expect(earth.epoch).toBe(solar.epoch);
    expect(earth.orientation.epoch).toBe(solar.epoch);
    expect(earth.origin).toBe('Earth'); expect(earth.units).toBe('km');
    components(earth.moonPositionKm).forEach((v, i) => expect(v).toBe(components(solar.moonGeocentricAU)[i]! * AU_KM));
    const moonDistanceKm = Math.hypot(...components(earth.moonPositionKm));
    expect(moonDistanceKm).toBeGreaterThan(350_000); expect(moonDistanceKm).toBeLessThan(410_000);
    expect(Math.hypot(...components(earthFocusPositionKm(earth.moonPositionKm))) / (EARTH_RADIUS_KM * DISPLAY_SCALE.earthFocusKmToScene))
      .toBeCloseTo(moonDistanceKm / EARTH_RADIUS_KM, 12);
    expect(MOON_RADIUS_KM / EARTH_RADIUS_KM).toBeCloseTo(.2727, 3);
    expect(Math.hypot(...components(earth.sunDirection))).toBeCloseTo(1, 12);
    const dotSun = components(earth.sunDirection).reduce((sum, v, i) => sum + v * components(solar.planets.Earth)[i]!, 0);
    expect(dotSun).toBeLessThan(-.9);
    expect(Object.isFrozen(earth.moonPositionKm)).toBe(true);
  });
});
