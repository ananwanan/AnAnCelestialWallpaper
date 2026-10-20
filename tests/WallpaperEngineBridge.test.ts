import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/settings/Settings';
import { registerWallpaperBridge, type WallpaperHost } from '../src/settings/WallpaperEngineBridge';

describe('Wallpaper Engine host bridge', () => {
  it('marks host activity even if an older project delivers no custom settings, only once', () => {
    const host: WallpaperHost = {};
    const onChange = vi.fn(), onHost = vi.fn();
    const dispose = registerWallpaperBridge(onChange, host, onHost);
    host.wallpaperPropertyListener!.applyUserProperties!({ schemecolor: { value: '0 0 0' } });
    host.wallpaperPropertyListener!.applyGeneralProperties!({ fps: 30 });
    host.wallpaperPropertyListener!.setPaused!(false);
    expect(onHost).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls).toEqual([[{ fps: 30 }], [{ paused: false }]]);
    dispose();
  });

  it('applies host-only control visibility, camera, UTC and satellite selection as partial changes', () => {
    const host: WallpaperHost = {};
    let settings = { ...DEFAULT_SETTINGS };
    registerWallpaperBridge(patch => { settings = sanitizeSettings(settings, patch); }, host);
    host.wallpaperPropertyListener!.applyUserProperties!({
      showDesktopSettings: { value: true }, cameraPreset: { value: 'earthMoon' },
      satelliteSelection: { value: '48274' }, simulationUtc: { value: '2026-10-20T00:00:00Z' },
    });
    host.wallpaperPropertyListener!.applyUserProperties!({ showDesktopSettings: { value: false } });
    expect(settings).toMatchObject({ showDesktopSettings: false, cameraPreset: 'earthMoon', satelliteSelection: 48274,
      simulationUtc: '2026-10-20T00:00:00.000Z', showSatellites: false, fps: 30 });
  });
  it('installs synchronously and accepts initial properties before a scene exists', () => {
    const host: WallpaperHost = {};
    let settings = { ...DEFAULT_SETTINGS };
    const onChange = vi.fn((changes) => { settings = sanitizeSettings(settings, changes); });
    const dispose = registerWallpaperBridge(onChange, host);
    expect(host.wallpaperPropertyListener).toBeDefined();
    host.wallpaperPropertyListener!.applyUserProperties!({
      viewMode: { value: 'earth' }, showLabels: { value: false }, quality: { value: 'high' },
      timeScale: { value: 60 }, syncInterval: { value: '24' },
    });
    expect(settings).toMatchObject({ viewMode: 'earth', showLabels: false, quality: 'high', timeScale: 60, syncInterval: 24, showSatellites: false });
    host.wallpaperPropertyListener!.applyUserProperties!({ showOrbits: { value: false } });
    expect(settings).toMatchObject({ viewMode: 'earth', showOrbits: false, quality: 'high', timeScale: 60, syncInterval: 24 });
    expect(onChange).toHaveBeenLastCalledWith({ showOrbits: false });
    dispose();
  });

  it('reads general FPS as a plain numeric value, without a user-property wrapper', () => {
    const host: WallpaperHost = {};
    const onChange = vi.fn();
    registerWallpaperBridge(onChange, host);
    host.wallpaperPropertyListener!.applyGeneralProperties!({ fps: 60 });
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ fps: 60 });
    for (const fps of [{ value: 120 }, '120', NaN, Infinity, 0, -1]) {
      host.wallpaperPropertyListener!.applyGeneralProperties!({ fps });
    }
    expect(onChange).toHaveBeenCalledTimes(1);
    host.wallpaperPropertyListener!.applyGeneralProperties!({ fps: 15 });
    expect(onChange).toHaveBeenLastCalledWith({ fps: 15 });
  });

  it('passes pause and resume as independent boolean changes', () => {
    const host: WallpaperHost = {};
    const onChange = vi.fn();
    registerWallpaperBridge(onChange, host);
    host.wallpaperPropertyListener!.setPaused!(true);
    host.wallpaperPropertyListener!.setPaused!(false);
    host.wallpaperPropertyListener!.setPaused!('false');
    expect(onChange.mock.calls).toEqual([[{ paused: true }], [{ paused: false }]]);
  });

  it('ignores invalid payloads, unknown keys, inherited wrappers and combo indices', () => {
    const host: WallpaperHost = {};
    const onChange = vi.fn();
    registerWallpaperBridge(onChange, host);
    const listener = host.wallpaperPropertyListener!;
    for (const invalid of [null, undefined, 0, [], 'value', { viewMode: null }, { quality: [] }, { showLabels: false }]) {
      listener.applyUserProperties!(invalid);
      listener.applyGeneralProperties!(invalid);
    }
    listener.applyUserProperties!({ fps: { value: 60 }, paused: { value: true }, unknown: { value: true } });
    listener.applyUserProperties!({ viewMode: { value: 1 }, quality: { value: 2 }, satelliteGroup: { value: 0 } });
    listener.applyUserProperties!(Object.create({ showSatellites: { value: true } }));
    listener.applyUserProperties!({ showSatellites: Object.create({ value: true }) });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('preserves disabled satellite state through unrelated updates without causing network work', () => {
    const host: WallpaperHost = {};
    let settings = { ...DEFAULT_SETTINGS };
    const updateSatelliteLayer = vi.fn();
    registerWallpaperBridge((patch) => {
      settings = sanitizeSettings(settings, patch);
      if (patch.showSatellites === true) updateSatelliteLayer();
    }, host);
    host.wallpaperPropertyListener!.applyUserProperties!({ showSatellites: { value: false } });
    host.wallpaperPropertyListener!.applyUserProperties!({ syncInterval: { value: '1' }, satelliteGroup: { value: 'gps' } });
    host.wallpaperPropertyListener!.applyGeneralProperties!({ fps: 24 });
    host.wallpaperPropertyListener!.setPaused!(false);
    expect(settings).toMatchObject({ showSatellites: false, satelliteGroup: 'gps', syncInterval: 1, fps: 24 });
    expect(updateSatelliteLayer).not.toHaveBeenCalled();
  });

  it('restores the previous listener and stops retained callbacks after disposal', () => {
    const previous = { setPaused: vi.fn() };
    const host: WallpaperHost = { wallpaperPropertyListener: previous };
    const onChange = vi.fn();
    const dispose = registerWallpaperBridge(onChange, host);
    const retained = host.wallpaperPropertyListener!;
    dispose(); dispose();
    expect(host.wallpaperPropertyListener).toBe(previous);
    retained.setPaused!(true);
    retained.applyGeneralProperties!({ fps: 15 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes only its own listener and preserves a subsequently installed listener', () => {
    const host: WallpaperHost = {};
    const dispose = registerWallpaperBridge(vi.fn(), host);
    dispose();
    expect(Object.hasOwn(host, 'wallpaperPropertyListener')).toBe(false);
    const nextDispose = registerWallpaperBridge(vi.fn(), host);
    const replacement = { setPaused: vi.fn() };
    host.wallpaperPropertyListener = replacement;
    nextDispose();
    expect(host.wallpaperPropertyListener).toBe(replacement);
  });
});
