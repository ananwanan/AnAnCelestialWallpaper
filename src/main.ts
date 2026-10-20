import { SimulationClock } from './app/SimulationClock';
import { applyClockSettings } from './app/applyClockSettings';
import { RenderLoop } from './app/RenderLoop';
import { PeriodicTask } from './app/PeriodicTask';
import { formatUtcInput, parseUtcInput } from './app/utcInput';
import { createSolarSnapshot, geoMoonAu, heliocentricAu, sampleSolarTrajectories } from './astronomy/planetEphemeris';
import { createEarthViewSnapshot } from './astronomy/earthOrientation';
import { compareEphemerisSnapshot, type EphemerisSnapshot, type EphemerisComparison } from './astronomy/ephemerisSnapshot';
import { SolarScene } from './render/SolarScene';
import { DEFAULT_SETTINGS, desktopSettingsAvailable, sanitizeSettings } from './settings/Settings';
import { registerWallpaperBridge } from './settings/WallpaperEngineBridge';
import { DesktopSelectControls } from './settings/DesktopSelectControls';
import { EphemerisSync } from './sync/EphemerisSync';
import { SatelliteSync } from './sync/SatelliteSync';
import { SatellitePresentation, type SatellitePresentationState } from './app/SatellitePresentation';
import type { SatelliteDataset, SatelliteSnapshot } from './satellites/types';
import './style.css';

const clock = new SimulationClock();
let settings = { ...DEFAULT_SETTINGS };
let scene: SolarScene | null = null;
let loop: RenderLoop | null = null;
let sync: EphemerisSync | null = null;
let renderUi: (() => void) | null = null;
let updateLifecycle: (() => void) | null = null;
let syncTask: PeriodicTask | null = null;
let satelliteSync: SatelliteSync | null = null;
let satelliteTask: PeriodicTask | null = null;
let selectedSatellite: number | null = null;
let satelliteDataset: SatelliteDataset | null = null;
let satelliteSnapshot: SatelliteSnapshot | null = null;
const satellitePresentation = new SatellitePresentation();
let satellitePresentationState: SatellitePresentationState = satellitePresentation.state;
let previousRate = 1;
let disposed = false;
let hostConnected = false;
let orbitEpoch = NaN;

