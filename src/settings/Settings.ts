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

export function sanitizeSettings(previous: WallpaperSettings, changes: Record<string, unknown>): WallpaperSettings {
  const s = { ...previous };
  if (changes.viewMode === 'solar' || changes.viewMode === 'earth') s.viewMode = changes.viewMode;
  if (typeof changes.showSatellites === 'boolean') s.showSatellites = changes.showSatellites;
  if (changes.satelliteGroup === 'stations' || changes.satelliteGroup === 'gps' || changes.satelliteGroup === 'starlink') s.satelliteGroup = changes.satelliteGroup;
  if ([1, 6, 24].includes(Number(changes.syncInterval))) s.syncInterval = Number(changes.syncInterval) as 1 | 6 | 24;
  if (typeof changes.timeScale === 'number' && Number.isFinite(changes.timeScale)) s.timeScale = Math.max(0, Math.min(86400, changes.timeScale));
  for (const key of ['showOrbits', 'showLabels', 'enableMouse'] as const) {
    const value = changes[key];
    if (typeof value === 'boolean') s[key] = value;
  }
  if (changes.quality === 'low' || changes.quality === 'medium' || changes.quality === 'high') s.quality = changes.quality;
  if (typeof changes.fps === 'number' && changes.fps > 0 && Number.isFinite(changes.fps)) s.fps = Math.min(240, changes.fps);
  if (typeof changes.paused === 'boolean') s.paused = changes.paused;
  return s;
}
