import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLANET_NAMES, type PlanetName, type SolarSnapshot, type SolarTrajectories, type Vec3Au } from '../astronomy/planetEphemeris';
import { AU_KM, MOON_RADIUS_KM, type EarthViewSnapshot } from '../astronomy/earthOrientation';
import { resolveCameraPreset, type WallpaperSettings } from '../settings/Settings';
import type { SatelliteSnapshot, SatelliteTrajectory } from '../satellites/types';
import { SatelliteLayer } from './SatelliteLayer';
import { DISPLAY_SCALE, PLANET_VISUALS, QUALITY_PRESETS, placeLabel, solarDisplayPosition, moonDisplayOffset, earthFocusPositionKm, earthSphereBasis, minimumCameraDistance, solarPresetAspectScale, cameraDistanceBounds, type LabelRect } from './visualModel';

export type CameraPreset = 'overview' | 'inner' | 'outer' | 'earth' | 'earthMoon';
interface BodyVisual { root: THREE.Group; surface: THREE.Mesh; radius: number; label: HTMLElement; }
interface CameraTransition { start: number; from: THREE.Vector3; to: THREE.Vector3; targetFrom: THREE.Vector3; targetTo: THREE.Vector3; }

/** Pure rendering boundary: no network, raw providers, clock or ephemeris evaluation. */
export class SolarScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, .05, 2400);
  private readonly controls: OrbitControls;
  private readonly solarRoot = new THREE.Group();
  private readonly earthRoot = new THREE.Group();
  private readonly moonRoot = new THREE.Group();
  private readonly bodies = new Map<PlanetName, BodyVisual>();
  private readonly orbitLines: THREE.Line[] = [];
  private readonly textures = new Set<THREE.Texture>();
  private readonly materials = new Set<THREE.Material>();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly labelLayer = document.createElement('div');
  private readonly observer: ResizeObserver;
  private readonly projected = new THREE.Vector3();
  private readonly world = new THREE.Vector3();
  private readonly moon: THREE.Mesh;
  private readonly sun: THREE.Mesh;
  private readonly corona: THREE.Mesh;
  private readonly earthFocus: THREE.Mesh;
  private readonly earthAtmosphere: THREE.Mesh;
  private readonly moonFocus: THREE.Mesh;
  private readonly earthBasis = new THREE.Matrix4();
  private readonly basisX = new THREE.Vector3();
  private readonly basisY = new THREE.Vector3();
  private readonly basisZ = new THREE.Vector3();
  private readonly earthLight: THREE.DirectionalLight;
  private readonly satelliteLayer: SatelliteLayer;
  private readonly stars: THREE.Points;
  private readonly moonLabel: HTMLElement;
  private readonly sunLabel: HTMLElement;
  private settings: WallpaperSettings;
  private preset: CameraPreset = 'overview';
  private width = 1;
  private height = 1;
  private cameraAspectScale = 1;
  private lastLabelAt = -Infinity;
  private disposed = false;
  private loadedAssets = 0;
  private failedAssets = 0;
  private labelExclusions: readonly LabelRect[] = [];
  private transition: CameraTransition | null = null;
  private earthSnapshot: EarthViewSnapshot | null = null;
  private readonly cancelTransition = () => { this.transition = null; this.updateCameraBounds(true); };

  constructor(private readonly container: HTMLElement, settings: WallpaperSettings, trajectories?: SolarTrajectories) {
    this.settings = { ...settings };
    this.scene.background = new THREE.Color(0x03060e);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.14;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY_PRESETS[settings.quality].dpr));
    container.appendChild(this.renderer.domElement);
    this.labelLayer.className = 'celestial-label-layer';
    this.labelLayer.setAttribute('aria-hidden', 'true');
    this.labelLayer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:1;';
    container.appendChild(this.labelLayer);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .065;
    this.controls.enablePan = false;
    this.controls.addEventListener('start', this.cancelTransition);
    this.scene.add(this.solarRoot, this.earthRoot);
    this.scene.add(new THREE.HemisphereLight(0xc6d6ff, 0x161b2a, .38));
    // Sun-centered light direction with artistic attenuation for compressed distances.
    this.solarRoot.add(new THREE.PointLight(0xfff1da, 3.2, 0, 0));
    this.earthLight = new THREE.DirectionalLight(0xfff4dc, 2.8);
    this.earthLight.position.set(8, 3, 6);
    this.earthRoot.add(this.earthLight);
    const segments = QUALITY_PRESETS[settings.quality].segments;
    const sphere = this.trackGeometry(new THREE.SphereGeometry(1, segments, segments / 2));
    const earthSegments = QUALITY_PRESETS[settings.quality].earthSegments;
    const earthSphere = this.trackGeometry(new THREE.SphereGeometry(1, earthSegments, earthSegments / 2));
    this.sun = new THREE.Mesh(sphere, this.trackMaterial(new THREE.MeshBasicMaterial({ map: this.loadTexture('2k_sun.jpg'), color: 0xffedc0, toneMapped: false })));
    this.sun.scale.setScalar(2.55);
    this.solarRoot.add(this.sun);
    const halo = new THREE.Sprite(this.trackMaterial(new THREE.SpriteMaterial({ map: this.radialTexture(), color: 0xffa24b, blending: THREE.AdditiveBlending, transparent: true, opacity: .55, depthWrite: false })));
    halo.scale.set(25, 25, 1);
    this.solarRoot.add(halo);
    this.corona = new THREE.Mesh(sphere, this.trackMaterial(new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(0xffa751) } },
      vertexShader: 'varying vec3 vNormal;varying vec3 vEye;void main(){vec4 p=modelViewMatrix*vec4(position,1.0);vNormal=normalize(normalMatrix*normal);vEye=normalize(-p.xyz);gl_Position=projectionMatrix*p;}',
      fragmentShader: 'uniform vec3 color;varying vec3 vNormal;varying vec3 vEye;void main(){float rim=pow(1.0-abs(dot(normalize(vNormal),normalize(vEye))),3.5);gl_FragColor=vec4(color,rim*0.22);}',
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })));
    this.corona.scale.setScalar(3.25);
    this.solarRoot.add(this.corona);
    this.sunLabel = this.makeLabel('太阳 · SUN', '#e5c596');
    for (const name of PLANET_NAMES) {
      const style = PLANET_VISUALS[name];
      const root = new THREE.Group();
      const surface = new THREE.Mesh(sphere, this.trackMaterial(new THREE.MeshStandardMaterial({ map: this.loadTexture(style.texture), roughness: .94, metalness: 0 })));
      if (name !== 'Earth') surface.rotation.z = THREE.MathUtils.degToRad(style.tilt);
      root.add(surface);
      root.scale.setScalar(style.radius * DISPLAY_SCALE.planetRadiusExaggeration);
      if (name === 'Saturn') root.add(this.createSaturnRings());
      this.solarRoot.add(root);
      this.bodies.set(name, { root, surface, radius: style.radius, label: this.makeLabel(`${style.chinese} · ${name.toUpperCase()}`, `#${new THREE.Color(style.color).getHexString()}`) });
    }
    this.moon = new THREE.Mesh(sphere, this.trackMaterial(new THREE.MeshStandardMaterial({ map: this.loadTexture('2k_moon.jpg'), roughness: 1 })));
    this.moon.scale.setScalar(.25);
    this.moonRoot.add(this.moon);
    this.solarRoot.add(this.moonRoot);
    this.moonLabel = this.makeLabel('月球 · MOON', '#9aa6bb');
    this.earthFocus = new THREE.Mesh(earthSphere, this.bodies.get('Earth')!.surface.material);
    this.earthFocus.scale.setScalar(3);
    this.earthRoot.add(this.earthFocus);
    this.moonFocus = new THREE.Mesh(sphere, this.moon.material);
    this.moonFocus.scale.setScalar(MOON_RADIUS_KM * DISPLAY_SCALE.earthFocusKmToScene);
    this.earthRoot.add(this.moonFocus);
    this.earthAtmosphere = new THREE.Mesh(earthSphere, this.trackMaterial(new THREE.MeshBasicMaterial({ color: 0x458ad5, side: THREE.BackSide, transparent: true, opacity: .1, depthWrite: false })));
    this.earthAtmosphere.scale.setScalar(3.065);
    this.earthRoot.add(this.earthAtmosphere);
    this.satelliteLayer = new SatelliteLayer(this.earthRoot, DISPLAY_SCALE.earthFocusKmToScene);
    this.stars = this.createStars();
    this.scene.add(this.stars);
    if (trajectories) this.setTrajectories(trajectories);
    this.applySettings(settings);
    this.resetCamera(true);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  applySettings(settings: WallpaperSettings): void {
    if (this.disposed) return;
    const changedMode = settings.viewMode !== this.settings.viewMode;
    const changedPreset = settings.cameraPreset !== this.settings.cameraPreset;
    const changedQuality = settings.quality !== this.settings.quality;
    this.settings = { ...settings };
    this.solarRoot.visible = settings.viewMode === 'solar';
    this.earthRoot.visible = settings.viewMode === 'earth';
    this.satelliteLayer.configure(settings);
    this.controls.enabled = settings.enableMouse;
    // Capture the existing camera before a quality resize uses the new scene's aspect scale.
    if (changedMode || changedPreset) this.setCameraPreset(resolveCameraPreset(settings));
    this.orbitLines.forEach(line => { line.visible = settings.showOrbits; });
    this.labelLayer.style.display = settings.showLabels ? '' : 'none';
    const quality = QUALITY_PRESETS[settings.quality];
    this.corona.visible = quality.corona;
    this.stars.geometry.setDrawRange(0, quality.stars);
    if (changedQuality || this.width === 1) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.dpr));
      if (changedQuality) this.replaceSphereGeometry(quality.segments, quality.earthSegments);
      const anisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), settings.quality === 'high' ? 4 : 2);
      for (const texture of this.textures) if (texture.anisotropy !== anisotropy) {
        texture.anisotropy = anisotropy;
        // Three uploads sampler settings when the texture version changes.
        if (texture.image) texture.needsUpdate = true;
      }
      this.resize();
    }
  }

  /** Rebuild only on app-scheduled orbit refresh; both paths use the snapshot ephemeris. */
  setTrajectories(trajectories: SolarTrajectories): void {
    if (this.disposed) return;
    for (const line of this.orbitLines) {
      line.removeFromParent(); line.geometry.dispose(); this.geometries.delete(line.geometry);
      const material = line.material as THREE.Material; material.dispose(); this.materials.delete(material);
    }
    this.orbitLines.length = 0;
    const createLine = (positions: readonly Vec3Au[], transform: (position: Vec3Au) => Vec3Au, color: number, opacity: number): THREE.Line => {
      const array = new Float32Array(positions.length * 3);
      positions.forEach((position, i) => { const p = transform(position); array.set([p.x, p.y, p.z], i * 3); });
      const geometry = this.trackGeometry(new THREE.BufferGeometry());
      geometry.setAttribute('position', new THREE.BufferAttribute(array, 3));
      const line = new THREE.Line(geometry, this.trackMaterial(new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false })));
      line.visible = this.settings.showOrbits;
      this.orbitLines.push(line);
      return line;
    };
    for (const name of PLANET_NAMES) {
      const color = new THREE.Color(PLANET_VISUALS[name].color).lerp(new THREE.Color(0x8ca8c7), .55).getHex();
      this.solarRoot.add(createLine(trajectories.planets[name].positions, solarDisplayPosition, color, .28));
    }
    this.moonRoot.add(createLine(trajectories.moonGeocentric.positions, moonDisplayOffset, 0x8c9bb3, .16));
    this.earthRoot.add(createLine(trajectories.moonGeocentric.positions, position => earthFocusPositionKm({ x: position.x * AU_KM, y: position.y * AU_KM, z: position.z * AU_KM }), 0x8c9bb3, .25));
  }

  setLabelExclusions(rectangles: readonly LabelRect[]): void { this.labelExclusions = rectangles; }

  setSatelliteSnapshot(snapshot: SatelliteSnapshot | null): void { this.satelliteLayer.setSnapshot(snapshot); }
  setSatelliteTrajectory(trajectory: SatelliteTrajectory | null): void { this.satelliteLayer.setTrajectory(trajectory); }
  setSatelliteSelection(noradId: number | null): void { this.satelliteLayer.setSelection(noradId); }

  /** App selects viewMode first; presets change the camera, not astronomical state. */
  setCameraPreset(preset: CameraPreset, immediate = false): void {
    if (this.disposed) return;
    if (!immediate) {
      // Drop old OrbitControls inertia before an app-controlled camera flight.
      const damping = this.controls.enableDamping;
      this.controls.enableDamping = false; this.controls.update(); this.controls.enableDamping = damping;
    }
    this.preset = preset;
    const positions: Record<CameraPreset, [number, number, number]> = { overview: [0, 92, 172], inner: [-18, 29, 49], outer: [108, 74, 137], earth: [7.5, 3.5, 10], earthMoon: [0, 150, 300] };
    const earth = this.settings.viewMode === 'earth';
    const to = new THREE.Vector3(...positions[preset]);
    this.cameraAspectScale = earth && preset !== 'earthMoon' ? Math.max(1, minimumCameraDistance(3.2, this.camera.aspect) / to.length()) : solarPresetAspectScale(this.camera.aspect);
    to.multiplyScalar(this.cameraAspectScale);
    const targetTo = new THREE.Vector3();
    if (preset === 'earthMoon' && earth && this.earthSnapshot) {
      const moon = earthFocusPositionKm(this.earthSnapshot.moonPositionKm);
      // Fit the full lunar orbit around the stable Earth target, including apogee margin.
      const radius = Math.hypot(moon.x, moon.y, moon.z) * 1.15 + 3.2;
      to.set(0, .42, 1).normalize().multiplyScalar(minimumCameraDistance(radius, 16 / 9) * this.cameraAspectScale);
    }
    if (immediate) {
      this.camera.position.copy(to); this.controls.target.copy(targetTo); this.transition = null;
      this.updateCameraBounds();
      const damping = this.controls.enableDamping;
      this.controls.enableDamping = false; this.controls.update(); this.controls.enableDamping = damping;
    } else {
      const from = this.camera.position.clone(), targetFrom = this.controls.target.clone();
      const fitDistance = minimumCameraDistance(earth ? 3.2 : 2.65, this.camera.aspect);
      if (from.distanceTo(targetFrom) < fitDistance) from.sub(targetFrom).setLength(fitDistance).add(targetFrom);
      this.transition = { start: performance.now(), from, to, targetFrom, targetTo };
      this.updateCameraBounds();
    }
  }

  resetCamera(immediate = false): void { this.setCameraPreset(resolveCameraPreset(this.settings), immediate); }

  render(snapshot: SolarSnapshot, earth: EarthViewSnapshot): void {
    if (this.disposed) return;
    this.earthSnapshot = earth;
    const days = Date.parse(snapshot.epoch) / 86_400_000;
    for (const name of PLANET_NAMES) {
      const visual = this.bodies.get(name)!;
      this.setSolarPosition(visual.root.position, snapshot.planets[name]);
      // Other body poles remain illustrative; Earth's full calibrated basis is below.
      if (name !== 'Earth') visual.surface.rotation.y = (days / PLANET_VISUALS[name].rotationDays % 1) * Math.PI * 2;
      const distance = this.camera.position.distanceTo(visual.root.position);
      const minimumRadius = distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 4.5 / this.height;
      visual.root.scale.setScalar(Math.max(visual.radius, minimumRadius));
    }
    this.moonRoot.position.copy(this.bodies.get('Earth')!.root.position);
    const factor = DISPLAY_SCALE.solarScale * DISPLAY_SCALE.moonDistanceExaggeration;
    this.moon.position.set(snapshot.moonGeocentricAU.x * factor, snapshot.moonGeocentricAU.z * factor, -snapshot.moonGeocentricAU.y * factor);
    this.moon.rotation.y = (days / 27.321661 % 1) * Math.PI * 2;
    this.sun.rotation.y = (days / 25.38 % 1) * Math.PI * 2;
    const [x, y, z] = earthSphereBasis(earth.orientation);
    this.basisX.set(x.x, x.y, x.z); this.basisY.set(y.x, y.y, y.z); this.basisZ.set(z.x, z.y, z.z);
    this.earthBasis.makeBasis(this.basisX, this.basisY, this.basisZ);
    this.earthFocus.quaternion.setFromRotationMatrix(this.earthBasis);
    this.bodies.get('Earth')!.surface.quaternion.copy(this.earthFocus.quaternion);
    const moonKm = earthFocusPositionKm(earth.moonPositionKm);
    this.moonFocus.position.set(moonKm.x, moonKm.y, moonKm.z);
    // Lunar surface orientation is illustrative, independent from calibrated lunar position.
    this.moonFocus.rotation.y = this.moon.rotation.y;
    this.earthLight.position.set(earth.sunDirection.x, earth.sunDirection.z, -earth.sunDirection.y).multiplyScalar(12);
    if (this.transition) {
      const t = Math.min(1, (performance.now() - this.transition.start) / 1350), eased = t * t * (3 - 2 * t);
      this.camera.position.lerpVectors(this.transition.from, this.transition.to, eased);
      this.controls.target.lerpVectors(this.transition.targetFrom, this.transition.targetTo, eased);
      if (t === 1) { this.transition = null; this.updateCameraBounds(); }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    const now = performance.now();
    if (this.settings.showLabels && now - this.lastLabelAt >= 90) { this.updateLabels(); this.lastLabelAt = now; }
  }

  getDiagnostics(): { drawCalls: number; triangles: number; textures: number; geometries: number; loadedAssets: number; failedAssets: number; pixelRatio: number;
    earthMoonDistanceKm: number; earthOrientationEpoch: string; earthKmToScene: number; satellites: number; satelliteDrawCalls: number } {
    return { drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, textures: this.renderer.info.memory.textures, geometries: this.renderer.info.memory.geometries,
      loadedAssets: this.loadedAssets, failedAssets: this.failedAssets, pixelRatio: this.renderer.getPixelRatio(),
      earthMoonDistanceKm: this.earthSnapshot ? Math.hypot(this.earthSnapshot.moonPositionKm.x, this.earthSnapshot.moonPositionKm.y, this.earthSnapshot.moonPositionKm.z) : 0,
      earthOrientationEpoch: this.earthSnapshot?.epoch ?? '', earthKmToScene: DISPLAY_SCALE.earthFocusKmToScene,
      ...this.satelliteLayer.getDiagnostics() };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.observer.disconnect();
    this.controls.removeEventListener('start', this.cancelTransition); this.controls.dispose();
    this.satelliteLayer.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.renderer.dispose(); this.renderer.domElement.remove(); this.labelLayer.remove();
  }

  private setSolarPosition(target: THREE.Vector3, p: Vec3Au): void {
    const distance = Math.hypot(p.x, p.y, p.z);
    const scale = distance ? DISPLAY_SCALE.solarScale * Math.log1p(distance) / distance : DISPLAY_SCALE.solarScale;
    target.set(p.x * scale, p.z * scale, -p.y * scale);
  }
  private resize(): void {
    this.width = Math.max(1, this.container.clientWidth); this.height = Math.max(1, this.container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, QUALITY_PRESETS[this.settings.quality].dpr);
    if (this.renderer.getPixelRatio() !== dpr) this.renderer.setPixelRatio(dpr);
    this.camera.aspect = this.width / this.height;
    const nextScale = this.settings.viewMode === 'earth' && this.preset !== 'earthMoon'
      ? Math.max(1, minimumCameraDistance(3.2, this.camera.aspect) / Math.hypot(7.5, 3.5, 10))
      : solarPresetAspectScale(this.camera.aspect);
    const ratio = nextScale / this.cameraAspectScale;
    this.camera.position.sub(this.controls.target).multiplyScalar(ratio).add(this.controls.target);
    if (this.transition) {
      this.transition.from.sub(this.transition.targetFrom).multiplyScalar(ratio).add(this.transition.targetFrom);
      this.transition.to.sub(this.transition.targetTo).multiplyScalar(ratio).add(this.transition.targetTo);
    }
    this.cameraAspectScale = nextScale;
    this.updateCameraBounds(true);
    this.renderer.setSize(this.width, this.height, false);
  }
  private updateCameraBounds(preserveCurrentDistance = false): void {
    const travelDistances = this.transition ? [this.transition.from.distanceTo(this.transition.targetFrom), this.transition.to.distanceTo(this.transition.targetTo)] : [];
    if (preserveCurrentDistance) travelDistances.push(this.camera.position.distanceTo(this.controls.target));
    const bounds = cameraDistanceBounds(this.settings.viewMode === 'earth', this.camera.aspect, this.cameraAspectScale, travelDistances);
    this.camera.near = bounds.near;
    this.controls.minDistance = bounds.minDistance;
    this.controls.maxDistance = bounds.maxDistance;
    this.camera.far = bounds.far;
    this.camera.updateProjectionMatrix();
  }
  private replaceSphereGeometry(segments: number, earthSegments: number): void {
    const replacement = this.trackGeometry(new THREE.SphereGeometry(1, segments, segments / 2));
    const earthReplacement = this.trackGeometry(new THREE.SphereGeometry(1, earthSegments, earthSegments / 2));
    this.scene.traverse(node => {
      if (node instanceof THREE.Mesh && node.geometry instanceof THREE.SphereGeometry) {
        node.geometry = node === this.earthFocus || node === this.earthAtmosphere ? earthReplacement : replacement;
      }
    });
    for (const geometry of this.geometries) if (geometry instanceof THREE.SphereGeometry && geometry !== replacement && geometry !== earthReplacement) { geometry.dispose(); this.geometries.delete(geometry); }
  }
  private loadTexture(file: string): THREE.Texture {
    const texture = this.textureLoader.load(`${import.meta.env.BASE_URL}textures/${file}`, () => {
      if (this.disposed) texture.dispose(); else this.loadedAssets++;
    }, undefined, () => { this.failedAssets++; });
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(2, this.renderer.capabilities.getMaxAnisotropy());
    this.textures.add(texture); return texture;
  }
  private createSaturnRings(): THREE.Mesh {
    const geometry = this.trackGeometry(new THREE.RingGeometry(1.22, 2.3, 96));
    const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
    for (let i = 0; i < positions.count; i++) uv.setXY(i, (Math.hypot(positions.getX(i), positions.getY(i)) - 1.22) / 1.08, .5);
    const mesh = new THREE.Mesh(geometry, this.trackMaterial(new THREE.MeshStandardMaterial({ map: this.loadTexture('2k_saturn_ring_alpha.png'), side: THREE.DoubleSide, transparent: true, opacity: .9, roughness: 1, depthWrite: false, alphaTest: .02 })));
    // Illustrative pole presentation: face the overview camera rather than rendering a hairline.
    // Saturn's pole presentation remains illustrative; only Earth's basis is calibrated.
    mesh.rotation.x = -Math.PI / 2 + THREE.MathUtils.degToRad(26.73); return mesh;
  }
  private createStars(): THREE.Points {
    const count = QUALITY_PRESETS.high.stars, positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
    const random = mulberry32(61082), tint = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const theta = random() * Math.PI * 2, z = random() * 2 - 1, radius = 1100 * Math.sqrt(1 - z * z);
      positions.set([radius * Math.cos(theta), 1100 * z, radius * Math.sin(theta)], i * 3);
      tint.setHex(i % 9 === 0 ? 0xffd6ad : 0xbcd1f1).multiplyScalar(.25 + random() * .55);
      colors.set([tint.r, tint.g, tint.b], i * 3);
    }
    const geometry = this.trackGeometry(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setDrawRange(0, QUALITY_PRESETS[this.settings.quality].stars);
    return new THREE.Points(geometry, this.trackMaterial(new THREE.PointsMaterial({ vertexColors: true, size: 1.45, sizeAttenuation: false, transparent: true, opacity: .68, depthWrite: false })));
  }
  private makeLabel(text: string, color: string): HTMLElement {
    const element = document.createElement('div'); element.textContent = text;
    element.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;white-space:nowrap;font:500 10px/18px system-ui,sans-serif;letter-spacing:.07em;color:${color};text-shadow:0 1px 5px #000,0 0 12px #000;opacity:.76;will-change:transform;`;
    this.labelLayer.appendChild(element); return element;
  }
  private updateLabels(): void {
    this.sunLabel.style.visibility = 'hidden'; this.moonLabel.style.visibility = 'hidden';
    for (const body of this.bodies.values()) body.label.style.visibility = 'hidden';
    const occupied: LabelRect[] = [...this.labelExclusions];
    const place = (object: THREE.Object3D, label: HTMLElement, radius: number) => {
      object.getWorldPosition(this.world); this.projected.copy(this.world).project(this.camera);
      if (this.projected.z < -1 || this.projected.z > 1 || Math.abs(this.projected.x) > 1.1 || Math.abs(this.projected.y) > 1.1) { label.style.visibility = 'hidden'; return; }
      const x = (this.projected.x * .5 + .5) * this.width, y = (-this.projected.y * .5 + .5) * this.height;
      const pixelRadius = radius * this.height / (2 * Math.max(.01, this.camera.position.distanceTo(this.world)) * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
      const rect = placeLabel(x, y, label.offsetWidth || 80, 18, this.width, this.height, occupied, pixelRadius);
      label.style.visibility = rect ? 'visible' : 'hidden';
      if (rect) { occupied.push(rect); label.style.transform = `translate3d(${Math.round(rect.x)}px,${Math.round(rect.y)}px,0)`; }
    };
    if (this.settings.viewMode === 'earth') {
      place(this.earthFocus, this.bodies.get('Earth')!.label, 3);
      place(this.moonFocus, this.moonLabel, MOON_RADIUS_KM * DISPLAY_SCALE.earthFocusKmToScene);
      return;
    }
    place(this.sun, this.sunLabel, 2.55);
    for (const name of ['Earth', 'Saturn', 'Jupiter', 'Mars', 'Venus', 'Mercury', 'Uranus', 'Neptune'] as PlanetName[]) {
      const body = this.bodies.get(name)!; place(body.root, body.label, body.root.scale.x * (name === 'Saturn' ? 2.3 : 1));
    }
    place(this.moon, this.moonLabel, .25);
  }
  private radialTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
    const context = canvas.getContext('2d')!, gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,242,210,1)'); gradient.addColorStop(.16, 'rgba(255,217,145,.9)');
    gradient.addColorStop(.34, 'rgba(255,157,71,.19)'); gradient.addColorStop(.68, 'rgba(255,125,40,.025)'); gradient.addColorStop(1, 'rgba(255,100,20,0)');
    context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(canvas); this.textures.add(texture); return texture;
  }
  private trackMaterial<T extends THREE.Material>(material: T): T { this.materials.add(material); return material; }
  private trackGeometry<T extends THREE.BufferGeometry>(geometry: T): T { this.geometries.add(geometry); return geometry; }
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
