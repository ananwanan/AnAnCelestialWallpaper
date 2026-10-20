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
import { resolveLanguage } from './i18n';
import { providerDetail, provenanceLabel, uiMessage, type UiMessageKey } from './app/uiMessages';
import { EphemerisSync } from './sync/EphemerisSync';
import { SatelliteSync } from './sync/SatelliteSync';
import { SatellitePresentation, type SatellitePresentationState } from './app/SatellitePresentation';
import type { SatelliteDataset, SatelliteSnapshot } from './satellites/types';
import './style.css';

const clock = new SimulationClock();
let settings = { ...DEFAULT_SETTINGS };
let language = resolveLanguage(settings.language);
function t(key: UiMessageKey, values: Readonly<Record<string, string | number>> = {}): string { return uiMessage(language, key, values); }
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
  <div id="canvas-container" data-i18n-aria="scene"></div>
  <nav class="view-switch hud-region" data-i18n-aria="view" hidden><button id="btn-solar" class="active" data-i18n="solar"></button><button id="btn-earth" data-i18n="earth"></button><span class="nav-divider"></span><button id="btn-settings" aria-expanded="false" aria-controls="settings-panel"><span data-i18n="settings"></span> <span aria-hidden="true">⌘</span></button></nav>
  <aside id="settings-panel" class="settings-panel hud-region" hidden>
    <div class="panel-heading"><span data-i18n="settings"></span><button id="btn-close" class="icon-button" data-i18n-aria="close">×</button></div>
    <fieldset><legend data-i18n="language"></legend><label class="select-row"><span data-i18n="language"></span><select hidden id="language"><option value="auto" data-i18n="autoLanguage"></option><option value="en">English</option><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option></select></label></fieldset>
    <fieldset><legend data-i18n="camera"></legend><div class="preset-grid"><button data-preset="overview" data-i18n="overview"></button><button data-preset="inner" data-i18n="inner"></button><button data-preset="outer" data-i18n="outer"></button><button data-preset="earthMoon" data-i18n="earthMoon"></button><button id="btn-reset" data-i18n="resetCamera"></button></div></fieldset>
    <fieldset><legend data-i18n="display"></legend><label class="toggle-row"><span data-i18n="orbits"></span><input id="show-orbits" type="checkbox" checked></label><label class="toggle-row"><span data-i18n="labels"></span><input id="show-labels" type="checkbox" checked></label><label class="toggle-row"><span data-i18n="statusBar"></span><input id="show-status-bar" type="checkbox"></label><label class="toggle-row"><span data-i18n="mouse"></span><input id="enable-mouse" type="checkbox" checked></label><label class="select-row"><span data-i18n="quality"></span><select hidden id="quality"><option value="low" data-i18n="low"></option><option value="medium" selected data-i18n="medium"></option><option value="high" data-i18n="high"></option></select></label></fieldset>
    <fieldset><legend data-i18n="simulationTime"></legend><label class="select-row"><span data-i18n="timeScale"></span><select hidden id="time-scale"><option value="0" data-i18n="paused"></option><option value="1" selected data-i18n="realTime"></option><option value="60">60×</option><option value="3600">3,600×</option><option value="86400">86,400×</option></select></label><label class="date-label" for="utc-time" data-i18n="jumpUtc"></label><input id="utc-time" type="datetime-local" step="1" min="1962-01-01T00:00:00" max="2100-12-31T23:59:59"><div class="two-buttons"><button id="btn-jump" data-i18n="applyDate"></button><button id="btn-now" data-i18n="now"></button></div><p id="time-error" class="field-error" role="status"></p></fieldset>
    <fieldset><legend data-i18n="data"></legend><label class="select-row"><span data-i18n="syncInterval"></span><select hidden id="sync-interval"><option value="1" data-i18n="oneHour"></option><option value="6" selected data-i18n="sixHours"></option><option value="24" data-i18n="day"></option></select></label><p class="panel-note" data-i18n="localNote"></p><p id="source-detail" class="source-detail"></p><p id="reference-epoch" class="source-detail"></p></fieldset>
    <fieldset><legend data-i18n="satellites"></legend><label class="toggle-row"><span data-i18n="showSatellites"></span><input id="show-satellites" type="checkbox"></label><label class="select-row"><span data-i18n="satelliteGroup"></span><select hidden id="satellite-group"><option value="stations" data-i18n="stations"></option><option value="gps">GPS</option></select></label><label class="select-row"><span data-i18n="selectSatellite"></span><select hidden id="satellite-selection" disabled><option value="" data-i18n="noData"></option></select></label><p id="satellite-source" class="source-detail"></p><p id="satellite-detail" class="source-detail"></p><p class="panel-note" data-i18n="satelliteNote"></p></fieldset>
    <p class="panel-note" data-i18n="earthNote"></p><p id="performance-status" class="performance-status"></p>
  </aside>
  <aside id="satellite-card" class="satellite-card hud-region" hidden><span class="overline" data-i18n="localSgp4"></span><strong id="selected-satellite-name"></strong><p id="selected-satellite-info"></p><span data-i18n="arcLegend"></span></aside>
  <footer id="status-bar" class="timeline hud-region" hidden><button id="btn-pause" class="play-button" hidden>Ⅱ</button><div class="time-block"><span class="overline" data-i18n="simulationUtc"></span><time id="current-time"></time></div><span id="time-rate" class="time-rate">1×</span><span class="footer-divider"></span><div class="source-block"><span id="source-status" class="source-badge"></span><span id="comparison-status"></span></div></footer>
  <div class="scale-note hud-region"><span id="scale-unit">AU / EQJ J2000</span><span id="scale-description"></span></div><div id="fatal-error" class="fatal-error" role="alert" hidden></div>`;

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const container = element<HTMLDivElement>('canvas-container');
const panel = element<HTMLElement>('settings-panel');
function localizeUi(): void {
  language = resolveLanguage(settings.language);
  document.documentElement.lang = language;
  document.title = t('title');
  app!.dataset.language = language;
  app!.querySelectorAll<HTMLElement>('[data-i18n]').forEach(node => { const text = t(node.dataset.i18n as UiMessageKey); if (node.textContent !== text) node.textContent = text; });
  app!.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach(node => node.setAttribute('aria-label', t(node.dataset.i18nAria as UiMessageKey)));
}
localizeUi();
const selectControls = new DesktopSelectControls(panel, () => t('noData'));
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
let invalidTimeInput = false;
let initializationError: string | null = null;

function resetSatelliteView(): void {
  satelliteDataset = null; satelliteSnapshot = null; selectedSatellite = null;
  satellitePresentationState = satellitePresentation.reset();
  const selector = document.getElementById('satellite-selection') as HTMLSelectElement | null;
  selector?.replaceChildren(new Option(t('noData'), ''));
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
    selector.replaceChildren(...(dataset?.records.length ? dataset.records.map(record => new Option(`${record.OBJECT_NAME} · ${record.NORAD_CAT_ID}`, String(record.NORAD_CAT_ID))) : [new Option(t('noData'), '')]));
    selectSatellite(settings.satelliteSelection || (dataset?.records.some(record => record.NORAD_CAT_ID === selectedSatellite) ? selectedSatellite : dataset?.records[0]?.NORAD_CAT_ID ?? null));
    if (settings.satelliteSelection && !dataset?.records.some(record => record.NORAD_CAT_ID === settings.satelliteSelection)) selector.add(new Option(t('absentSatellite', { id: settings.satelliteSelection }), String(settings.satelliteSelection)));
    selector.value = selectedSatellite === null ? '' : String(selectedSatellite); selector.disabled = !dataset?.records.length;
    scene?.setSatelliteSelection(selectedSatellite);
    if (!dataset) { satelliteSnapshot = null; scene?.setSatelliteSnapshot(null); scene?.setSatelliteTrajectory(null); }
  }
  const selector = element<HTMLSelectElement>('satellite-selection');
  if (settings.satelliteSelection && !Array.from(selector.options).some(option => option.value === String(settings.satelliteSelection))) selector.add(new Option(t('absentSatellite', { id: settings.satelliteSelection }), String(settings.satelliteSelection)));
  for (const option of Array.from(selector.options)) {
    if (dataset?.records.some(record => String(record.NORAD_CAT_ID) === option.value)) continue;
    const text = option.value ? t('absentSatellite', { id: option.value }) : t('noData');
    if (option.text !== text) option.text = text;
  }
  selector.value = selectedSatellite === null ? '' : String(selectedSatellite);
  selectControls.refresh();
  element('satellite-source').textContent = `${provenanceLabel(language, satelliteSync.status.label)} · ${providerDetail(language, satelliteSync.status.detail)}`;
  const selected = satelliteSnapshot?.states.find(state => state.noradId === selectedSatellite);
  const rejected = satelliteSnapshot?.rejected.find(state => state.noradId === selectedSatellite);
  const record = dataset?.records.find(record => record.NORAD_CAT_ID === selectedSatellite);
  const detail = selected ? t('satelliteInfo', { id: selected.noradId, altitude: selected.altitudeKm.toFixed(1), age: selected.ageDays.toFixed(2), stale: selected.stale ? t('stale') : '', elementEpoch: selected.elementEpoch, epoch: satelliteSnapshot!.epoch }) : rejected ? t('rejectedSatellite', { id: rejected.noradId, reason: rejected.reason }) : record ? t('recordInfo', { epoch: record.EPOCH }) : settings.satelliteSelection ? t('missingSatellite', { id: settings.satelliteSelection }) : t('noOrbitData');
  const diagnostic = satellitePresentationState.diagnostic;
  element('satellite-detail').textContent = diagnostic ? `${detail}\n${diagnostic}` : detail;
  element('selected-satellite-name').textContent = selected?.name ?? record?.OBJECT_NAME ?? t('noSatellite');
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
function updatePerformanceStatus(): void {
  if (!scene || frames === 0) return;
  element('performance-status').textContent = t('performance', { cap: settings.fps, fps: app!.dataset.observedFps ?? '0.0', calls: scene.getDiagnostics().drawCalls, quality: t(settings.quality), paused: settings.paused ? t('hostPaused') : '' });
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
  const badge = element('source-status'); badge.textContent = provenanceLabel(language, status.label); badge.dataset.state = sync.state;
  element('comparison-status').textContent = t(status.pending ? 'comparing' : comparison ? comparison.passed ? 'comparisonPassed' : 'comparisonFailed' : sync.state === 'offline' || sync.state === 'failed' ? 'offline' : 'localEphemeris');
  element('source-detail').textContent = providerDetail(language, status.detail);
  element('reference-epoch').textContent = compared ? t('referenceEpoch', { epoch: compared.epoch.replace('T', ' '), retrievedAt: compared.retrievedAt }) : t('noReference');
  app!.dataset.sourceState = sync.state; app!.dataset.comparisonPassed = String(comparison?.passed ?? 'unavailable');
};
renderUi = () => {
  localizeUi();
  const desktopControls = desktopSettingsAvailable(settings, location.protocol, hostConnected);
  app.dataset.desktopSettings = String(desktopControls);
  app.dataset.hostConnected = String(hostConnected);
  element('btn-settings').closest('nav')!.hidden = !desktopControls;
  element('status-bar').hidden = !settings.showStatusBar;
  element('btn-pause').hidden = !desktopControls;
  element('status-bar').classList.toggle('read-only', !desktopControls);
  if (!desktopControls && panelOpen) showPanel(false);
  const earthView = settings.viewMode === 'earth';
  element('scale-unit').textContent = earthView ? t('earthUnit') : 'AU / EQJ J2000';
  element('scale-description').textContent = t(earthView ? 'earthScale' : 'solarScale');
  element('btn-solar').classList.toggle('active', settings.viewMode === 'solar'); element('btn-earth').classList.toggle('active', settings.viewMode === 'earth');
  element<HTMLInputElement>('show-orbits').checked = settings.showOrbits; element<HTMLInputElement>('show-labels').checked = settings.showLabels; element<HTMLInputElement>('enable-mouse').checked = settings.enableMouse;
  element<HTMLInputElement>('show-status-bar').checked = settings.showStatusBar;
  element<HTMLSelectElement>('quality').value = settings.quality;
  element<HTMLSelectElement>('language').value = settings.language;
  element<HTMLInputElement>('show-satellites').checked = settings.showSatellites;
  element<HTMLSelectElement>('satellite-group').value = settings.satelliteGroup;
  const rate = element<HTMLSelectElement>('time-scale');
  if (!Array.from(rate.options).some(option => option.value === String(settings.timeScale))) rate.add(new Option(`${settings.timeScale}×`, String(settings.timeScale)));
  rate.value = String(settings.timeScale); element<HTMLSelectElement>('sync-interval').value = String(settings.syncInterval);
  selectControls.refresh();
  element('btn-pause').textContent = settings.timeScale === 0 ? '▶' : 'Ⅱ'; element('btn-pause').setAttribute('aria-label', t(settings.timeScale === 0 ? 'resume' : 'pause'));
  element('time-rate').textContent = `${settings.timeScale.toLocaleString(language)}×`;
  element('time-error').textContent = invalidTimeInput ? t('invalidUtc') : '';
  if (initializationError !== null) element('fatal-error').textContent = t('fatal', { error: initializationError });
  updatePerformanceStatus();
  app.dataset.view = settings.viewMode; app.dataset.hostFps = String(settings.fps); app.dataset.hostPaused = String(settings.paused); app.dataset.timeScale = String(settings.timeScale);
  refreshOrbits(); updateStatus(); updateSatelliteStatus(); updateLabelExclusions();
};
function on(id: string, action: () => void): void { element(id).addEventListener('click', action, events); }
on('btn-settings', () => showPanel(!panelOpen)); on('btn-close', () => showPanel(false));
on('btn-solar', () => applySettings({ viewMode: 'solar' })); on('btn-earth', () => applySettings({ viewMode: 'earth' })); on('btn-reset', () => scene?.resetCamera());
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => button.addEventListener('click', () => { applySettings({ viewMode: button.dataset.preset === 'earthMoon' ? 'earth' : 'solar', cameraPreset: button.dataset.preset === 'overview' ? 'default' : button.dataset.preset }); }, events));
for (const [id, key] of [['show-orbits', 'showOrbits'], ['show-labels', 'showLabels'], ['show-status-bar', 'showStatusBar'], ['enable-mouse', 'enableMouse'], ['show-satellites', 'showSatellites']] as const) {
  element<HTMLInputElement>(id).addEventListener('change', () => applySettings({ [key]: element<HTMLInputElement>(id).checked }), events);
}
element<HTMLSelectElement>('satellite-group').addEventListener('change', () => applySettings({ satelliteGroup: element<HTMLSelectElement>('satellite-group').value }), events);
element<HTMLSelectElement>('satellite-selection').addEventListener('change', () => {
  applySettings({ satelliteSelection: Number(element<HTMLSelectElement>('satellite-selection').value) || 0 });
  updateSatelliteStatus();
}, events);
element<HTMLSelectElement>('quality').addEventListener('change', () => { applySettings({ quality: element<HTMLSelectElement>('quality').value }); refreshOrbits(true); }, events);
element<HTMLSelectElement>('language').addEventListener('change', () => applySettings({ language: element<HTMLSelectElement>('language').value }), events);
window.addEventListener('languagechange', () => { if (settings.language === 'auto') applySettings({}); }, events);
element<HTMLSelectElement>('time-scale').addEventListener('change', () => applySettings({ timeScale: Number(element<HTMLSelectElement>('time-scale').value) }), events);
element<HTMLSelectElement>('sync-interval').addEventListener('change', () => applySettings({ syncInterval: element<HTMLSelectElement>('sync-interval').value }), events);
on('btn-pause', () => applySettings({ timeScale: settings.timeScale > 0 ? 0 : previousRate }));
on('btn-now', () => { clock.reset(); satellitePresentationState = satellitePresentation.reset(); applySettings({ timeScale: 1, simulationUtc: '' }); timeInput.value = formatUtcInput(clock.at()); refreshOrbits(true); });
on('btn-jump', () => { const at = parseUtcInput(timeInput.value); invalidTimeInput = !at; element('time-error').textContent = at ? '' : t('invalidUtc'); if (at) { applySettings({ simulationUtc: at.toISOString() }); refreshOrbits(true); } });
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
      updatePerformanceStatus();
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
  initializationError = error instanceof Error ? error.message : '';
  const message = element('fatal-error'); message.hidden = false; message.textContent = t('fatal', { error: initializationError });
  console.error('Celestial initialization failed', error);
}
document.addEventListener('visibilitychange', () => { updateLifecycle?.(); if (!suspended()) updateStatus(); }, events);
window.addEventListener('resize', updateLabelExclusions, events);
window.addEventListener('pagehide', () => { disposed = true; abortEvents.abort(); selectControls.dispose(); if (orbitTimer !== null) clearTimeout(orbitTimer); syncTask?.dispose(); satelliteTask?.dispose(); satelliteSync?.dispose(); loop?.dispose(); sync?.dispose(); scene?.dispose(); removeHostBridge(); }, { once: true });
