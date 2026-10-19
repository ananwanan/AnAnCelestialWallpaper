import type { PlanetName, Vec3Au } from '../astronomy/planetEphemeris';
import type { Quality } from '../settings/Settings';
import type { CartesianVector, EarthOrientation } from '../astronomy/earthOrientation';

/** Display choices, separate from astronomy's scientific AU values and physical radii. */
export const DISPLAY_SCALE = Object.freeze({ solarScale: 26, planetRadiusExaggeration: 1,
  moonDistanceExaggeration: 70, earthFocusKmToScene: 3 / 6371 });

export const PLANET_VISUALS: Record<PlanetName, { radius: number; physicalRadiusKm: number; color: number; texture: string; tilt: number; rotationDays: number; chinese: string }> = {
  Mercury: { radius: .47, physicalRadiusKm: 2439.7, color: 0xb6a89d, texture: '2k_mercury.jpg', tilt: .03, rotationDays: 58.646, chinese: '水星' },
  Venus: { radius: .78, physicalRadiusKm: 6051.8, color: 0xe1c390, texture: '2k_venus_atmosphere.jpg', tilt: 177.4, rotationDays: -243.025, chinese: '金星' },
  Earth: { radius: .84, physicalRadiusKm: 6371, color: 0x87b7da, texture: '2k_earth_daymap.jpg', tilt: 23.44, rotationDays: .99727, chinese: '地球' },
  Mars: { radius: .61, physicalRadiusKm: 3389.5, color: 0xe29978, texture: '2k_mars.jpg', tilt: 25.19, rotationDays: 1.02596, chinese: '火星' },
  Jupiter: { radius: 2.1, physicalRadiusKm: 69911, color: 0xd9c2ac, texture: '2k_jupiter.jpg', tilt: 3.13, rotationDays: .41354, chinese: '木星' },
  Saturn: { radius: 1.75, physicalRadiusKm: 58232, color: 0xdac69c, texture: '2k_saturn.jpg', tilt: 26.73, rotationDays: .44401, chinese: '土星' },
  Uranus: { radius: 1.25, physicalRadiusKm: 25362, color: 0xa6d6d9, texture: '2k_uranus.jpg', tilt: 97.77, rotationDays: -.71833, chinese: '天王星' },
  Neptune: { radius: 1.2, physicalRadiusKm: 24622, color: 0x789bd8, texture: '2k_neptune.jpg', tilt: 28.32, rotationDays: .67125, chinese: '海王星' },
};

export const QUALITY_PRESETS: Record<Quality, { dpr: number; segments: number; earthSegments: number; stars: number; corona: boolean }> = {
  low: { dpr: 1, segments: 24, earthSegments: 32, stars: 600, corona: false },
  medium: { dpr: 1.5, segments: 40, earthSegments: 64, stars: 1500, corona: true },
  high: { dpr: 2, segments: 64, earthSegments: 96, stars: 2600, corona: true },
};

/** Soft-log radial compression preserves directions/inclination and is explicitly artistic. */
export function solarDisplayPosition(p: Vec3Au): Vec3Au {
  const distance = Math.hypot(p.x, p.y, p.z);
  const factor = distance ? DISPLAY_SCALE.solarScale * Math.log1p(distance) / distance : DISPLAY_SCALE.solarScale;
  return { x: p.x * factor, y: p.z * factor, z: -p.y * factor };
}

export function moonDisplayOffset(p: Vec3Au): Vec3Au {
  const factor = DISPLAY_SCALE.solarScale * DISPLAY_SCALE.moonDistanceExaggeration;
  return { x: p.x * factor, y: p.z * factor, z: -p.y * factor };
}

/** Earth focus has one physical km scale for Earth, Moon and artificial satellites. */
export function earthFocusPositionKm(p: CartesianVector): CartesianVector {
  const scale = DISPLAY_SCALE.earthFocusKmToScene;
  return { x: p.x * scale, y: p.z * scale, z: -p.y * scale };
}

/**
 * Three SphereGeometry has +Y north, u=.5 at +X (Greenwich), east toward -Z.
 * Return its local XYZ axes in the renderer's EQJ→Y-up orientation (x,z,-y).
 */
export function earthSphereBasis(orientation: EarthOrientation): readonly [CartesianVector, CartesianVector, CartesianVector] {
  const map = (p: CartesianVector): CartesianVector => ({ x: p.x, y: p.z, z: -p.y });
  const east = orientation.east;
  return [map(orientation.greenwich), map(orientation.north), map({ x: -east.x, y: -east.y, z: -east.z })];
}

/** UV to Earth-fixed unit direction for the bundled north-up, Greenwich-centered map. */
export function earthTextureDirection(u: number, v: number): CartesianVector {
  const longitude = (u - .5) * Math.PI * 2, latitude = (v - .5) * Math.PI;
  const r = Math.cos(latitude);
  return { x: r * Math.cos(longitude), y: r * Math.sin(longitude), z: Math.sin(latitude) };
}

/** Fit a focused sphere against the narrower field of view, including portrait screens. */
export function minimumCameraDistance(radius: number, aspect: number, verticalFovDegrees = 42): number {
  const verticalHalf = verticalFovDegrees * Math.PI / 360;
  const horizontalHalf = Math.atan(Math.tan(verticalHalf) * Math.max(.01, aspect));
  return radius / Math.sin(Math.min(verticalHalf, horizontalHalf)) * 1.06;
}

/** Preserve the overview's 16:9 horizontal coverage on narrower displays. */
export function solarPresetAspectScale(aspect: number): number { return Math.max(1, (16 / 9) / Math.max(.01, aspect)); }

/** Travel bounds include the whole camera path; focus bounds apply once a preset arrives. */
export function cameraDistanceBounds(earth: boolean, aspect: number, aspectScale: number, travelDistances: readonly number[] = []): {
  minDistance: number; maxDistance: number; near: number; far: number;
} {
  // Physical Moon distance is ~180 scene units; allow a complete Earth–Moon overview.
  const maxDistance = Math.max((earth ? 700 : 500) * aspectScale, ...travelDistances);
  return { minDistance: minimumCameraDistance(earth ? 3.2 : 2.65, aspect), maxDistance,
    near: earth ? .03 : .08, far: Math.max(2400, maxDistance + 1300) };
}

export interface LabelRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number; }
export function rectanglesOverlap(a: LabelRect, b: LabelRect, gap = 5): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

/** Deterministic bounded label placement; caller orders higher-priority bodies first. */
export function placeLabel(anchorX: number, anchorY: number, width: number, height: number,
  viewportWidth: number, viewportHeight: number, occupied: readonly LabelRect[], radius = 8): LabelRect | null {
  const candidates = [[radius + 8, -height / 2], [-radius - width - 8, -height / 2], [-width / 2, -radius - height - 8], [-width / 2, radius + 8]];
  for (const [dx, dy] of candidates) {
    const rect = { x: anchorX + dx!, y: anchorY + dy!, width, height };
    if (rect.x < 18 || rect.x + width > viewportWidth - 18 || rect.y < 90 || rect.y + height > viewportHeight - 90) continue;
    if (!occupied.some(other => rectanglesOverlap(rect, other))) return rect;
  }
  return null;
}
