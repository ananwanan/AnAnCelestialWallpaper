import { BODY_COMMANDS, utcMilliseconds, type EphemerisBodyId, type EphemerisSnapshot, type EphemerisVector } from '../../../src/astronomy/ephemerisSnapshot';
import { PolicyError, UPSTREAM_URL, canonicalQuery, validatePayload } from './policy';

const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export interface HorizonsSample { readonly epochMs: number; readonly positionAU: EphemerisVector; readonly velocityAUPerDay: EphemerisVector; }
export interface BodySeries { readonly id: EphemerisBodyId; readonly retrievedAt: number; readonly samples: readonly HorizonsSample[]; }
export interface BatchResult { readonly entries: readonly BodySeries[]; readonly cache: 'HIT' | 'MISS' | 'STALE'; readonly retryMs: number; }

export function normalizedEpoch(url: URL): number {
  if (url.href.length > 256 || [...url.searchParams.keys()].length !== 1 || !url.searchParams.has('at')) throw new PolicyError('Provide exactly one at=<UTC ISO timestamp> parameter.');
  const at = utcMilliseconds(url.searchParams.get('at'));
  if (!Number.isFinite(at) || at < Date.UTC(1962, 0, 1) || at >= Date.UTC(2100, 11, 31)) throw new PolicyError('at must be UTC ISO 8601 in the supported 1962–2100 range.');
  return at;
}
export function dayStart(at: number): number { return Math.floor(at / DAY) * DAY; }
export function bodyQuery(id: EphemerisBodyId, start: number): string {
  const url = new URL(UPSTREAM_URL);
  url.searchParams.set('COMMAND', BODY_COMMANDS[id]);
  url.searchParams.set('START_TIME', new Date(start).toISOString().slice(0, 10));
  url.searchParams.set('STOP_TIME', new Date(start + DAY).toISOString().slice(0, 10));
  url.searchParams.set('STEP_SIZE', '1 h');
  return canonicalQuery(url);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function calendarUtc(value: string): number {
  const match = /^A\.D\.\s+(\d{4})-([A-Za-z]{3})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{1,4})(?:\s+UT~?)?\s*$/.exec(value.trim());
  if (!match) throw new Error('Ambiguous Horizons calendar time.');
  const month = MONTHS.findIndex((candidate) => candidate.toLowerCase() === match[2]!.toLowerCase());
  const time = Date.UTC(Number(match[1]), month, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]), Number(match[7]!.padEnd(4, '0').slice(0, 3)));
  const date = new Date(time);
  if (month < 0 || date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== month || date.getUTCDate() !== Number(match[3])
      || date.getUTCHours() !== Number(match[4]) || date.getUTCMinutes() !== Number(match[5]) || date.getUTCSeconds() !== Number(match[6])) throw new Error('Invalid Horizons calendar time.');
  return time;
}
function singleHeader(text: string, label: RegExp): string {
  const matches = [...text.matchAll(label)];
  if (matches.length !== 1) throw new Error('Missing or ambiguous Horizons metadata.');
  return matches[0]![1]!.trim();
}
export function parseHorizonsSeries(text: string, id: EphemerisBodyId, start: number, end = start + DAY): readonly HorizonsSample[] {
  validatePayload(text);
  const result = (JSON.parse(text) as { result: string }).result;
  const header = result.split('$$SOE')[0]!;
  if (singleHeader(header, /^Target body name:\s+.*?\((\d+)\).*$/gm) !== BODY_COMMANDS[id]
      || singleHeader(header, /^Center body name:\s+Sun\s+\((\d+)\).*$/gm) !== '10'
      || singleHeader(header, /^Center-site name:\s*(.*)$/gm) !== 'BODY CENTER'
      || singleHeader(header, /^Output units\s*:\s*(.*)$/gm) !== 'AU-D'
      || singleHeader(header, /^Calendar mode\s*:\s*(.*)$/gm) !== 'Gregorian'
      || singleHeader(header, /^Output type\s*:\s*(.*)$/gm) !== 'GEOMETRIC cartesian states'
      || singleHeader(header, /^Output format\s*:\s*(.*)$/gm) !== '2 (position and velocity)'
      || singleHeader(header, /^Reference frame\s*:\s*(.*)$/gm) !== 'ICRF'
      || singleHeader(header, /^Step-size\s*:\s*(.*)$/gm) !== '60 minutes'
      || calendarUtc(singleHeader(header, /^Start time\s*:\s*(.*)$/gm)) !== start
      || calendarUtc(singleHeader(header, /^Stop\s+time\s*:\s*(.*)$/gm)) !== end
      || !/^\s*JDUT\s*,\s*Calendar Date \(UT\s*\),\s*X,\s*Y,\s*Z,\s*VX,\s*VY,\s*VZ,\s*$/m.test(header)) {
    throw new Error('Horizons body/frame/origin/units/time metadata mismatch.');
  }
  const rows = result.split('$$SOE')[1]!.split('$$EOE')[0]!.trim().split(/\r?\n/);
  if (rows.length !== 25 || end - start !== DAY) throw new Error('Expected 25 hourly Horizons samples over one UTC day.');
  return rows.map((row, index) => {
    const columns = row.split(',').map((value) => value.trim());
    if (columns.at(-1) === '') columns.pop();
    const epochMs = calendarUtc(columns[1]!);
    const jd = Number(columns[0]);
    if (epochMs !== start + index * HOUR || Math.abs(jd - (epochMs / DAY + 2440587.5)) > 1e-8) throw new Error('Horizons sample epochs disagree or are not hourly.');
    const numbers = columns.slice(2).map(Number);
    const positionAU = { x: numbers[0]!, y: numbers[1]!, z: numbers[2]! };
    const velocityAUPerDay = { x: numbers[3]!, y: numbers[4]!, z: numbers[5]! };
    if (Object.values(positionAU).some((value) => Math.abs(value) > 100) || Object.values(velocityAUPerDay).some((value) => Math.abs(value) > 1)) throw new Error('Implausible Horizons vector.');
    return { epochMs, positionAU, velocityAUPerDay };
  });
}

