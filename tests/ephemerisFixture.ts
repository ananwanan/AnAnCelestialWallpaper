import { EPHEMERIS_IDS, type EphemerisSnapshot } from '../src/astronomy/ephemerisSnapshot';

/** Synthetic schema/transport fixture; not an astronomical reference vector. */
export function snapshotFixture(now = Date.UTC(2026, 9, 19, 12)): EphemerisSnapshot {
  const start = Math.floor(now / 86_400_000) * 86_400_000;
  const epoch = new Date(now).toISOString();
  return { schemaVersion: 1, source: 'JPL-Horizons', apiVersion: '1.2', retrievedAt: epoch, epoch,
    validFrom: new Date(start).toISOString(), validUntil: new Date(start + 86_400_000).toISOString(), referenceFrame: 'ICRF', origin: 'Sun', units: 'AU, AU/day', quality: 'comparison', interpolation: 'cubic-hermite-hourly',
    states: EPHEMERIS_IDS.map((id, index) => ({ id, epoch, positionAU: { x: 1 + index, y: 0.1, z: 0.2 }, velocityAUPerDay: { x: 0.001, y: 0.002, z: 0.003 } })) };
}
