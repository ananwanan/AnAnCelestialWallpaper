import { MakeTime, Rotation_EQD_EQJ, RotateVector, SiderealTime, Vector } from 'astronomy-engine';
import type { SolarSnapshot, Vec3Au } from './planetEphemeris';

export interface CartesianVector { readonly x: number; readonly y: number; readonly z: number; }

/** Earth-fixed unit axes expressed in EQJ, independent of any scene/display scale. */
export interface EarthOrientation {
  readonly epoch: string;
  readonly referenceFrame: 'EQJ/J2000';
  readonly greenwich: CartesianVector;
  readonly east: CartesianVector;
  readonly north: CartesianVector;
  readonly gastRadians: number;
  readonly accuracy: 'UT1≈UTC; polar motion omitted';
}

export interface EarthViewSnapshot {
  readonly epoch: string;
  readonly referenceFrame: 'EQJ/J2000';
  readonly origin: 'Earth';
  readonly units: 'km';
  readonly orientation: EarthOrientation;
  readonly moonPositionKm: CartesianVector;
  /** Unit vector from Earth toward Sun in the same inertial frame. */
  readonly sunDirection: CartesianVector;
}

export const AU_KM = 149_597_870.7;
export const EARTH_RADIUS_KM = 6371;
export const MOON_RADIUS_KM = 1737.4;

/**
 * GAST rotates the terrestrial meridian into the true equator/equinox of date;
 * EQD→EQJ then removes precession/nutation. UTC approximates UT1, no polar motion.
 * Do not add an extra 23.44° tilt: EQJ already uses Earth's J2000 equator.
 */
export function createEarthOrientation(at: Date): EarthOrientation {
  if (!Number.isFinite(at.getTime())) throw new RangeError('Invalid Earth orientation epoch.');
  const time = MakeTime(at);
  const gastRadians = SiderealTime(time) * Math.PI / 12;
  const c = Math.cos(gastRadians), s = Math.sin(gastRadians);
  const rotation = Rotation_EQD_EQJ(time);
  const rotate = (x: number, y: number, z: number): CartesianVector => {
    const v = RotateVector(rotation, new Vector(x, y, z, time));
    return Object.freeze({ x: v.x, y: v.y, z: v.z });
  };
  return Object.freeze({ epoch: at.toISOString(), referenceFrame: 'EQJ/J2000',
    greenwich: rotate(c, s, 0), east: rotate(-s, c, 0), north: rotate(0, 0, 1),
    gastRadians, accuracy: 'UT1≈UTC; polar motion omitted' });
}

/** ECEF/PEF-like coordinates (any consistent length unit) to Earth-centered EQJ. */
export function ecefToEqj(p: CartesianVector, orientation: EarthOrientation): CartesianVector {
  const { greenwich: x, east: y, north: z } = orientation;
  return { x: x.x * p.x + y.x * p.y + z.x * p.z,
    y: x.y * p.x + y.y * p.y + z.y * p.z, z: x.z * p.x + y.z * p.y + z.z * p.z };
}

/** Inverse orthonormal transform; keeps the caller's input length unit. */
export function eqjToEcef(p: CartesianVector, orientation: EarthOrientation): CartesianVector {
  const dot = (q: CartesianVector) => p.x * q.x + p.y * q.y + p.z * q.z;
  return { x: dot(orientation.greenwich), y: dot(orientation.east), z: dot(orientation.north) };
}

/** Reuses the solar snapshot's exact epoch and Moon/Sun positions. No remote data. */
export function createEarthViewSnapshot(solar: SolarSnapshot): EarthViewSnapshot {
  const at = new Date(solar.epoch);
  const earth = solar.planets.Earth, distance = Math.hypot(earth.x, earth.y, earth.z);
  if (!Number.isFinite(distance) || distance <= 0) throw new RangeError('Invalid Earth-to-Sun vector.');
  return Object.freeze({ epoch: solar.epoch, referenceFrame: 'EQJ/J2000', origin: 'Earth', units: 'km',
    orientation: createEarthOrientation(at), moonPositionKm: Object.freeze(auToKm(solar.moonGeocentricAU)),
    sunDirection: Object.freeze({ x: -earth.x / distance, y: -earth.y / distance, z: -earth.z / distance }) });
}

export function auToKm(p: Vec3Au): CartesianVector { return { x: p.x * AU_KM, y: p.y * AU_KM, z: p.z * AU_KM }; }
