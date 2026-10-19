import * as THREE from 'three';
import type { SatelliteSnapshot, SatelliteState, SatelliteTrajectory } from '../satellites/types';
import type { WallpaperSettings } from '../settings/Settings';

/** Fixed GPU capacities; quality changes only adjust draw ranges, never allocate per satellite. */
export const SATELLITE_RENDER_LIMITS = Object.freeze({
  low: { satellites: 32, arcSamples: 97, pointSize: 3 },
  medium: { satellites: 64, arcSamples: 193, pointSize: 3.5 },
  high: { satellites: 128, arcSamples: 257, pointSize: 4 },
});

type LayerSettings = Pick<WallpaperSettings, 'showSatellites' | 'viewMode' | 'showOrbits' | 'quality'>;
type KilometerVector = { readonly x: number; readonly y: number; readonly z: number };

/**
 * Earth-centered EQJ kilometer rendering only. No fetch, propagation, ephemeris or frame conversion.
 * Attach to the unrotated Earth-focus group; the globe surface's body rotation must not affect us.
 */
export class SatelliteLayer {
  readonly root = new THREE.Group();
  private readonly pointGeometry = new THREE.BufferGeometry();
  private readonly selectedGeometry = new THREE.BufferGeometry();
  private readonly pastGeometry = new THREE.BufferGeometry();
  private readonly futureGeometry = new THREE.BufferGeometry();
  private readonly sprite = makePointSprite();
  private readonly pointMaterial = new THREE.PointsMaterial({ vertexColors: true, size: 3.5, sizeAttenuation: false,
    transparent: true, opacity: .95, depthWrite: false, map: this.sprite, alphaTest: .05, toneMapped: false });
  private readonly selectedMaterial = new THREE.PointsMaterial({ color: 0xffe4a8, size: 7, sizeAttenuation: false,
    transparent: true, opacity: 1, depthWrite: false, map: this.sprite, alphaTest: .05, toneMapped: false });
  private readonly pastMaterial = new THREE.LineBasicMaterial({ color: 0x76cfe6, transparent: true, opacity: .4,
    depthWrite: false, toneMapped: false });
  private readonly futureMaterial = new THREE.LineBasicMaterial({ color: 0xf1bf78, transparent: true, opacity: .75,
    depthWrite: false, toneMapped: false });
  private readonly points = new THREE.Points(this.pointGeometry, this.pointMaterial);
  private readonly selected = new THREE.Points(this.selectedGeometry, this.selectedMaterial);
  private readonly past = new THREE.Line(this.pastGeometry, this.pastMaterial);
  private readonly future = new THREE.Line(this.futureGeometry, this.futureMaterial);
  private settings: LayerSettings = { showSatellites: false, viewMode: 'solar', showOrbits: true, quality: 'medium' };
  private snapshot: SatelliteSnapshot | null = null;
  private trajectory: SatelliteTrajectory | null = null;
  private selection: number | null = null;
  private disposed = false;

  constructor(parent: THREE.Group, private readonly kmToScene: number) {
    if (!Number.isFinite(kmToScene) || kmToScene <= 0) throw new RangeError('Satellite display scale must be positive');
    this.root.name = 'Earth-centered predicted satellites';
    this.points.name = 'Bounded satellite points';
    this.selected.name = 'Selected satellite marker';
    this.past.name = 'Predicted recent satellite arc';
    this.future.name = 'Predicted future satellite arc';
    this.allocate(this.pointGeometry, SATELLITE_RENDER_LIMITS.high.satellites);
    this.pointGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SATELLITE_RENDER_LIMITS.high.satellites * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.allocate(this.selectedGeometry, 1);
    this.allocate(this.pastGeometry, SATELLITE_RENDER_LIMITS.high.arcSamples);
    this.allocate(this.futureGeometry, SATELLITE_RENDER_LIMITS.high.arcSamples);
    this.root.add(this.points, this.selected, this.past, this.future);
    this.root.visible = false;
    parent.add(this.root);
  }

  configure(settings: LayerSettings): void {
    if (this.disposed) return;
    const qualityChanged = settings.quality !== this.settings.quality;
    this.settings = { showSatellites: settings.showSatellites, viewMode: settings.viewMode,
      showOrbits: settings.showOrbits, quality: settings.quality };
    this.root.visible = settings.showSatellites && settings.viewMode === 'earth';
    this.pointMaterial.size = SATELLITE_RENDER_LIMITS[settings.quality].pointSize;
    if (!settings.showSatellites) {
      this.snapshot = null;
      this.trajectory = null;
      this.clearRanges();
    } else if (qualityChanged) {
      this.updatePoints();
      this.updateArcs();
    }
    this.updateArcVisibility();
  }

  setSnapshot(snapshot: SatelliteSnapshot | null): void {
    if (this.disposed || !this.settings.showSatellites) return;
    this.snapshot = snapshot && compatibleFrame(snapshot) ? snapshot : null;
    this.updatePoints();
    // No orphaned orbit when a selected record becomes stale or fails propagation.
    this.updateArcVisibility();
  }

  setSelection(noradId: number | null): void {
    if (this.disposed) return;
    this.selection = typeof noradId === 'number' && Number.isSafeInteger(noradId) && noradId > 0 ? noradId : null;
    this.updatePoints();
    this.updateArcs();
  }

  setTrajectory(trajectory: SatelliteTrajectory | null): void {
    if (this.disposed || !this.settings.showSatellites) return;
    this.trajectory = trajectory && compatibleFrame(trajectory) ? trajectory : null;
    this.updateArcs();
  }