function suspended(): boolean { return settings.paused || document.hidden; }
function applySettings(changes: unknown): void {
  const previousGroup = settings.satelliteGroup;
  const previousSelection = settings.satelliteSelection;
  const next = sanitizeSettings(settings, changes);
  if (applyClockSettings(clock, settings, next)) {
    satellitePresentationState = satellitePresentation.reset();
    orbitEpoch = NaN;
  }
  if (next.timeScale > 0) previousRate = next.timeScale;
  if (next.syncInterval !== settings.syncInterval) sync?.setIntervalHours(next.syncInterval);
  if (next.syncInterval !== settings.syncInterval) satelliteSync?.setIntervalHours(next.syncInterval);
  if (next.satelliteGroup !== settings.satelliteGroup) { satelliteSync?.setGroup(next.satelliteGroup); resetSatelliteView(); }
  if (next.showSatellites !== settings.showSatellites) { satelliteSync?.setEnabled(next.showSatellites); resetSatelliteView(); }
  settings = next;
  if (next.satelliteSelection !== previousSelection) selectSatellite(next.satelliteSelection || satelliteDataset?.records[0]?.NORAD_CAT_ID || null);
  scene?.applySettings(settings);
  updateLifecycle?.();
  if (settings.showSatellites && next.satelliteGroup !== previousGroup) void satelliteSync?.tick().then(updateSatelliteStatus);
  renderUi?.();
}
// Host registration precedes DOM, texture loads and WebGL initialization.
const removeHostBridge = registerWallpaperBridge(applySettings, window, () => { hostConnected = true; renderUi?.(); });
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app not found');
app.innerHTML = `
  <div id="canvas-container" aria-label="三维太阳系"></div>
  <header class="identity hud-region"><span class="identity-mark" aria-hidden="true">◌</span><div><strong>ANAN · CELESTIAL</strong><span id="view-subtitle">太阳系 · 本地星历</span></div></header>
  <nav class="view-switch hud-region" aria-label="视角" hidden><button id="btn-solar" class="active">太阳系</button><button id="btn-earth">地球</button><span class="nav-divider"></span><button id="btn-settings" aria-expanded="false" aria-controls="settings-panel">显示与时间 <span aria-hidden="true">⌘</span></button></nav>
  <aside id="settings-panel" class="settings-panel hud-region" hidden>
    <div class="panel-heading"><span>显示与时间</span><button id="btn-close" class="icon-button" aria-label="关闭设置">×</button></div>
    <fieldset><legend>镜头</legend><div class="preset-grid"><button data-preset="overview">全景</button><button data-preset="inner">内行星</button><button data-preset="outer">外行星</button><button data-preset="earthMoon">地月全景</button><button id="btn-reset">重置镜头</button></div></fieldset>
    <fieldset><legend>画面</legend><label class="toggle-row">轨道线<input id="show-orbits" type="checkbox" checked></label><label class="toggle-row">天体名称<input id="show-labels" type="checkbox" checked></label><label class="toggle-row">鼠标拖动与缩放<input id="enable-mouse" type="checkbox" checked></label><label class="select-row">画质<select hidden id="quality"><option value="low">低 · 节能</option><option value="medium" selected>中 · 均衡</option><option value="high">高 · 精细</option></select></label></fieldset>
    <fieldset><legend>模拟时间 · UTC</legend><label class="select-row">时间倍率<select hidden id="time-scale"><option value="0">暂停</option><option value="1" selected>1× 实时</option><option value="60">60×</option><option value="3600">3,600×</option><option value="86400">86,400×</option></select></label><label class="date-label" for="utc-time">跳转到 UTC 日期</label><input id="utc-time" type="datetime-local" step="1" min="1962-01-01T00:00:00" max="2100-12-31T23:59:59"><div class="two-buttons"><button id="btn-jump">应用日期</button><button id="btn-now">回到现在</button></div><p id="time-error" class="field-error" role="status"></p></fieldset>
    <fieldset><legend>数据</legend><label class="select-row">远程校验间隔<select hidden id="sync-interval"><option value="1">1 小时</option><option value="6" selected>6 小时</option><option value="24">24 小时</option></select></label><p class="panel-note">动画由本地星历计算。Horizons 只校验同一 UTC 时刻的数据，断网可继续运行。</p><p id="source-detail" class="source-detail"></p><p id="reference-epoch" class="source-detail"></p></fieldset>
    <fieldset><legend>人造卫星 · 默认关闭</legend><label class="toggle-row">显示预测卫星<input id="show-satellites" type="checkbox"></label><label class="select-row">数据组<select hidden id="satellite-group"><option value="stations">ISS / 天宫</option><option value="gps">GPS</option></select></label><label class="select-row">选择卫星<select hidden id="satellite-selection" disabled><option value="">暂无数据</option></select></label><p id="satellite-source" class="source-detail">Off · 无卫星请求</p><p id="satellite-detail" class="source-detail"></p><p class="panel-note">SGP4 本地预测；青色为近期、金色为未来。源数据至少间隔 2 小时更新。地球姿态采用 UT1≈UTC，未使用极移修正；卫星位置为近似可视化。</p></fieldset>
    <p class="panel-note">地球特写以 km 独立计量，地月距离和半径比例保留。地球使用恒星时及岁差章动模型校准；地表贴图为静态参考，非实时遥感。</p><p id="performance-status" class="performance-status"></p>
  </aside>
  <aside id="satellite-card" class="satellite-card hud-region" hidden><span class="overline">SGP4 · LOCAL PREDICTION</span><strong id="selected-satellite-name"></strong><p id="selected-satellite-info"></p><span>青色：近期预测 · 金色：未来预测</span></aside>
  <footer class="timeline hud-region"><button id="btn-pause" class="play-button" aria-label="暂停模拟时间" hidden>Ⅱ</button><div class="time-block"><span class="overline">SIMULATION · UTC</span><time id="current-time"></time></div><span id="time-rate" class="time-rate">1×</span><span class="footer-divider"></span><div class="source-block"><span id="source-status" class="source-badge">Local prediction</span><span id="comparison-status">本地星历</span></div></footer>
  <div class="scale-note hud-region"><span id="scale-unit">AU / EQJ J2000</span><span id="scale-description">轨道间距压缩 · 天体尺寸放大</span></div><div id="fatal-error" class="fatal-error" role="alert" hidden></div>`;

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const container = element<HTMLDivElement>('canvas-container');
const panel = element<HTMLElement>('settings-panel');
const selectControls = new DesktopSelectControls(panel);
const timeLabel = element<HTMLTimeElement>('current-time');
const timeInput = element<HTMLInputElement>('utc-time');
const abortEvents = new AbortController();
const events = { signal: abortEvents.signal };
let panelOpen = false;
let lastLabelMs = -Infinity;
let frames = 0;
let fpsSampleStart = performance.now();
let fpsSampleFrames = 0;
let orbitTimer: ReturnType<typeof setTimeout> | null = null;
let compared: EphemerisSnapshot | null = null;
let comparison: EphemerisComparison | null = null;

