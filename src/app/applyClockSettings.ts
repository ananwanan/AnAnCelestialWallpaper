import type { WallpaperSettings } from '../settings/Settings';
import { SimulationClock } from './SimulationClock';

type ClockSettings = Pick<WallpaperSettings, 'simulationUtc' | 'timeScale'>;

/** Apply validated host/UI settings at one UTC anchor, retaining the selected rate on date changes. */
export function applyClockSettings(clock: SimulationClock, previous: ClockSettings, next: ClockSettings, realNowMs = Date.now()): boolean {
  const epochChanged = next.simulationUtc !== previous.simulationUtc;
  if (epochChanged) clock.setTime(next.simulationUtc ? new Date(next.simulationUtc) : new Date(realNowMs), realNowMs);
  if (next.timeScale !== previous.timeScale) clock.setRate(next.timeScale, realNowMs);
  return epochChanged;
}
