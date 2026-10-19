import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DISPLAY_SCALE, QUALITY_PRESETS, solarDisplayPosition, moonDisplayOffset, minimumCameraDistance, solarPresetAspectScale, cameraDistanceBounds, placeLabel, rectanglesOverlap } from '../src/render/visualModel';

describe('artistic display model', () => {
  it('compresses distance monotonically while preserving inclination and Y-up handedness', () => {
    const inner = solarDisplayPosition({ x: 1, y: 2, z: 3 });
    const outer = solarDisplayPosition({ x: 10, y: 20, z: 30 });
    expect(inner.y / inner.x).toBeCloseTo(3, 12);
    expect(inner.z / inner.x).toBeCloseTo(-2, 12);
    expect(Math.hypot(outer.x, outer.y, outer.z)).toBeGreaterThan(Math.hypot(inner.x, inner.y, inner.z));
    expect(Math.hypot(outer.x, outer.y, outer.z)).toBeLessThan(10 * Math.hypot(inner.x, inner.y, inner.z));
    expect(solarDisplayPosition({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: -0 });
  });
  it('keeps Earth-focus kilometer units and Moon offset exaggeration independent', () => {
    expect(6371 * DISPLAY_SCALE.earthFocusKmToScene).toBeCloseTo(3, 12);
    const moon = moonDisplayOffset({ x: .00257, y: 0, z: 0 });
    expect(moon.x).toBeGreaterThan(4);
    expect(DISPLAY_SCALE.moonDistanceExaggeration).toBeGreaterThan(1);
  });
  it('bounds pixels and star budgets at every quality', () => {
    expect(QUALITY_PRESETS.low.dpr).toBe(1);
    expect(QUALITY_PRESETS.high.dpr).toBeLessThanOrEqual(2);
    expect(QUALITY_PRESETS.medium.earthSegments).toBe(64);
    expect(QUALITY_PRESETS.high.earthSegments).toBeLessThanOrEqual(96);
    expect(QUALITY_PRESETS.low.stars).toBeLessThan(QUALITY_PRESETS.medium.stars);
    expect(QUALITY_PRESETS.medium.stars).toBeLessThan(QUALITY_PRESETS.high.stars);
  });
  it.each([9 / 16, 1, 16 / 9, 21 / 9, 32 / 9])('fits the focused Earth and Sun at aspect %f without clipping', aspect => {
    const verticalHalf = 42 * Math.PI / 360;
    const narrowHalf = Math.min(verticalHalf, Math.atan(Math.tan(verticalHalf) * aspect));
    for (const radius of [2.65, 3.2]) {
      const distance = minimumCameraDistance(radius, aspect);
      expect(Math.asin(radius / distance)).toBeLessThan(narrowHalf);
      expect(distance - radius).toBeGreaterThan(.08);
    }
    expect(solarPresetAspectScale(aspect)).toBeGreaterThanOrEqual(1);
    expect(solarPresetAspectScale(aspect) * aspect).toBeGreaterThanOrEqual(16 / 9);
  });
  it('lets OrbitControls follow a Solar-to-Earth flight without clamping to the final Earth zoom limit', () => {
    const from = new Vector3(0, 92, 172), to = new Vector3(7.5, 3.5, 10);
    const camera = new PerspectiveCamera(42, 16 / 9, .03, 2400);
    camera.position.copy(from);
    // No DOM/WebGL is needed to test the real control's distance admission.
    const controls = new OrbitControls(camera, null);
    const travel = cameraDistanceBounds(true, camera.aspect, 1, [from.length(), to.length()]);
    controls.minDistance = travel.minDistance; controls.maxDistance = travel.maxDistance;
    for (const t of [0, .1, .25, .5, .75, 1]) {
      const expected = new Vector3().lerpVectors(from, to, t);
      camera.position.copy(expected); controls.update();
      expect(camera.position.distanceTo(expected)).toBeLessThan(1e-10);
    }
    const arrived = cameraDistanceBounds(true, camera.aspect, 1);
    controls.maxDistance = arrived.maxDistance; controls.update();
    expect(controls.maxDistance).toBe(700);
    expect(camera.position.distanceTo(to)).toBeLessThan(1e-10);
    expect(arrived.far).toBeGreaterThan(arrived.maxDistance + 1100);
  });
});

describe('collision-aware body labels', () => {
  it.each([[1920, 1080], [3440, 1440], [3840, 2160], [5120, 1440]])('stays inside a %i×%i screen with reserved HUD bands', (width, height) => {
    const rect = placeLabel(width / 2, height / 2, 110, 18, width, height, []);
    expect(rect).not.toBeNull();
    expect(rect!.x).toBeGreaterThanOrEqual(18); expect(rect!.y).toBeGreaterThanOrEqual(90);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(width - 18);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(height - 90);
  });
  it('tries another side when a body label or sidebar occupies the preferred position', () => {
    const occupied = { x: 510, y: 390, width: 250, height: 50 };
    const rect = placeLabel(500, 410, 110, 18, 1920, 1080, [occupied]);
    expect(rect).not.toBeNull(); expect(rectanglesOverlap(rect!, occupied)).toBe(false);
  });
  it('hides overcrowded or clipped labels instead of stacking them', () => {
    expect(placeLabel(500, 400, 100, 18, 1920, 1080, [{ x: 100, y: 100, width: 900, height: 800 }])).toBeNull();
    expect(placeLabel(5, 5, 100, 18, 1920, 1080, [])).toBeNull();
  });
});