function resetSatelliteView(): void {
  satelliteDataset = null; satelliteSnapshot = null; selectedSatellite = null;
  satellitePresentationState = satellitePresentation.reset();
  const selector = document.getElementById('satellite-selection') as HTMLSelectElement | null;
  selector?.replaceChildren(new Option('暂无可用数据', ''));
  if (selector) selector.disabled = true;
  scene?.setSatelliteSnapshot(null); scene?.setSatelliteTrajectory(null); scene?.setSatelliteSelection(null);
}
function selectSatellite(noradId: number | null): void {
  selectedSatellite = noradId;
  scene?.setSatelliteSelection(selectedSatellite); scene?.setSatelliteTrajectory(null);
  satellitePresentationState = satellitePresentation.reset();
}
function updateSatelliteStatus(): void {
  if (!satelliteSync) return;
  const dataset = satelliteSync.dataset;
  if (dataset !== satelliteDataset) {
    satelliteDataset = dataset;
    const selector = element<HTMLSelectElement>('satellite-selection');
    selector.replaceChildren(...(dataset?.records.length ? dataset.records.map(record => new Option(`${record.OBJECT_NAME} · ${record.NORAD_CAT_ID}`, String(record.NORAD_CAT_ID))) : [new Option('暂无可用数据', '')]));
    selectSatellite(settings.satelliteSelection || (dataset?.records.some(record => record.NORAD_CAT_ID === selectedSatellite) ? selectedSatellite : dataset?.records[0]?.NORAD_CAT_ID ?? null));
    if (settings.satelliteSelection && !dataset?.records.some(record => record.NORAD_CAT_ID === settings.satelliteSelection)) selector.add(new Option(`NORAD ${settings.satelliteSelection} · 当前组无此卫星`, String(settings.satelliteSelection)));
    selector.value = selectedSatellite === null ? '' : String(selectedSatellite); selector.disabled = !dataset?.records.length;
    scene?.setSatelliteSelection(selectedSatellite);
    if (!dataset) { satelliteSnapshot = null; scene?.setSatelliteSnapshot(null); scene?.setSatelliteTrajectory(null); }
  }
  const selector = element<HTMLSelectElement>('satellite-selection');
  if (settings.satelliteSelection && !Array.from(selector.options).some(option => option.value === String(settings.satelliteSelection))) selector.add(new Option(`NORAD ${settings.satelliteSelection} · 当前组无此卫星`, String(settings.satelliteSelection)));
  selector.value = selectedSatellite === null ? '' : String(selectedSatellite);
  selectControls.refresh();
  element('satellite-source').textContent = `${satelliteSync.status.label} · ${satelliteSync.status.detail}`;
  const selected = satelliteSnapshot?.states.find(state => state.noradId === selectedSatellite);
  const rejected = satelliteSnapshot?.rejected.find(state => state.noradId === selectedSatellite);
  const record = dataset?.records.find(record => record.NORAD_CAT_ID === selectedSatellite);
  const detail = selected ? `NORAD ${selected.noradId} · 高度 ${selected.altitudeKm.toFixed(1)} km · 源历元年龄 ${selected.ageDays.toFixed(2)} 天${selected.stale ? ' · 数据已陈旧，预测精度下降' : ''}\nOMM UTC：${selected.elementEpoch}\n位置 UTC：${satelliteSnapshot!.epoch}` : rejected ? `拒绝推算 NORAD ${rejected.noradId}：${rejected.reason}` : record ? `OMM UTC：${record.EPOCH}；切换地球视角后推算。` : settings.satelliteSelection ? `当前数据组没有 NORAD ${settings.satelliteSelection}；请选择同组编号或填 0 自动选择。` : '无可用轨道数据；不会生成虚构卫星。';
  const diagnostic = satellitePresentationState.diagnostic;
  element('satellite-detail').textContent = diagnostic ? `${detail}\n${diagnostic}` : detail;
  element('selected-satellite-name').textContent = selected?.name ?? record?.OBJECT_NAME ?? '暂无可用卫星';
  element('selected-satellite-info').textContent = diagnostic ? `${detail}\n${diagnostic}` : detail;
  element('satellite-card').hidden = !settings.showSatellites || settings.viewMode !== 'earth';
  app!.dataset.satelliteSource = satelliteSync.state;
  app!.dataset.satelliteCount = String(satelliteSnapshot?.states.length ?? 0);
  app!.dataset.satelliteEpoch = satelliteSnapshot?.epoch ?? '';
}
function updateSatellites(at: Date): void {
  const state = satellitePresentation.update({ enabled: settings.showSatellites, viewMode: settings.viewMode,
    showOrbits: settings.showOrbits, quality: settings.quality, dataset: satelliteSync?.dataset ?? null,
    selectedNoradId: selectedSatellite, at, now: performance.now() });
  if (state === satellitePresentationState) return;
  satellitePresentationState = state; satelliteSnapshot = state.snapshot;
  scene?.setSatelliteSnapshot(state.snapshot); scene?.setSatelliteTrajectory(state.trajectory);
  updateSatelliteStatus();
}

