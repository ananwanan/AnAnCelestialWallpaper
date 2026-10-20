import { describe, expect, it } from 'vitest';
import { applyClockSettings } from '../src/app/applyClockSettings';
import { SimulationClock } from '../src/app/SimulationClock';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/settings/Settings';

describe('applying host clock settings', () => {
  const start = Date.UTC(2026, 9, 20), historical = '2026-10-19T00:00:00.000Z';

  it.each([0, 60])('clears the custom date at current UTC while retaining the displayed %s× rate', rate => {
    const clock = new SimulationClock(start, rate);
    const previous = { ...DEFAULT_SETTINGS, simulationUtc: historical, timeScale: rate };
    clock.setTime(new Date(historical), start);
    const next = sanitizeSettings(previous, { simulationUtc: '' });
    const changeAt = start + 10_000;
    expect(applyClockSettings(clock, previous, next, changeAt)).toBe(true);
    expect(clock.timeScale).toBe(next.timeScale);
    expect(clock.at(changeAt).getTime()).toBe(changeAt);
    expect(clock.at(changeAt + 1_000).getTime()).toBe(changeAt + rate * 1_000);
  });

  it('changes the date and rate in one host delivery at the same anchor', () => {
    const clock = new SimulationClock(start, 60);
    const previous = { ...DEFAULT_SETTINGS, timeScale: 60 };
    const next = sanitizeSettings(previous, { simulationUtc: historical, timeScale: 0 });
    expect(applyClockSettings(clock, previous, next, start + 5_000)).toBe(true);
    expect(clock.timeScale).toBe(0);
    expect(clock.at(start + 60_000).toISOString()).toBe(historical);
  });

  it('does not re-anchor a progressing custom date on unrelated partial changes', () => {
    const clock = new SimulationClock(start, 60);
    const previous = { ...DEFAULT_SETTINGS, simulationUtc: historical, timeScale: 60 };
    clock.setTime(new Date(historical), start);
    const next = sanitizeSettings(previous, { quality: 'high', showDesktopSettings: true });
    expect(applyClockSettings(clock, previous, next, start + 10_000)).toBe(false);
    expect(clock.at(start + 11_000).getTime()).toBe(Date.parse(historical) + 660_000);
  });
});
