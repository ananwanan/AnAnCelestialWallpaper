import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, Group, Line, LineBasicMaterial, Points, PointsMaterial } from 'three';
import { SatelliteLayer, SATELLITE_RENDER_LIMITS } from '../src/render/SatelliteLayer';
import { DISPLAY_SCALE } from '../src/render/visualModel';
import type { SatelliteSnapshot, SatelliteState, SatelliteTrajectory } from '../src/satellites/types';

const enabled = { showSatellites: true, viewMode: 'earth' as const, showOrbits: true, quality: 'medium' as const };
const position = { x: 7000, y: 2000, z: 1000 };
function state(noradId = 25544): SatelliteState {
  return { noradId, name: 'TEST SATELLITE', elementEpoch: '2026-10-19T00:00:00.000Z', positionKm: position,
    temeKm: position, ecefKm: position, altitudeKm: 500, ageDays: 0, stale: false };
}
function snapshot(states: readonly SatelliteState[] = [state()]): SatelliteSnapshot {
  return { epoch: '2026-10-19T00:00:00.000Z', referenceFrame: 'EQJ/J2000', origin: 'Earth', units: 'km',
    quality: 'approximate prediction', states, rejected: [] };
}
function trajectory(): SatelliteTrajectory {
  return { noradId: 25544, epoch: '2026-10-19T00:00:00.000Z', validFrom: '2026-10-18T23:15:00.000Z',
    validUntil: '2026-10-19T00:45:00.000Z', referenceFrame: 'EQJ/J2000', origin: 'Earth', units: 'km',
    quality: 'approximate prediction', past: [{ x: 7000, y: 0, z: 0 }, position],
    future: [position, { x: 0, y: 7000, z: 0 }] };
}
function setup() {
  const parent = new Group();
  const layer = new SatelliteLayer(parent, DISPLAY_SCALE.earthFocusKmToScene);
  const points = layer.root.children[0] as Points<BufferGeometry, PointsMaterial>;
  const selected = layer.root.children[1] as Points<BufferGeometry, PointsMaterial>;
  const past = layer.root.children[2] as Line<BufferGeometry, LineBasicMaterial>;
  const future = layer.root.children[3] as Line<BufferGeometry, LineBasicMaterial>;
  return { parent, layer, points, selected, past, future };
}

