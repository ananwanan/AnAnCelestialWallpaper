import { Body, HelioVector, GeoMoon } from 'astronomy-engine';

export type PlanetName = 'Mercury' | 'Venus' | 'Earth' | 'Mars' | 'Jupiter' | 'Saturn' | 'Uranus' | 'Neptune';
export interface Vec3Au { readonly x: number; readonly y: number; readonly z: number; }

export interface SolarSnapshot {
  readonly epoch: string;
  readonly referenceFrame: 'EQJ/J2000';
  readonly origin: 'Sun';
  readonly units: 'AU';
  readonly planets: Readonly<Record<PlanetName, Vec3Au>>;
  readonly moonGeocentricAU: Vec3Au;
}

export interface OrbitalTrajectory {
  readonly validFrom: string;
  readonly validUntil: string;
  readonly positions: readonly Vec3Au[];
}

export interface SolarTrajectories {
  readonly epoch: string;
  readonly referenceFrame: 'EQJ/J2000';
  readonly origin: 'Sun';
  readonly units: 'AU';
  readonly planets: Readonly<Record<PlanetName, OrbitalTrajectory>>;
  /** Earth-centered EQJ/AU, never silently substituted for heliocentric positions. */
  readonly moonGeocentric: OrbitalTrajectory;
}

export const PLANET_NAMES: PlanetName[] = [
  'Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune',
];

const PERIOD_DAYS: Record<PlanetName, number> = {
  Mercury: 87.969, Venus: 224.701, Earth: 365.256, Mars: 686.980,
  Jupiter: 4332.589, Saturn: 10759.22, Uranus: 30685.4, Neptune: 60189,
};

/** Heliocentric EQJ/J2000 coordinates in AU; independent of Three.js and render scale. */
export function heliocentricAu(body: PlanetName, at: Date): Vec3Au {
  const v = HelioVector(Body[body], at);
  return { x: v.x, y: v.y, z: v.z };
}

/** Earth-centered Moon vector, also in EQJ/J2000 and AU. */
export function geoMoonAu(at: Date): Vec3Au {
  const v = GeoMoon(at);
  return { x: v.x, y: v.y, z: v.z };
}

/** Immutable renderer boundary: all bodies share the explicit displayed epoch. */
export function createSolarSnapshot(at: Date): SolarSnapshot {
  const epoch = at.toISOString();
  const planets = {} as Record<PlanetName, Vec3Au>;
  for (const name of PLANET_NAMES) planets[name] = Object.freeze(heliocentricAu(name, at));
  return Object.freeze({ epoch, referenceFrame: 'EQJ/J2000', origin: 'Sun', units: 'AU',
    planets: Object.freeze(planets), moonGeocentricAU: Object.freeze(geoMoonAu(at)) });
}

/** Samples the same ephemeris as snapshots; period only selects a display window. */
export function sampleSolarTrajectories(at: Date, segments = 192): SolarTrajectories {
  if (!Number.isInteger(segments) || segments < 48 || segments > 512) throw new RangeError('Use 48–512 orbit segments.');
  const center = at.getTime();
  if (!Number.isFinite(center)) throw new RangeError('Invalid trajectory epoch.');
  const sample = (periodDays: number, evaluate: (date: Date) => Vec3Au): OrbitalTrajectory => {
    const span = periodDays * 86_400_000;
    const start = center - span / 2;
    const positions: Vec3Au[] = [];
    for (let i = 0; i <= segments; i++) positions.push(Object.freeze(evaluate(new Date(start + span * i / segments))));
    return Object.freeze({ validFrom: new Date(start).toISOString(), validUntil: new Date(start + span).toISOString(), positions: Object.freeze(positions) });
  };
  const planets = {} as Record<PlanetName, OrbitalTrajectory>;
  for (const name of PLANET_NAMES) planets[name] = sample(PERIOD_DAYS[name], date => heliocentricAu(name, date));
  return Object.freeze({ epoch: at.toISOString(), referenceFrame: 'EQJ/J2000', origin: 'Sun', units: 'AU',
    planets: Object.freeze(planets), moonGeocentric: sample(27.321661, geoMoonAu) });
}
