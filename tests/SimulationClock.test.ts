import { describe, expect, it } from 'vitest';
import { SimulationClock } from '../src/app/SimulationClock';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/settings/Settings';

describe('SimulationClock', () => {
  it('tracks actual wall-clock time and timescale without drift', () => {
    const clock = new SimulationClock(10_000);
    expect(clock.at(11_000).getTime()).toBe(11_000);
    clock.setRate(60, 11_000);
    expect(clock.at(12_000).getTime()).toBe(71_000);
    clock.setRate(0, 12_000);
    expect(clock.at(20_000).getTime()).toBe(71_000);
  });
  it('resets to now', () => {
    const clock = new SimulationClock(1_000, 3600);
    clock.reset(5_000);
    expect(clock.at(6_000).getTime()).toBe(6_000);
  });
  it('rejects invalid scaling', () => {
    const clock = new SimulationClock(0);
    expect(() => clock.setRate(-1)).toThrow(RangeError);
  });
});

describe('Wallpaper settings', () => {
  it('merges partial host updates without resetting other properties', () => {
    const first = sanitizeSettings(DEFAULT_SETTINGS, { showSatellites: true, viewMode: 'earth' });
    const next = sanitizeSettings(first, { syncInterval: 24 });
    expect(next.showSatellites).toBe(true);
    expect(next.viewMode).toBe('earth');
    expect(next.syncInterval).toBe(24);
  });
});
