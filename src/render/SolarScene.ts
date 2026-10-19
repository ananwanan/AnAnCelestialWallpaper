import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { heliocentricAu, PLANET_NAMES, type PlanetName, type Vec3Au } from '../astronomy/planetEphemeris';
import type { WallpaperSettings } from '../settings/Settings';

interface PlanetStyle { color: number; radius: number; periodDays: number; accent: number; }
const PLANETS: Record<PlanetName, PlanetStyle> = {
  Mercury: { color: 0x8f8c87, radius: 0.14, periodDays: 87.97, accent: 0xb9a99e },
  Venus:   { color: 0xdbc29b, radius: 0.22, periodDays: 224.70, accent: 0xf1ddba },
  Earth:   { color: 0x21559b, radius: 0.24, periodDays: 365.256, accent: 0x3a9669 },
  Mars:    { color: 0xaa4f34, radius: 0.18, periodDays: 686.98, accent: 0xd47945 },
  Jupiter: { color: 0xbca18c, radius: 0.70, periodDays: 4332.59, accent: 0x90634e },
  Saturn:  { color: 0xcabb96, radius: 0.60, periodDays: 10759.2, accent: 0x9d875e },
  Uranus:  { color: 0x87c8d4, radius: 0.40, periodDays: 30688.5, accent: 0xbee3e6 },
  Neptune: { color: 0x2955b3, radius: 0.39, periodDays: 60182, accent: 0x538cd4 },
};

const AU_TO_SOLAR = 14;
const EARTH_RADIUS_FOCUS = 3;