function updateLabelExclusions(): void {
  const origin = container.getBoundingClientRect();
  scene?.setLabelExclusions(Array.from(document.querySelectorAll<HTMLElement>('.hud-region')).filter(node => !node.hidden && getComputedStyle(node).display !== 'none').map(node => {
    const rect = node.getBoundingClientRect();
    return { x: rect.left - origin.left - 8, y: rect.top - origin.top - 8, width: rect.width + 16, height: rect.height + 16 };
  }));
}
function showPanel(open: boolean): void {
  open = open && desktopSettingsAvailable(settings, location.protocol, hostConnected);
  if (!open) selectControls.closeAll();
  panelOpen = open; panel.hidden = !open;
  element('btn-settings').setAttribute('aria-expanded', String(open));
  if (open) timeInput.value = formatUtcInput(clock.at());
  updateLabelExclusions();
}
function refreshOrbits(force = false): void {
  const at = clock.at();
  if (frames === 0 || suspended() || !settings.showOrbits || disposed || (!force && Math.abs(at.getTime() - orbitEpoch) < (settings.viewMode === 'earth' ? 1 : 7) * 86_400_000) || orbitTimer !== null) return;
  orbitTimer = setTimeout(() => {
    orbitTimer = null;
    if (disposed || suspended() || !settings.showOrbits) return;
    const epoch = clock.at();
    scene?.setTrajectories(sampleSolarTrajectories(epoch, settings.quality === 'low' ? 96 : 192));
    orbitEpoch = epoch.getTime();
  }, 0);
}
function updateStatus(): void {
  if (disposed || !sync) return;
  if (sync.snapshot !== compared) {
    compared = sync.snapshot;
    comparison = compared ? compareEphemerisSnapshot(compared, (body, at) => {
      if (body !== 'Moon') return heliocentricAu(body, at);
      const earth = heliocentricAu('Earth', at), moon = geoMoonAu(at);
      return { x: earth.x + moon.x, y: earth.y + moon.y, z: earth.z + moon.z };
    }) : null;
  }
  const status = sync.status;
  const badge = element('source-status'); badge.textContent = status.label; badge.dataset.state = sync.state;
  element('comparison-status').textContent = status.pending ? '远程校验中 · 本地运行' : comparison ? comparison.passed ? '参考校验通过 · 本地运行' : '参考差异待核查 · 本地运行' : sync.state === 'offline' || sync.state === 'failed' ? '离线 · 本地运行' : '本地星历';
  element('source-detail').textContent = status.detail;
  element('reference-epoch').textContent = compared ? `参考 UTC：${compared.epoch.replace('T', ' ')}；源数据获取：${compared.retrievedAt}。远程 ICRF 与本地 EQJ 为近似对齐坐标系。` : '尚无远程参考数据。';
  app!.dataset.sourceState = sync.state; app!.dataset.comparisonPassed = String(comparison?.passed ?? 'unavailable');
};
renderUi = () => {
  const desktopControls = desktopSettingsAvailable(settings, location.protocol, hostConnected);
  app.dataset.desktopSettings = String(desktopControls);
  app.dataset.hostConnected = String(hostConnected);
  element('btn-settings').closest('nav')!.hidden = !desktopControls;
  element('btn-pause').hidden = !desktopControls;
  element('btn-pause').closest('footer')!.classList.toggle('read-only', !desktopControls);
  if (!desktopControls && panelOpen) showPanel(false);
  const earthView = settings.viewMode === 'earth';
  element('view-subtitle').textContent = earthView ? '地球特写 · 本地姿态模型' : '太阳系 · 本地星历';
  element('scale-unit').textContent = earthView ? 'EARTH / km / EQJ J2000' : 'AU / EQJ J2000';
  element('scale-description').textContent = earthView ? '地月独立尺度 · UT1≈UTC · 未修正极移' : '轨道间距压缩 · 天体尺寸放大';
  element('btn-solar').classList.toggle('active', settings.viewMode === 'solar'); element('btn-earth').classList.toggle('active', settings.viewMode === 'earth');
  element<HTMLInputElement>('show-orbits').checked = settings.showOrbits; element<HTMLInputElement>('show-labels').checked = settings.showLabels; element<HTMLInputElement>('enable-mouse').checked = settings.enableMouse;
  element<HTMLSelectElement>('quality').value = settings.quality;
  element<HTMLInputElement>('show-satellites').checked = settings.showSatellites;
  element<HTMLSelectElement>('satellite-group').value = settings.satelliteGroup;
  const rate = element<HTMLSelectElement>('time-scale');
  if (!Array.from(rate.options).some(option => option.value === String(settings.timeScale))) rate.add(new Option(`${settings.timeScale}×`, String(settings.timeScale)));
  rate.value = String(settings.timeScale); element<HTMLSelectElement>('sync-interval').value = String(settings.syncInterval);
  selectControls.refresh();
  element('btn-pause').textContent = settings.timeScale === 0 ? '▶' : 'Ⅱ'; element('btn-pause').setAttribute('aria-label', settings.timeScale === 0 ? '继续模拟时间' : '暂停模拟时间');
  element('time-rate').textContent = `${settings.timeScale.toLocaleString('en-US')}×`;
  app.dataset.view = settings.viewMode; app.dataset.hostFps = String(settings.fps); app.dataset.hostPaused = String(settings.paused); app.dataset.timeScale = String(settings.timeScale);
  refreshOrbits(); updateStatus(); updateSatelliteStatus(); updateLabelExclusions();
};
function on(id: string, action: () => void): void { element(id).addEventListener('click', action, events); }
on('btn-settings', () => showPanel(!panelOpen)); on('btn-close', () => showPanel(false));
on('btn-solar', () => applySettings({ viewMode: 'solar' })); on('btn-earth', () => applySettings({ viewMode: 'earth' })); on('btn-reset', () => scene?.resetCamera());
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => button.addEventListener('click', () => { applySettings({ viewMode: button.dataset.preset === 'earthMoon' ? 'earth' : 'solar', cameraPreset: button.dataset.preset === 'overview' ? 'default' : button.dataset.preset }); }, events));
for (const [id, key] of [['show-orbits', 'showOrbits'], ['show-labels', 'showLabels'], ['enable-mouse', 'enableMouse'], ['show-satellites', 'showSatellites']] as const) {
  element<HTMLInputElement>(id).addEventListener('change', () => applySettings({ [key]: element<HTMLInputElement>(id).checked }), events);
}
element<HTMLSelectElement>('satellite-group').addEventListener('change', () => applySettings({ satelliteGroup: element<HTMLSelectElement>('satellite-group').value }), events);
element<HTMLSelectElement>('satellite-selection').addEventListener('change', () => {
  applySettings({ satelliteSelection: Number(element<HTMLSelectElement>('satellite-selection').value) || 0 });
  updateSatelliteStatus();
}, events);
element<HTMLSelectElement>('quality').addEventListener('change', () => { applySettings({ quality: element<HTMLSelectElement>('quality').value }); refreshOrbits(true); }, events);
element<HTMLSelectElement>('time-scale').addEventListener('change', () => applySettings({ timeScale: Number(element<HTMLSelectElement>('time-scale').value) }), events);
element<HTMLSelectElement>('sync-interval').addEventListener('change', () => applySettings({ syncInterval: element<HTMLSelectElement>('sync-interval').value }), events);
on('btn-pause', () => applySettings({ timeScale: settings.timeScale > 0 ? 0 : previousRate }));
on('btn-now', () => { clock.reset(); satellitePresentationState = satellitePresentation.reset(); applySettings({ timeScale: 1, simulationUtc: '' }); timeInput.value = formatUtcInput(clock.at()); refreshOrbits(true); });
on('btn-jump', () => { const at = parseUtcInput(timeInput.value); element('time-error').textContent = at ? '' : '请输入有效的 UTC 日期（1962–2100）。'; if (at) { applySettings({ simulationUtc: at.toISOString() }); refreshOrbits(true); } });
window.addEventListener('keydown', event => {
  if (!desktopSettingsAvailable(settings, location.protocol, hostConnected)) return;
  if (event.key === 'Escape') { showPanel(false); return; }
  if (event.ctrlKey || event.altKey || event.metaKey || (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest('input, select, textarea, button, a, [role="button"]')))) return;
  const key = event.key.toLowerCase();
  if (key === 's') applySettings({ viewMode: 'solar' }); if (key === 'e') applySettings({ viewMode: 'earth' }); if (key === 'r') scene?.resetCamera();
  if (key === 'o') applySettings({ showOrbits: !settings.showOrbits }); if (key === 'l') applySettings({ showLabels: !settings.showLabels });
  if (key === ' ') { event.preventDefault(); element('btn-pause').click(); }
}, events);

