import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettingChanges, sanitizeSettings } from '../src/settings/Settings';

describe('validated partial wallpaper settings', () => {
  it('starts satellite work disabled and limits the browser fallback to 30 FPS', () => {
    expect(DEFAULT_SETTINGS.showSatellites).toBe(false);
    expect(DEFAULT_SETTINGS.fps).toBe(30);
    expect(DEFAULT_SETTINGS.syncInterval).toBe(6);
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
