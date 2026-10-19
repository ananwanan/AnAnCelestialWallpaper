import { SimulationClock } from './app/SimulationClock';
import { SolarScene } from './render/SolarScene';
import { DEFAULT_SETTINGS, sanitizeSettings } from './settings/Settings';
import { registerWallpaperBridge } from './settings/WallpaperEngineBridge';
import { EphemerisSync } from './sync/EphemerisSync';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app not found');

const clock = new SimulationClock();
const sync = new EphemerisSync(import.meta.env.VITE_EPHEMERIS_BASE_URL);
let settings = { ...DEFAULT_SETTINGS };
let scene: SolarScene | null = null;

function applySettings(changes: Record<string, unknown>): void {
  const next = sanitizeSettings(settings, changes);
  if (next.timeScale !== settings.timeScale) clock.setRate(next.timeScale);
  if (next.syncInterval !== settings.syncInterval) sync.setIntervalHours(next.syncInterval);
  settings = next;
  scene?.applySettings(settings);
  syncViewUi();
}

// Wallpaper Engine property listener must exist before any expensive init.
registerWallpaperBridge((changes) => applySettings(changes));

app.innerHTML = `
  <div id="canvas-container"></div>
  <div class="heading"><strong>ANAN · CELESTIAL</strong><span>真实时间轨道 · M0 本地预览</span></div>
  <div class="toolbar">
    <button id="btn-solar">太阳系</button><button id="btn-earth">地球特写</button>
    <button id="btn-orbits">轨道线</button><button id="btn-reset">重置镜头</button>
    <label>时间倍率<select id="time-scale"><option value="1">1×</option><option value="60">60×</option><option value="3600">3600×</option><option value="86400">86400×</option></select></label>
  </div>
  <div class="status"><span id="current-time"></span><span id="source-status">计算中</span></div>
  <div class="disclaimer">天体尺寸经过艺术放大 · 地球模式为 M0 演示 · 人造卫星尚未实现</div>
`;

const container = document.querySelector<HTMLDivElement>('#canvas-container')!;
scene = new SolarScene(container, settings);

const timeLabel = document.querySelector<HTMLElement>('#current-time')!;
const statusLabel = document.querySelector<HTMLElement>('#source-status')!;
const select = document.querySelector<HTMLSelectElement>('#time-scale')!;

function syncViewUi(): void {
  if (!document.querySelector('#btn-solar')) return;
  document.querySelector('#btn-solar')?.classList.toggle('active', settings.viewMode === 'solar');
  document.querySelector('#btn-earth')?.classList.toggle('active', settings.viewMode === 'earth');
  document.querySelector('#btn-orbits')?.classList.toggle('active', settings.showOrbits);
  select.value = String(settings.timeScale);
}

document.querySelector('#btn-solar')?.addEventListener('click', () => applySettings({ viewMode: 'solar' }));
document.querySelector('#btn-earth')?.addEventListener('click', () => applySettings({ viewMode: 'earth' }));
document.querySelector('#btn-orbits')?.addEventListener('click', () => applySettings({ showOrbits: !settings.showOrbits }));
document.querySelector('#btn-reset')?.addEventListener('click', () => scene?.resetCamera());
select.addEventListener('change', () => applySettings({ timeScale: Number(select.value) }));
window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  const key = event.key.toLowerCase();
  if (key === 's') applySettings({ viewMode: 'solar' });
  if (key === 'e') applySettings({ viewMode: 'earth' });
  if (key === 'r') scene?.resetCamera();
  if (key === 'o') applySettings({ showOrbits: !settings.showOrbits });
});
syncViewUi();

// Only when configured: one logical startup snapshot request; then periodic (not per-frame).
void sync.tick(clock.at());
setInterval(() => { if (!settings.paused) void sync.tick(clock.at()); }, 60_000);

let lastFrame = 0;
let lastLabel = 0;
function frame(ts: number): void {
  requestAnimationFrame(frame);
  if (settings.paused) return;
  const minFrameMs = 1_000 / settings.fps;
  if (ts - lastFrame < minFrameMs) return;
  lastFrame = ts;
  const time = clock.at();
  scene?.render(time);
  if (ts - lastLabel > 500) {
    timeLabel.textContent = time.toISOString().replace('T', ' ').replace('Z', ' UTC');
    const status = sync.state === 'synced' ? '远程快照已获取 / 轨道采用本地星历' : '离线本地星历 / 未使用远程快照';
    statusLabel.textContent = status;
    lastLabel = ts;
  }
}
requestAnimationFrame(frame);
