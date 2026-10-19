import { eciToEcf, eciToGeodetic, gstime, json2satrec, propagate, type SatRec } from 'satellite.js';
import { createEarthOrientation, ecefToEqj } from '../astronomy/earthOrientation';
import { DAY_MS } from './omm';
import type { KmVector, OmmRecord, SatelliteDataset, SatelliteSnapshot, SatelliteState, SatelliteTrajectory } from './types';
const records = new WeakMap<OmmRecord, SatRec>();
const finite = (v: KmVector) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
/** Vallado TEME -> pseudo Earth-fixed (PEF), approximating UT1=UTC and zero polar motion. */
export function temeToEcef(position: KmVector, at: Date): KmVector {
  if (!finite(position) || !Number.isFinite(at.getTime())) throw new Error('Invalid TEME state.');
  return temeToPseudoFixed(position, gstime(at));
}
/** Exposed separately so the rotation can be checked against published non-date test vectors. */
export function temeToPseudoFixed(position: KmVector, gmstRadians: number): KmVector {
  if (!finite(position) || !Number.isFinite(gmstRadians)) throw new Error('Invalid TEME rotation input.');
  return Object.freeze(eciToEcf(position, gmstRadians));
}
export function propagateSatellite(record: OmmRecord, at: Date): SatelliteState {
  const time = at.getTime();
  if (!Number.isFinite(time)) throw new Error('Invalid propagation UTC.');
  const ageDays = (time - Date.parse(record.EPOCH)) / DAY_MS;
  const gps = record.MEAN_MOTION < 3;
  if (Math.abs(ageDays) > (gps ? 14 : 7)) throw new Error('Propagation refused: orbital element epoch is outside the supported prediction window.');
  let satrec = records.get(record);
  if (!satrec) { satrec = json2satrec({ ...record }); records.set(record, satrec); }
  const result = propagate(satrec, at);
  if (!result || !finite(result.position) || !finite(result.velocity)) throw new Error(`SGP4 failed (${satrec.error}).`);
  const radius = Math.hypot(result.position.x, result.position.y, result.position.z);
  if (radius < 6370 || radius > 100_000) throw new Error('Propagation refused: implausible orbital radius.');
  const altitudeKm = eciToGeodetic(result.position, gstime(at)).height;
  if (!Number.isFinite(altitudeKm) || altitudeKm < 80 || altitudeKm > 95_000) throw new Error('Propagation refused: implausible altitude.');
  const temeKm = Object.freeze({ ...result.position });
  const ecefKm = temeToEcef(temeKm, at);
  const positionKm = Object.freeze(ecefToEqj(ecefKm, createEarthOrientation(at)));
  return Object.freeze({ noradId: record.NORAD_CAT_ID, name: record.OBJECT_NAME, elementEpoch: record.EPOCH,
    positionKm, temeKm, ecefKm, altitudeKm, ageDays, stale: Math.abs(ageDays) > (gps ? 7 : 3) });
}
export function createSatelliteSnapshot(dataset: SatelliteDataset, at: Date): SatelliteSnapshot {
  const states: SatelliteState[] = [];
  const rejected: { noradId: number; reason: string }[] = [];
  for (const record of dataset.records) {
    try { states.push(propagateSatellite(record, at)); }
    catch (error) { rejected.push(Object.freeze({ noradId: record.NORAD_CAT_ID, reason: error instanceof Error ? error.message : 'Invalid satellite state.' })); }
  }
  return Object.freeze({ epoch: at.toISOString(), referenceFrame: 'EQJ/J2000', origin: 'Earth', units: 'km', quality: 'approximate prediction',
    states: Object.freeze(states), rejected: Object.freeze(rejected) });
}
/** ± half one orbital period; each point has its own SGP4 epoch and inertial frame conversion. */
export function sampleSatelliteTrajectory(record: OmmRecord, at: Date, segments = 96): SatelliteTrajectory {
  if (!Number.isInteger(segments) || segments < 16 || segments > 192 || segments % 2 !== 0) throw new Error('Trajectory segments must be even, 16–192.');
  const halfSpan = DAY_MS / record.MEAN_MOTION / 2;
  const center = at.getTime();
  const past: KmVector[] = [], future: KmVector[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = center - halfSpan + 2 * halfSpan * i / segments;
    const position = propagateSatellite(record, new Date(t)).positionKm;
    if (i <= segments / 2) past.push(position);
    if (i >= segments / 2) future.push(position);
  }
  return Object.freeze({ noradId: record.NORAD_CAT_ID, epoch: at.toISOString(), validFrom: new Date(center - halfSpan).toISOString(),
    validUntil: new Date(center + halfSpan).toISOString(), referenceFrame: 'EQJ/J2000', origin: 'Earth', units: 'km', quality: 'approximate prediction',
    past: Object.freeze(past), future: Object.freeze(future) });
}
