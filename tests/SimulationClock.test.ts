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
  it('re-anchors at exactly the same simulated instant when changing rates', () => {
    const realStart = Date.UTC(2026, 9, 19);
    const clock = new SimulationClock(realStart, 60);
    const changeAt = realStart + 12_345;
    const before = clock.at(changeAt).getTime();
    clock.setRate(3600, changeAt);
    expect(clock.at(changeAt).getTime()).toBe(before);
    expect(clock.at(changeAt + 1_000).getTime()).toBe(before + 3_600_000);
    clock.setRate(0, changeAt + 1_000);
    expect(clock.at(changeAt + 86_400_000).getTime()).toBe(before + 3_600_000);
  });
  it('resumes from the current simulated UTC after 24 hours with no rendered frames or network', () => {
    const start = Date.UTC(2026, 9, 19);
    for (const rate of [0, 1, 60, 86400]) {
      const clock = new SimulationClock(start, rate);
      // Host pause suspends work; it does not stop the independently anchored simulation.
      const resumed = clock.at(start + 86_400_000).getTime();
      expect(resumed).toBe(start + 86_400_000 * rate);
      expect(clock.at(start + 86_400_001).getTime()).toBe(resumed + rate);
    }
  });
  it('sets a selected UTC epoch while retaining time scale and recovers real time on reset', () => {
    const start = Date.UTC(2026, 9, 19);
    const selected = new Date('2030-02-01T12:34:56.000Z');
    const clock = new SimulationClock(start, 3600);
    clock.setTime(selected, start + 5_000);
    expect(clock.timeScale).toBe(3600);
    expect(clock.at(start + 5_000).toISOString()).toBe(selected.toISOString());
    expect(clock.at(start + 6_000).getTime()).toBe(selected.getTime() + 3_600_000);
    clock.reset(start + 10_000);
    expect(clock.timeScale).toBe(1);
    expect(clock.at(start + 11_000).getTime()).toBe(start + 11_000);
  });
  it('retains a stopped simulation when selecting an epoch', () => {
    const clock = new SimulationClock(0, 0);
    clock.setTime(new Date('2026-10-19T12:00:00Z'), 10_000);
    expect(clock.timeScale).toBe(0);
    expect(clock.at(86_400_000).toISOString()).toBe('2026-10-19T12:00:00.000Z');
  });
  it('rejects invalid epochs and rates before mutating the last good anchor', () => {
    const start = Date.UTC(2026, 9, 19);
    const clock = new SimulationClock(start, 60);
    for (const value of [NaN, Infinity, -Infinity, Number.MAX_VALUE]) {
      expect(() => new SimulationClock(value)).toThrow(RangeError);
      expect(() => clock.at(value)).toThrow(RangeError);
      expect(() => clock.setRate(2, value)).toThrow(RangeError);
      expect(() => clock.reset(value)).toThrow(RangeError);
      expect(() => clock.setTime(new Date(start), value)).toThrow(RangeError);
    }
    for (const rate of [-1, 86401, NaN, Infinity]) {
      expect(() => new SimulationClock(start, rate)).toThrow(RangeError);
      expect(() => clock.setRate(rate, start + 1_000)).toThrow(RangeError);
    }
    expect(() => clock.setTime(new Date(NaN), start + 1_000)).toThrow(RangeError);
    expect(clock.timeScale).toBe(60);
    expect(clock.at(start + 1_000).getTime()).toBe(start + 60_000);
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
