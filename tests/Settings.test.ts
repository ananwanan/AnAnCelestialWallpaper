import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, desktopSettingsAvailable, normalizeSettingChanges, resolveCameraPreset, sanitizeSettings } from '../src/settings/Settings';

describe('validated partial wallpaper settings', () => {
  it('starts satellite work disabled and limits the browser fallback to 30 FPS', () => {
    expect(DEFAULT_SETTINGS.showSatellites).toBe(false);
    expect(DEFAULT_SETTINGS.fps).toBe(30);
    expect(DEFAULT_SETTINGS.syncInterval).toBe(6);
    expect(DEFAULT_SETTINGS.showDesktopSettings).toBe(false);
  });

  it('keeps native imports quiet before host delivery and preserves HTTP development controls', () => {
    expect(desktopSettingsAvailable(DEFAULT_SETTINGS, 'file:', false)).toBe(false);
    expect(desktopSettingsAvailable(DEFAULT_SETTINGS, 'file:', true)).toBe(false);
    expect(desktopSettingsAvailable(DEFAULT_SETTINGS, 'http:', false)).toBe(true);
    expect(desktopSettingsAvailable(DEFAULT_SETTINGS, 'http:', true)).toBe(false);
    expect(desktopSettingsAvailable({ showDesktopSettings: true }, 'file:', true)).toBe(true);
  });

  it('validates explicit NORAD selection without triggering a catalog-group change', () => {
    expect(normalizeSettingChanges({ satelliteSelection: '48274' })).toEqual({ satelliteSelection: 48274 });
    expect(normalizeSettingChanges({ satelliteSelection: 25544 })).toEqual({ satelliteSelection: 25544 });
    expect(normalizeSettingChanges({ satelliteSelection: '0' })).toEqual({ satelliteSelection: 0 });
    for (const satelliteSelection of ['', '-1', -1, '025544', '25544.5', 25544.5, '1e6', 1_000_000_000, null]) {
      expect(normalizeSettingChanges({ satelliteSelection })).toEqual({});
    }
    expect(sanitizeSettings(DEFAULT_SETTINGS, { satelliteSelection: '48274' }).satelliteGroup).toBe('stations');
  });

  it('accepts only canonical bounded UTC dates and the explicit reset-to-now empty value', () => {
    expect(normalizeSettingChanges({ simulationUtc: '2026-10-20T01:02:03Z' })).toEqual({ simulationUtc: '2026-10-20T01:02:03.000Z' });
    expect(normalizeSettingChanges({ simulationUtc: '2026-10-20T01:02:03.123Z' })).toEqual({ simulationUtc: '2026-10-20T01:02:03.123Z' });
    expect(normalizeSettingChanges({ simulationUtc: '' })).toEqual({ simulationUtc: '' });
    for (const simulationUtc of ['2026-02-30T00:00:00Z', '2026-10-20T01:02:03+08:00', '1961-12-31T00:00:00Z', '2101-01-01T00:00:00Z', 'now', true]) expect(normalizeSettingChanges({ simulationUtc })).toEqual({});
  });

  it('keeps camera presets compatible with independently changing Earth/Solar views', () => {
    expect(resolveCameraPreset({ viewMode: 'solar', cameraPreset: 'inner' })).toBe('inner');
    expect(resolveCameraPreset({ viewMode: 'earth', cameraPreset: 'inner' })).toBe('earth');
    expect(resolveCameraPreset({ viewMode: 'earth', cameraPreset: 'earthMoon' })).toBe('earthMoon');
    expect(resolveCameraPreset({ viewMode: 'solar', cameraPreset: 'earthMoon' })).toBe('overview');
  });

  it('preserves every unrelated setting across a sequence of partial updates', () => {
    const initial = { ...DEFAULT_SETTINGS, viewMode: 'earth' as const, timeScale: 60, showLabels: false };
    const first = sanitizeSettings(initial, { quality: 'high' });
    const second = sanitizeSettings(first, { showOrbits: false });
    expect(second).toEqual({ ...initial, quality: 'high', showOrbits: false });
    expect(initial).toEqual({ ...DEFAULT_SETTINGS, viewMode: 'earth', timeScale: 60, showLabels: false });
    expect(second.showSatellites).toBe(false);
  });

  it.each([1, 6, 24, '1', '6', '24'])('accepts exact sync interval hidden value %s', (syncInterval) => {
    expect(sanitizeSettings(DEFAULT_SETTINGS, { syncInterval }).syncInterval).toBe(Number(syncInterval));
  });

  it.each([null, undefined, [], 'earth', 0, true])('ignores malformed change containers %#', (changes) => {
    expect(sanitizeSettings(DEFAULT_SETTINGS, changes)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettingChanges(changes)).toEqual({});
  });

  it('ignores unsupported combo indices and never coerces objects or booleans into interval values', () => {
    const previous = { ...DEFAULT_SETTINGS, syncInterval: 24 as const };
    expect(sanitizeSettings(previous, { viewMode: 1, quality: 2, satelliteGroup: 0, syncInterval: true })).toEqual(previous);
    for (const syncInterval of [0, 2, '01', ' 6 ', [6], { valueOf: () => 6 }, false, null]) {
      expect(sanitizeSettings(previous, { syncInterval })).toEqual(previous);
    }
  });

  it('requires real booleans instead of truthy strings/numbers', () => {
    expect(sanitizeSettings(DEFAULT_SETTINGS, {
      showSatellites: 'true', showOrbits: 0, showLabels: null, enableMouse: 1, paused: 'false',
    })).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettingChanges({ showSatellites: false, showOrbits: false, showLabels: false, enableMouse: false, paused: false }))
      .toEqual({ showSatellites: false, showOrbits: false, showLabels: false, enableMouse: false, paused: false });
  });

  it('accepts finite time rates and positive FPS, clamps documented bounds and rejects NaN/infinities', () => {
    expect(sanitizeSettings(DEFAULT_SETTINGS, { timeScale: -4, fps: 500 })).toMatchObject({ timeScale: 0, fps: 240 });
    expect(sanitizeSettings(DEFAULT_SETTINGS, { timeScale: 100_000, fps: 0.5 })).toMatchObject({ timeScale: 86400, fps: 0.5 });
    expect(sanitizeSettings(DEFAULT_SETTINGS, { timeScale: 0.25, fps: 60 })).toMatchObject({ timeScale: 0.25, fps: 60 });
    for (const value of [NaN, Infinity, -Infinity, '60', {}, null]) {
      expect(sanitizeSettings(DEFAULT_SETTINGS, { timeScale: value, fps: value })).toEqual(DEFAULT_SETTINGS);
    }
    for (const fps of [0, -1]) expect(sanitizeSettings(DEFAULT_SETTINGS, { fps })).toEqual(DEFAULT_SETTINGS);
  });

  it('ignores inherited/accessor fields and unknown keys without invoking getters', () => {
    const inherited = Object.create({ showSatellites: true, quality: 'low' }) as Record<string, unknown>;
    Object.defineProperty(inherited, 'timeScale', { get: () => { throw new Error('do not execute'); } });
    inherited.showLabels = false;
    inherited.unknown = true;
    expect(normalizeSettingChanges(inherited)).toEqual({ showLabels: false });
  });
});
