/** Remote ICRF states are comparisons only; the renderer continues using local EQJ. */
export const EPHEMERIS_SCHEMA_VERSION = 1 as const;
export const EPHEMERIS_IDS = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Moon'] as const;
export type EphemerisBodyId = typeof EPHEMERIS_IDS[number];
export const BODY_COMMANDS: Readonly<Record<EphemerisBodyId, string>> = {
  Mercury: '199', Venus: '299', Earth: '399', Mars: '499', Jupiter: '599', Saturn: '699', Uranus: '799', Neptune: '899', Moon: '301',
};
export const SNAPSHOT_FRESH_MS = 6 * 3_600_000;
export const SNAPSHOT_MAX_AGE_MS = 24 * 3_600_000;
export interface EphemerisVector { readonly x: number; readonly y: number; readonly z: number; }
export interface EphemerisState {
  readonly id: EphemerisBodyId;
  readonly epoch: string;
  readonly positionAU: EphemerisVector;
  readonly velocityAUPerDay: EphemerisVector;
}
export interface EphemerisSnapshot {
  readonly schemaVersion: 1;
  readonly source: 'JPL-Horizons';
  readonly apiVersion: '1.2';
  readonly retrievedAt: string;
  readonly epoch: string;
  /** Bounds of the source hourly samples, not permission to extrapolate this single state. */
  readonly validFrom: string;
  readonly validUntil: string;
  readonly referenceFrame: 'ICRF';
  readonly origin: 'Sun';
  readonly units: 'AU, AU/day';
  readonly quality: 'comparison';
  readonly interpolation: 'cubic-hermite-hourly';
  readonly states: readonly EphemerisState[];
}

export function utcMilliseconds(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return NaN;
  const canonical = new Date(time).toISOString();
  return canonical === value || canonical.replace('.000Z', 'Z') === value ? time : NaN;
}

function vector(value: unknown, bound: number): value is EphemerisVector {
  if (!value || typeof value !== 'object') return false;
  const v = value as EphemerisVector;
  return [v.x, v.y, v.z].every((component) => typeof component === 'number' && Number.isFinite(component) && Math.abs(component) <= bound);
}

export function validateEphemerisSnapshot(value: unknown, now = Date.now()): EphemerisSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid ephemeris object.');
  const s = value as EphemerisSnapshot;
  if (s.schemaVersion !== EPHEMERIS_SCHEMA_VERSION || s.source !== 'JPL-Horizons' || s.apiVersion !== '1.2'
      || s.referenceFrame !== 'ICRF' || s.origin !== 'Sun' || s.units !== 'AU, AU/day' || s.quality !== 'comparison'
      || s.interpolation !== 'cubic-hermite-hourly') throw new Error('Unsupported ephemeris metadata.');
  const retrieved = utcMilliseconds(s.retrievedAt);
  const epoch = utcMilliseconds(s.epoch);
  const from = utcMilliseconds(s.validFrom);
  const until = utcMilliseconds(s.validUntil);
  if (![retrieved, epoch, from, until].every(Number.isFinite) || retrieved > now + 300_000 || now - retrieved > SNAPSHOT_MAX_AGE_MS
      || until - from !== 24 * 3_600_000 || from % (24 * 3_600_000) !== 0 || epoch < from || epoch > until) {
    throw new Error('Invalid, expired, or ambiguous ephemeris UTC window.');
  }
  if (!Array.isArray(s.states) || s.states.length !== EPHEMERIS_IDS.length) throw new Error('Incomplete ephemeris body set.');
  const found = new Set<string>();
  for (const state of s.states) {
    if (!state || !EPHEMERIS_IDS.includes(state.id) || found.has(state.id) || state.epoch !== s.epoch
        || !vector(state.positionAU, 100) || !vector(state.velocityAUPerDay, 1)
        || Math.hypot(state.positionAU.x, state.positionAU.y, state.positionAU.z) < 0.05) throw new Error('Invalid or duplicate ephemeris state.');
    found.add(state.id);
  }
  return s;
}

export interface EphemerisComparison {
  readonly passed: boolean;
  readonly maxResidualAU: number;
  readonly checks: readonly { id: EphemerisBodyId; residualAU: number; toleranceAU: number; passed: boolean }[];
  readonly note: string;
}

/**
 * Sanity comparison, not a frame transform or a precision certification.
 * Astronomy Engine targets about one arcminute; permit that transverse scale
 * plus 1e-5 AU for frame/model/interpolation differences. Both inputs are Sun-centered.
 */
export function compareEphemerisSnapshot(snapshot: EphemerisSnapshot, local: (body: EphemerisBodyId, epoch: Date) => EphemerisVector): EphemerisComparison {
  const epoch = new Date(snapshot.epoch);
  const checks = snapshot.states.map((state) => {
    const position = local(state.id, epoch);
    const residualAU = Math.hypot(position.x - state.positionAU.x, position.y - state.positionAU.y, position.z - state.positionAU.z);
    const toleranceAU = 1e-5 + Math.hypot(state.positionAU.x, state.positionAU.y, state.positionAU.z) * Math.PI / (180 * 60);
    return { id: state.id, residualAU, toleranceAU, passed: Number.isFinite(residualAU) && residualAU <= toleranceAU };
  });
  return { passed: checks.every((check) => check.passed), maxResidualAU: Math.max(...checks.map((check) => check.residualAU)), checks,
    note: 'Comparison at one UTC epoch: remote ICRF and local EQJ are closely aligned, not identical frames; local ephemeris drives rendering.' };
}