  getDiagnostics(): { satellites: number; satelliteDrawCalls: number } {
    if (this.disposed || !this.root.visible) return { satellites: 0, satelliteDrawCalls: 0 };
    const satellites = this.pointGeometry.drawRange.count;
    const arcCalls = this.settings.showOrbits
      ? Number(this.past.visible && this.pastGeometry.drawRange.count > 1) + Number(this.future.visible && this.futureGeometry.drawRange.count > 1) : 0;
    return { satellites, satelliteDrawCalls: Number(satellites > 0) + Number(this.selectedGeometry.drawRange.count > 0) + arcCalls };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.snapshot = null;
    this.trajectory = null;
    this.clearRanges();
    this.root.visible = false;
    this.root.removeFromParent();
    for (const geometry of [this.pointGeometry, this.selectedGeometry, this.pastGeometry, this.futureGeometry]) geometry.dispose();
    for (const material of [this.pointMaterial, this.selectedMaterial, this.pastMaterial, this.futureMaterial]) material.dispose();
    this.sprite.dispose();
  }

  private allocate(geometry: THREE.BufferGeometry, capacity: number): void {
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
  }

  private clearRanges(): void {
    for (const geometry of [this.pointGeometry, this.selectedGeometry, this.pastGeometry, this.futureGeometry]) geometry.setDrawRange(0, 0);
  }

  private writePosition(attribute: THREE.BufferAttribute, index: number, position: KilometerVector): void {
    attribute.setXYZ(index, position.x * this.kmToScene, position.z * this.kmToScene, -position.y * this.kmToScene);
  }

  private updatePoints(): void {
    if (!this.settings.showSatellites || !this.snapshot) {
      this.pointGeometry.setDrawRange(0, 0);
      this.selectedGeometry.setDrawRange(0, 0);
      return;
    }
    const positions = this.pointGeometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = this.pointGeometry.getAttribute('color') as THREE.BufferAttribute;
    const selectedPosition = this.selectedGeometry.getAttribute('position') as THREE.BufferAttribute;
    const limit = SATELLITE_RENDER_LIMITS[this.settings.quality].satellites;
    let count = 0;
    this.selectedGeometry.setDrawRange(0, 0);
    const add = (state: SatelliteState) => {
      if (count >= limit || !finiteVector(state.positionKm)) return;
      this.writePosition(positions, count, state.positionKm);
      if (state.stale) colors.setXYZ(count, 1, .65, .28);
      else colors.setXYZ(count, .43, .81, 1);
      if (state.noradId === this.selection) {
        this.writePosition(selectedPosition, 0, state.positionKm);
        this.selectedGeometry.setDrawRange(0, 1);
        selectedPosition.needsUpdate = true;
        this.selectedGeometry.computeBoundingSphere();
      }
      count++;
    };
    // Preserve selection even when quality caps the displayed subset.
    const selectedState = this.snapshot.states.find(state => state.noradId === this.selection);
    if (selectedState) add(selectedState);
    for (const state of this.snapshot.states) {
      if (count >= limit) break;
      if (state !== selectedState) add(state);
    }
    this.pointGeometry.setDrawRange(0, count);
    positions.needsUpdate = colors.needsUpdate = true;
    this.pointGeometry.computeBoundingSphere();
  }

  private updateArcs(): void {
    this.pastGeometry.setDrawRange(0, 0);
    this.futureGeometry.setDrawRange(0, 0);
    const trajectory = this.trajectory;
    if (!this.settings.showSatellites || !trajectory || trajectory.noradId !== this.selection) return;
    const limit = SATELLITE_RENDER_LIMITS[this.settings.quality].arcSamples;
    this.writeArc(this.pastGeometry, trajectory.past, limit);
    this.writeArc(this.futureGeometry, trajectory.future, limit);
    this.updateArcVisibility();
  }

  private updateArcVisibility(): void {
    const visible = this.settings.showOrbits && this.selectedGeometry.drawRange.count > 0
      && this.trajectory?.noradId === this.selection;
    this.past.visible = this.future.visible = visible;
  }

  private writeArc(geometry: THREE.BufferGeometry, samples: readonly KilometerVector[], limit: number): void {
    // An invalid vertex would join disconnected pieces or poison frustum bounds: reject the arc.
    if (samples.length < 2 || samples.some(position => !finiteVector(position))) return;
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    const count = Math.min(samples.length, limit);
    for (let index = 0; index < count; index++) {
      const sourceIndex = Math.round(index * (samples.length - 1) / (count - 1));
      this.writePosition(positions, index, samples[sourceIndex]!);
    }
    geometry.setDrawRange(0, count);
    positions.needsUpdate = true;
    geometry.computeBoundingSphere();
  }
}

function compatibleFrame(data: { referenceFrame: string; origin: string; units: string }): boolean {
  return data.referenceFrame === 'EQJ/J2000' && data.origin === 'Earth' && data.units === 'km';
}

function finiteVector(position: KilometerVector): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
}

function makePointSprite(): THREE.DataTexture {
  const size = 16, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const radius = Math.hypot((x + .5 - size / 2) / (size / 2), (y + .5 - size / 2) / (size / 2));
    const index = (y * size + x) * 4;
    pixels[index] = pixels[index + 1] = pixels[index + 2] = 255;
    pixels[index + 3] = Math.round(Math.max(0, Math.min(1, (1 - radius) * 5)) * 255);
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}
