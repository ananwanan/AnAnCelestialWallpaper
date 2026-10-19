export type ViewMode = 'solar' | 'earth';
export type Quality = 'low' | 'medium' | 'high';

export interface WallpaperSettings {
  viewMode: ViewMode;
  showSatellites: boolean;
  satelliteGroup: 'stations' | 'gps' | 'starlink';
  syncInterval: 1 | 6 | 24;
  timeScale: number;
  showOrbits: boolean;
  showLabels: boolean;
  enableMouse: boolean;
  quality: Quality;
  fps: number;
  paused: boolean;
}

export const DEFAULT_SETTINGS: WallpaperSettings = {
  viewMode: 'solar', showSatellites: false, satelliteGroup: 'stations',
  syncInterval: 6, timeScale: 1, showOrbits: true, showLabels: true,
  enableMouse: true, quality: 'medium', fps: 30, paused: false,
};

/** Only named hidden combo values are supported; editor option indices are not values. */
export const USER_PROPERTY_KEYS = [
  'viewMode', 'showSatellites', 'satelliteGroup', 'syncInterval', 'timeScale',
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
  const satelliteGroup = ownProperty(changes, 'satelliteGroup');
  if (satelliteGroup === 'stations' || satelliteGroup === 'gps' || satelliteGroup === 'starlink') patch.satelliteGroup = satelliteGroup;
  const syncInterval = ownProperty(changes, 'syncInterval');
  if (syncInterval === 1 || syncInterval === '1') patch.syncInterval = 1;
  if (syncInterval === 6 || syncInterval === '6') patch.syncInterval = 6;
  if (syncInterval === 24 || syncInterval === '24') patch.syncInterval = 24;
  const timeScale = ownProperty(changes, 'timeScale');
  if (typeof timeScale === 'number' && Number.isFinite(timeScale)) patch.timeScale = Math.max(0, Math.min(86400, timeScale));
  for (const key of ['showSatellites', 'showOrbits', 'showLabels', 'enableMouse', 'paused'] as const) {
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