/** M0: Offline, time-correct solar positions with intentionally exaggerated artistic radii. */
export class SolarScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly solarRoot = new THREE.Group();
  private readonly earthRoot = new THREE.Group();
  private readonly planetMeshes = new Map<PlanetName, THREE.Mesh>();
  private readonly orbitLines: THREE.LineLoop[] = [];
  private readonly earthFocus: THREE.Mesh;
  private settings: WallpaperSettings;
  private observer: ResizeObserver;

  constructor(private readonly container: HTMLElement, settings: WallpaperSettings) {
    this.settings = settings;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x030712);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 4000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 2500;

    this.scene.add(this.solarRoot, this.earthRoot);
    this.scene.add(new THREE.AmbientLight(0x8391b6, 0.55));
    const solarLight = new THREE.PointLight(0xffffff, 80, 0, 2);
    solarLight.position.set(0, 0, 0);
    this.solarRoot.add(solarLight);
    const earthLight = new THREE.DirectionalLight(0xfff8ef, 3.1);
    earthLight.position.set(10, 3, 6);
    this.earthRoot.add(earthLight);

    this.createStars();
    this.createSun();
    this.createPlanets();
    this.earthFocus = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS_FOCUS, 64, 48),
      new THREE.MeshStandardMaterial({ map: makeProceduralTexture('Earth', 0x24539c, 0x2f9061), roughness: 0.92 }),
    );
    this.earthRoot.add(this.earthFocus);
    this.createEarthAtmosphere();
    this.resetCamera();
    this.applySettings(settings);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  applySettings(settings: WallpaperSettings): void {
    const changedMode = settings.viewMode !== this.settings.viewMode;
    this.settings = settings;
    this.solarRoot.visible = settings.viewMode === 'solar';
    this.earthRoot.visible = settings.viewMode === 'earth';
    this.orbitLines.forEach(o => { o.visible = settings.showOrbits; });
    this.controls.enabled = settings.enableMouse;
    const maxDpr = settings.quality === 'high' ? 2 : settings.quality === 'medium' ? 1.5 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    if (changedMode) this.resetCamera();
    this.resize();
  }

  resetCamera(): void {
    const earth = this.settings.viewMode === 'earth';
    this.camera.position.set(earth ? 9 : 0, earth ? 7 : 360, earth ? 14 : 980);
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = earth ? 4.2 : 4;
    this.controls.maxDistance = earth ? 100 : 2500;
    this.controls.update();
  }

  render(at: Date): void {
    if (this.settings.viewMode === 'solar') {
      for (const name of PLANET_NAMES) {
        const p = toRenderPosition(heliocentricAu(name, at));
        const mesh = this.planetMeshes.get(name)!;
        mesh.position.copy(p);
        mesh.rotation.y = (at.getTime() / 86_164_000) % (Math.PI * 2);
      }
    } else {
      // M0 illustration only. Earth frame/orientation and satellite layer are M3/M4 milestones.
      this.earthFocus.rotation.y = ((at.getTime() % 86_164_000) / 86_164_000) * Math.PI * 2;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.observer.disconnect();
    this.controls.dispose();
    this.scene.traverse((node) => {
      if (node instanceof THREE.Mesh || node instanceof THREE.Points || node instanceof THREE.Line) {
        node.geometry.dispose();
        const material = node.material;
        const materials = Array.isArray(material) ? material : [material];
        materials.forEach(m => m.dispose());
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private createSun(): void {
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 48, 32),
      new THREE.MeshBasicMaterial({ color: 0xffdc92 }),
    );
    this.solarRoot.add(sun);
    const material = new THREE.SpriteMaterial({
      map: makeGlow(), color: 0xffa850, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.76,
    });
    const halo = new THREE.Sprite(material);
    halo.scale.set(26, 26, 1);
    this.solarRoot.add(halo);
  }

  private createPlanets(): void {
    const epoch = new Date('2026-01-01T00:00:00.000Z');
    for (const name of PLANET_NAMES) {
      const { color, radius, periodDays, accent } = PLANETS[name];
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 32, 24),
        new THREE.MeshStandardMaterial({ map: makeProceduralTexture(name, color, accent), roughness: 0.86, metalness: 0 }),
      );
      this.planetMeshes.set(name, mesh);
      this.solarRoot.add(mesh);
      if (name === 'Saturn') {
        const rings = new THREE.Mesh(
          new THREE.RingGeometry(radius * 1.25, radius * 2.25, 64),
          new THREE.MeshBasicMaterial({ color: 0xa99677, side: THREE.DoubleSide, transparent: true, opacity: 0.55, depthWrite: false }),
        );
        rings.rotation.x = -Math.PI / 2.5;
        mesh.add(rings);
      }
      const points: THREE.Vector3[] = [];
      for (let i = 0; i < 240; ++i) {
        const time = new Date(epoch.getTime() + periodDays * 86_400_000 * i / 240);
        points.push(toRenderPosition(heliocentricAu(name, time)));
      }
      const orbit = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0x7e9fbf), 0.45), transparent: true, opacity: 0.31, depthWrite: false }),
      );
      this.orbitLines.push(orbit);
      this.solarRoot.add(orbit);
    }
  }

  private createEarthAtmosphere(): void {
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS_FOCUS * 1.065, 64, 40),
      new THREE.MeshBasicMaterial({ color: 0x286bc5, transparent: true, opacity: 0.09, side: THREE.BackSide, depthWrite: false }),
    );
    this.earthRoot.add(atmosphere);
  }

  private createStars(): void {
    const rand = mulberry32(61082);
    const stars = new Float32Array(2000 * 3);
    for (let i = 0; i < stars.length; i += 3) {
      const theta = rand() * Math.PI * 2;
      const z = rand() * 2 - 1;
      const r = 1250 * Math.sqrt(1 - z * z);
      stars[i] = r * Math.cos(theta);
      stars[i + 1] = 1250 * z;
      stars[i + 2] = r * Math.sin(theta);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(stars, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xb9c9e7, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.7, depthWrite: false }));
    this.scene.add(points);
  }
}

function toRenderPosition(p: Vec3Au): THREE.Vector3 {
  return new THREE.Vector3(p.x, p.z, -p.y).multiplyScalar(AU_TO_SOLAR);
}

function makeProceduralTexture(name: string, base: number, accent: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const color = new THREE.Color(base);
  const accentColor = new THREE.Color(accent);
  const rgb = (v: THREE.Color) => `rgb(${Math.round(v.r * 255)}, ${Math.round(v.g * 255)}, ${Math.round(v.b * 255)})`;
  ctx.fillStyle = rgb(color);
  ctx.fillRect(0, 0, 256, 128);
  const rand = mulberry32(name.split('').reduce((s, c) => s + c.charCodeAt(0), 0));
  for (let j = 0; j < 34; j++) {
    ctx.fillStyle = rgb((j % 2 ? color : accentColor).clone().lerp(color, rand() * 0.65));
    ctx.globalAlpha = 0.22 + rand() * 0.3;
    if (name === 'Jupiter' || name === 'Saturn' || name === 'Uranus') {
      ctx.fillRect(0, rand() * 128, 256, 1 + rand() * 9);
    } else {
      ctx.beginPath();
      ctx.ellipse(rand() * 256, rand() * 128, 4 + rand() * 25, 2 + rand() * 8, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeGlow(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,240,190,1)');
  grad.addColorStop(0.14, 'rgba(255,200,110,.95)');
  grad.addColorStop(0.39, 'rgba(255,120,32,.34)');
  grad.addColorStop(1, 'rgba(255,100,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