/** Cubic Hermite uses position+velocity over <=1 hour; never extrapolates. */
export function interpolateSeries(samples: readonly HorizonsSample[], at: number): Omit<HorizonsSample, 'epochMs'> {
  if (samples.length < 2 || at < samples[0]!.epochMs || at > samples.at(-1)!.epochMs) throw new Error('Interpolation epoch lies outside the Horizons window.');
  let index = samples.findIndex((sample) => sample.epochMs >= at);
  if (index < 0) throw new Error('No bracketing Horizons samples.');
  const exact = samples[index]!;
  if (exact.epochMs === at) return { positionAU: exact.positionAU, velocityAUPerDay: exact.velocityAUPerDay };
  const left = samples[--index]!;
  const right = samples[index + 1]!;
  const dt = right.epochMs - left.epochMs;
  if (dt <= 0 || dt > HOUR) throw new Error('Horizons interpolation spacing exceeds one hour.');
  const h = dt / DAY;
  const u = (at - left.epochMs) / dt;
  const u2 = u * u;
  const u3 = u2 * u;
  const positionAU = { x: 0, y: 0, z: 0 };
  const velocityAUPerDay = { x: 0, y: 0, z: 0 };
  for (const axis of ['x', 'y', 'z'] as const) {
    const p0 = left.positionAU[axis], p1 = right.positionAU[axis], v0 = left.velocityAUPerDay[axis], v1 = right.velocityAUPerDay[axis];
    positionAU[axis] = (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * h * v0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * h * v1;
    velocityAUPerDay[axis] = ((6 * u2 - 6 * u) * p0 + (3 * u2 - 4 * u + 1) * h * v0 + (-6 * u2 + 6 * u) * p1 + (3 * u2 - 2 * u) * h * v1) / h;
  }
  return { positionAU, velocityAUPerDay };
}

export function normalizedSnapshot(batch: BatchResult, at: number): EphemerisSnapshot {
  const start = dayStart(at);
  const epoch = new Date(at).toISOString();
  return { schemaVersion: 1, source: 'JPL-Horizons', apiVersion: '1.2', retrievedAt: new Date(Math.min(...batch.entries.map((entry) => entry.retrievedAt))).toISOString(),
    epoch, validFrom: new Date(start).toISOString(), validUntil: new Date(start + DAY).toISOString(), referenceFrame: 'ICRF', origin: 'Sun', units: 'AU, AU/day', quality: 'comparison', interpolation: 'cubic-hermite-hourly',
    states: batch.entries.map((entry) => ({ id: entry.id, epoch, ...interpolateSeries(entry.samples, at) })) };
}
