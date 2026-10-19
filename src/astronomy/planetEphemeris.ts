import { Body, HelioVector, GeoMoon } from 'astronomy-engine';

export type PlanetName = 'Mercury' | 'Venus' | 'Earth' | 'Mars' | 'Jupiter' | 'Saturn' | 'Uranus' | 'Neptune';
export interface Vec3Au { readonly x: number; readonly y: number; readonly z: number; }

export const PLANET_NAMES: PlanetName[] = [
  'Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune',
];

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