try {
  scene = new SolarScene(container, settings);
  sync = new EphemerisSync(import.meta.env.VITE_EPHEMERIS_BASE_URL, settings.syncInterval);
  satelliteSync = new SatelliteSync(import.meta.env.VITE_SATELLITE_BASE_URL, settings.syncInterval);
  satelliteSync.setGroup(settings.satelliteGroup); satelliteSync.setEnabled(settings.showSatellites);
  loop = new RenderLoop(() => {
    const at = clock.at(), solar = createSolarSnapshot(at); updateSatellites(at); scene!.render(solar, createEarthViewSnapshot(solar)); frames++;
    if (performance.now() - lastLabelMs > 500) {
      lastLabelMs = performance.now(); timeLabel.textContent = at.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC'); timeLabel.dateTime = at.toISOString();
      app.dataset.frameCount = String(frames); app.dataset.simTime = at.toISOString();
      const sampleNow = performance.now();
      const observedFps = (frames - fpsSampleFrames) * 1000 / Math.max(1, sampleNow - fpsSampleStart);
      fpsSampleStart = sampleNow; fpsSampleFrames = frames;
      app.dataset.observedFps = observedFps.toFixed(1);
      const metrics = scene!.getDiagnostics(); app.dataset.drawCalls = String(metrics.drawCalls); app.dataset.loadedAssets = String(metrics.loadedAssets); app.dataset.failedAssets = String(metrics.failedAssets); app.dataset.pixelRatio = String(metrics.pixelRatio);
      app.dataset.triangles = String(metrics.triangles); app.dataset.textures = String(metrics.textures); app.dataset.geometries = String(metrics.geometries);
      app.dataset.satelliteDrawCalls = String(metrics.satelliteDrawCalls); app.dataset.earthMoonDistanceKm = String(metrics.earthMoonDistanceKm); app.dataset.earthOrientationEpoch = metrics.earthOrientationEpoch;
      element('performance-status').textContent = `${settings.fps} FPS 上限 · 实际 ${observedFps.toFixed(1)} FPS · ${metrics.drawCalls} 次绘制 · ${settings.quality.toUpperCase()}${settings.paused ? ' · 宿主已暂停' : ''}`;
      updateStatus(); refreshOrbits();
    }
  });
  syncTask = new PeriodicTask(async () => { await sync?.tick(new Date()); }, updateStatus);
  satelliteTask = new PeriodicTask(async () => { await satelliteSync?.tick(); }, updateSatelliteStatus);
  updateLifecycle = () => {
    const paused = suspended();
    loop?.configure(settings.fps, paused);
    syncTask?.setSuspended(paused);
    satelliteSync?.setSuspended(paused);
    satelliteTask?.setSuspended(paused || !settings.showSatellites);
    if (paused && orbitTimer !== null) { clearTimeout(orbitTimer); orbitTimer = null; }
    if (!paused) refreshOrbits();
  };
  renderUi(); updateLifecycle(); updateStatus();
} catch (error) {
  const message = element('fatal-error'); message.hidden = false; message.textContent = `无法创建三维画面。请确认宿主支持 WebGL2 后重新载入。${error instanceof Error ? error.message : ''}`;
  console.error('Celestial initialization failed', error);
}
document.addEventListener('visibilitychange', () => { updateLifecycle?.(); if (!suspended()) updateStatus(); }, events);
window.addEventListener('resize', updateLabelExclusions, events);
window.addEventListener('pagehide', () => { disposed = true; abortEvents.abort(); selectControls.dispose(); if (orbitTimer !== null) clearTimeout(orbitTimer); syncTask?.dispose(); satelliteTask?.dispose(); satelliteSync?.dispose(); loop?.dispose(); sync?.dispose(); scene?.dispose(); removeHostBridge(); }, { once: true });
