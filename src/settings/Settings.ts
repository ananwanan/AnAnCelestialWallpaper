export type ViewMode = 'solar' | 'earth';
export type Quality = 'low' | 'medium' | 'high';
export type CameraSetting = 'default' | 'inner' | 'outer' | 'earthMoon';

export interface WallpaperSettings {
  viewMode: ViewMode;
  cameraPreset: CameraSetting;
  showDesktopSettings: boolean;
  showSatellites: boolean;
  satelliteGroup: 'stations' | 'gps' | 'starlink';
  satelliteSelection: number;
  syncInterval: 1 | 6 | 24;
  timeScale: number;
  simulationUtc: string;
  showOrbits: boolean;
  showLabels: boolean;
  enableMouse: boolean;
  quality: Quality;
  fps: number;
  paused: boolean;
}

export const DEFAULT_SETTINGS: WallpaperSettings = {
  viewMode: 'solar', cameraPreset: 'default', showDesktopSettings: false,
  showSatellites: false, satelliteGroup: 'stations', satelliteSelection: 0,
  syncInterval: 6, timeScale: 1, simulationUtc: '', showOrbits: true, showLabels: true,
  enableMouse: true, quality: 'medium', fps: 30, paused: false,
};

/** Only named hidden combo values are supported; editor option indices are not values. */
export const USER_PROPERTY_KEYS = [
  'viewMode', 'cameraPreset', 'showDesktopSettings', 'showSatellites', 'satelliteGroup', 'satelliteSelection', 'syncInterval', 'timeScale', 'simulationUtc',
  'showOrbits', 'showLabels', 'enableMouse', 'quality',
] as const satisfies readonly (keyof WallpaperSettings)[];

export function isPropertyRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Read only an object's own data properties, ignoring inherited values and accessors. */
export function ownProperty(value: unknown, key: string): unknown {
  if (!isPropertyRecord(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

/** Validate a partial change without introducing defaults for omitted or invalid values. */
export function normalizeSettingChanges(changes: unknown): Partial<WallpaperSettings> {
  const patch: Partial<WallpaperSettings> = {};
  const viewMode = ownProperty(changes, 'viewMode');
  if (viewMode === 'solar' || viewMode === 'earth') patch.viewMode = viewMode;
  const cameraPreset = ownProperty(changes, 'cameraPreset');
  if (cameraPreset === 'default' || cameraPreset === 'inner' || cameraPreset === 'outer' || cameraPreset === 'earthMoon') patch.cameraPreset = cameraPreset;
  const satelliteGroup = ownProperty(changes, 'satelliteGroup');
  if (satelliteGroup === 'stations' || satelliteGroup === 'gps' || satelliteGroup === 'starlink') patch.satelliteGroup = satelliteGroup;
  const selection = ownProperty(changes, 'satelliteSelection');
  const satelliteSelection = typeof selection === 'string' && /^(0|[1-9]\d{0,8})$/.test(selection) ? Number(selection) : selection;
  if (typeof satelliteSelection === 'number' && Number.isSafeInteger(satelliteSelection) && satelliteSelection >= 0 && satelliteSelection <= 999_999_999) patch.satelliteSelection = satelliteSelection;
  const syncInterval = ownProperty(changes, 'syncInterval');
  if (syncInterval === 1 || syncInterval === '1') patch.syncInterval = 1;
  if (syncInterval === 6 || syncInterval === '6') patch.syncInterval = 6;
  if (syncInterval === 24 || syncInterval === '24') patch.syncInterval = 24;
  const timeScale = ownProperty(changes, 'timeScale');
  if (typeof timeScale === 'number' && Number.isFinite(timeScale)) patch.timeScale = Math.max(0, Math.min(86400, timeScale));
  const simulationUtc = ownProperty(changes, 'simulationUtc');
  if (simulationUtc === '') patch.simulationUtc = '';
  else if (typeof simulationUtc === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(simulationUtc)) {
    const at = new Date(simulationUtc);
    const canonical = simulationUtc.length === 20 ? simulationUtc.replace('Z', '.000Z') : simulationUtc;
    if (Number.isFinite(at.getTime()) && at.getUTCFullYear() >= 1962 && at.getUTCFullYear() <= 2100 && at.toISOString() === canonical) patch.simulationUtc = canonical;
  }
  for (const key of ['showDesktopSettings', 'showSatellites', 'showOrbits', 'showLabels', 'enableMouse', 'paused'] as const) {
    const value = ownProperty(changes, key);
    if (typeof value === 'boolean') patch[key] = value;
  }
  const quality = ownProperty(changes, 'quality');
  if (quality === 'low' || quality === 'medium' || quality === 'high') patch.quality = quality;
  const fps = ownProperty(changes, 'fps');
  if (typeof fps === 'number' && fps > 0 && Number.isFinite(fps)) patch.fps = Math.min(240, fps);
  return patch;
}

export function sanitizeSettings(previous: WallpaperSettings, changes: unknown): WallpaperSettings {
  return { ...previous, ...normalizeSettingChanges(changes) };
}

/** Presets remain meaningful after a separate host view-mode change. */
export function resolveCameraPreset(settings: Pick<WallpaperSettings, 'viewMode' | 'cameraPreset'>): 'overview' | 'inner' | 'outer' | 'earth' | 'earthMoon' {
  if (settings.viewMode === 'earth') return settings.cameraPreset === 'earthMoon' ? 'earthMoon' : 'earth';
  return settings.cameraPreset === 'inner' || settings.cameraPreset === 'outer' ? settings.cameraPreset : 'overview';
}

/** file:// imports stay quiet even before the host delivers its first callback. */
export function desktopSettingsAvailable(settings: Pick<WallpaperSettings, 'showDesktopSettings'>, protocol: string, hostConnected: boolean): boolean {
  return settings.showDesktopSettings || (!hostConnected && (protocol === 'http:' || protocol === 'https:'));
}