describe('bounded Earth-centered satellite rendering', () => {
  it('does no draw work by default, uses kilometer scale and renderer axes, and lets Earth occlude points', () => {
    const { layer, points } = setup();
    layer.setSnapshot(snapshot());
    expect(layer.getDiagnostics()).toEqual({ satellites: 0, satelliteDrawCalls: 0 });
    expect(points.geometry.drawRange.count).toBe(0);
    layer.configure(enabled);
    layer.setSnapshot(snapshot());
    const buffer = points.geometry.getAttribute('position');
    const scale = DISPLAY_SCALE.earthFocusKmToScene;
    expect(buffer.getX(0)).toBeCloseTo(position.x * scale, 6);
    expect(buffer.getY(0)).toBeCloseTo(position.z * scale, 6);
    expect(buffer.getZ(0)).toBeCloseTo(-position.y * scale, 6);
    expect(points.material.depthTest).toBe(true);
    expect(points.material.depthWrite).toBe(false);
    expect(layer.getDiagnostics()).toEqual({ satellites: 1, satelliteDrawCalls: 1 });
    layer.dispose();
  });

  it('distinguishes predicted recent/future arcs, hides them with paths, and rejects an unrelated selection', () => {
    const { layer, selected, past, future } = setup();
    layer.configure(enabled);
    layer.setSelection(25544);
    layer.setSnapshot(snapshot());
    layer.setTrajectory(trajectory());
    expect(selected.geometry.drawRange.count).toBe(1);
    expect(past.geometry.drawRange.count).toBe(2);
    expect(future.geometry.drawRange.count).toBe(2);
    expect(past.material.color.getHex()).not.toBe(future.material.color.getHex());
    expect(layer.getDiagnostics().satelliteDrawCalls).toBe(4);
    layer.configure({ ...enabled, showOrbits: false });
    expect(past.visible).toBe(false);
    expect(future.visible).toBe(false);
    expect(layer.getDiagnostics().satelliteDrawCalls).toBe(2);
    layer.configure(enabled);
    layer.setSelection(99999);
    expect(past.geometry.drawRange.count).toBe(0);
    expect(future.geometry.drawRange.count).toBe(0);
    expect(selected.geometry.drawRange.count).toBe(0);
    layer.dispose();
  });

  it('clears all draw ranges on OFF and does not revive old positions when re-enabled', () => {
    const { layer } = setup();
    layer.configure(enabled);
    layer.setSelection(25544);
    layer.setSnapshot(snapshot());
    layer.setTrajectory(trajectory());
    layer.configure({ ...enabled, showSatellites: false });
    expect(layer.root.visible).toBe(false);
    for (const object of layer.root.children as Points[]) expect(object.geometry.drawRange.count).toBe(0);
    layer.setSnapshot(snapshot());
    layer.setTrajectory(trajectory());
    layer.configure(enabled);
    expect(layer.getDiagnostics()).toEqual({ satellites: 0, satelliteDrawCalls: 0 });
    layer.setSnapshot(snapshot());
    layer.configure({ ...enabled, viewMode: 'solar' });
    expect(layer.root.visible).toBe(false);
    expect(layer.getDiagnostics().satelliteDrawCalls).toBe(0);
    layer.dispose();
  });

  it('keeps selection within every quality cap and reuses fixed buffers while thinning complete arcs', () => {
    const { layer, points, selected, past } = setup();
    layer.configure(enabled);
    const originalBuffer = points.geometry.getAttribute('position');
    const states = Array.from({ length: 300 }, (_, index) => state(index + 1));
    layer.setSelection(300);
    layer.setSnapshot(snapshot(states));
    expect(selected.geometry.drawRange.count).toBe(1);
    for (const quality of ['low', 'medium', 'high'] as const) {
      layer.configure({ ...enabled, quality });
      expect(points.geometry.drawRange.count).toBe(SATELLITE_RENDER_LIMITS[quality].satellites);
      expect(points.geometry.getAttribute('position')).toBe(originalBuffer);
    }
    layer.setSelection(25544);
    layer.setSnapshot(snapshot());
    const samples = Array.from({ length: 900 }, (_, index) => ({ x: 7000, y: index, z: 0 }));
    layer.setTrajectory({ ...trajectory(), past: samples });
    layer.configure({ ...enabled, quality: 'low' });
    expect(past.geometry.drawRange.count).toBe(SATELLITE_RENDER_LIMITS.low.arcSamples);
    const arc = past.geometry.getAttribute('position') as BufferAttribute;
    expect(arc.getZ(0)).toBeCloseTo(0, 12);
    expect(arc.getZ(past.geometry.drawRange.count - 1)).toBeCloseTo(-899 * DISPLAY_SCALE.earthFocusKmToScene, 6);
    layer.dispose();
  });

  it('fails closed for wrong frames, nonfinite points/arcs, and missing selected propagation', () => {
    const { layer, points, past } = setup();
    layer.configure(enabled);
    layer.setSnapshot({ ...snapshot(), referenceFrame: 'TEME' } as unknown as SatelliteSnapshot);
    expect(points.geometry.drawRange.count).toBe(0);
    layer.setSelection(25544);
    layer.setSnapshot(snapshot([state(), { ...state(99), positionKm: { x: NaN, y: 0, z: 0 } }]));
    expect(points.geometry.drawRange.count).toBe(1);
    layer.setTrajectory({ ...trajectory(), past: [position, { x: NaN, y: 0, z: 0 }] });
    expect(past.geometry.drawRange.count).toBe(0);
    layer.setTrajectory(trajectory());
    layer.setSnapshot(snapshot([]));
    expect(past.visible).toBe(false);
    layer.configure({ ...enabled, showOrbits: false });
    layer.configure(enabled);
    expect(past.visible).toBe(false);
    expect(layer.getDiagnostics().satelliteDrawCalls).toBe(0);
    layer.dispose();
  });

  it('disposes GPU resources exactly once and detaches the group', () => {
    const { layer, parent, points } = setup();
    let geometryDisposals = 0, materialDisposals = 0, textureDisposals = 0;
    for (const object of layer.root.children as Points<BufferGeometry, PointsMaterial>[]) {
      object.geometry.addEventListener('dispose', () => geometryDisposals++);
      object.material.addEventListener('dispose', () => materialDisposals++);
    }
    points.material.map!.addEventListener('dispose', () => textureDisposals++);
    layer.dispose();
    layer.dispose();
    layer.configure(enabled);
    layer.setSnapshot(snapshot());
    expect(parent.children).toHaveLength(0);
    expect(geometryDisposals).toBe(4);
    expect(materialDisposals).toBe(4);
    expect(textureDisposals).toBe(1);
    expect(layer.getDiagnostics()).toEqual({ satellites: 0, satelliteDrawCalls: 0 });
  });
});
