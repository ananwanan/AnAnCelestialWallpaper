import type { OmmRecord, SatelliteDataset, SatelliteGroup } from './types';

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
export const SATELLITE_MIN_REFRESH_MS = 2 * HOUR_MS;
export const SATELLITE_CACHE_MAX_AGE_MS = 7 * DAY_MS;
export const MAX_OMM_BYTES = 262_144;
const MAX_RECORDS = 128;
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function finite(v: unknown, key: string, min: number, max: number, integer = false): number {
  // CelesTrak JSON uses numbers. Strict strings support standard OMM numeric interchange without coercing null/booleans.
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < min || n > max || integer && !Number.isInteger(n)) throw new Error(`Invalid OMM ${key}.`);
  return n;
}
export function ommEpoch(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z?$/.test(value)) throw new Error('Invalid OMM UTC epoch.');
  const normalized = value.endsWith('Z') ? value : `${value}Z`;
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== normalized.slice(0, 19)) throw new Error('Invalid OMM UTC calendar date.');
  return new Date(ms).toISOString();
}
export function parseOmmRecord(value: unknown): OmmRecord {
  if (!object(value)) throw new Error('OMM record must be an object.');
  for (const [key, expected] of Object.entries({ CENTER_NAME: 'EARTH', REF_FRAME: 'TEME', TIME_SYSTEM: 'UTC', MEAN_ELEMENT_THEORY: 'SGP4' })) {
    if (value[key] !== undefined && value[key] !== expected) throw new Error(`Unsupported OMM ${key}.`);
  }
  if (value.CCSDS_OMM_VERS !== undefined && value.CCSDS_OMM_VERS !== '3.0' && value.CCSDS_OMM_VERS !== '2.0') throw new Error('Unsupported OMM schema version.');
  if (typeof value.OBJECT_NAME !== 'string' || value.OBJECT_NAME.trim().length < 1 || value.OBJECT_NAME.length > 128 || /[\u0000-\u001f]/.test(value.OBJECT_NAME)) throw new Error('Invalid OMM object name.');
  if (typeof value.OBJECT_ID !== 'string' || value.OBJECT_ID.length > 64) throw new Error('Invalid OMM object identifier.');
  if (value.EPHEMERIS_TYPE !== undefined && finite(value.EPHEMERIS_TYPE, 'EPHEMERIS_TYPE', 0, 0) !== 0) throw new Error('Unsupported orbital model.');
  if (value.CLASSIFICATION_TYPE !== undefined && value.CLASSIFICATION_TYPE !== 'U') throw new Error('Only unclassified OMM is supported.');
  const n = (key: string, min: number, max: number, integer = false) => finite(value[key], key, min, max, integer);
  return Object.freeze({ OBJECT_NAME: value.OBJECT_NAME.trim(), OBJECT_ID: value.OBJECT_ID, EPOCH: ommEpoch(value.EPOCH),
    NORAD_CAT_ID: n('NORAD_CAT_ID', 1, 999_999_999, true), MEAN_MOTION: n('MEAN_MOTION', 0.05, 18),
    ECCENTRICITY: n('ECCENTRICITY', 0, 0.999), INCLINATION: n('INCLINATION', 0, 180),
    RA_OF_ASC_NODE: n('RA_OF_ASC_NODE', 0, 360), ARG_OF_PERICENTER: n('ARG_OF_PERICENTER', 0, 360),
    MEAN_ANOMALY: n('MEAN_ANOMALY', 0, 360), BSTAR: n('BSTAR', -10, 10),
    MEAN_MOTION_DOT: n('MEAN_MOTION_DOT', -10, 10), MEAN_MOTION_DDOT: n('MEAN_MOTION_DDOT', -10, 10),
    ELEMENT_SET_NO: n('ELEMENT_SET_NO', 0, 999_999_999, true), REV_AT_EPOCH: n('REV_AT_EPOCH', 0, 999_999_999, true),
    EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U' });
}
export function parseOmmRecords(value: unknown, group: SatelliteGroup): readonly OmmRecord[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_RECORDS) throw new Error('OMM group size is invalid.');
  const all = value.map(parseOmmRecord);
  if (new Set(all.map(r => r.NORAD_CAT_ID)).size !== all.length) throw new Error('Duplicate NORAD catalog number.');
  const selected = group === 'stations' ? all.filter(r => [25544, 48274].includes(r.NORAD_CAT_ID)) : all.filter(r => /GPS|NAVSTAR/i.test(r.OBJECT_NAME));
  if (selected.length === 0) throw new Error('No requested satellites in this group.');
  return Object.freeze(selected.sort((a, b) => a.NORAD_CAT_ID - b.NORAD_CAT_ID).slice(0, group === 'stations' ? 2 : 40));
}
export function createSatelliteDataset(value: unknown, group: SatelliteGroup, retrievedAt: number): SatelliteDataset {
  if (!Number.isFinite(retrievedAt)) throw new Error('Invalid satellite retrieval time.');
  const records = parseOmmRecords(value, group);
  const epochs = records.map(r => Date.parse(r.EPOCH));
  if (epochs.some(epoch => epoch > retrievedAt + DAY_MS || retrievedAt - epoch > 30 * DAY_MS)) throw new Error('OMM epoch is implausible or older than 30 days.');
  const oldest = Math.min(...epochs);
  return Object.freeze({ schemaVersion: 1, group, source: 'CelesTrak-GP', retrievedAt: new Date(retrievedAt).toISOString(),
    epoch: new Date(oldest).toISOString(), validFrom: new Date(Math.max(...epochs) - (group === 'gps' ? 14 : 7) * DAY_MS).toISOString(),
    validUntil: new Date(Math.min(...epochs.map(t => t + (group === 'gps' ? 14 : 7) * DAY_MS))).toISOString(),
    referenceFrame: 'TEME', origin: 'Earth', units: 'OMM: deg, rev/day', quality: 'orbital elements', records });
}
export function validateSatelliteDataset(value: unknown, now: number, group: SatelliteGroup): SatelliteDataset {
  if (!object(value) || value.schemaVersion !== 1 || value.group !== group || value.source !== 'CelesTrak-GP' || value.referenceFrame !== 'TEME'
    || value.origin !== 'Earth' || value.units !== 'OMM: deg, rev/day' || value.quality !== 'orbital elements') throw new Error('Invalid satellite dataset metadata.');
  const retrieved = Date.parse(ommEpoch(value.retrievedAt));
  if (retrieved > now + 60_000 || now - retrieved > SATELLITE_CACHE_MAX_AGE_MS) throw new Error('Satellite cache expired or is from the future.');
  const rebuilt = createSatelliteDataset(value.records, group, retrieved);
  if (value.epoch !== rebuilt.epoch || value.validFrom !== rebuilt.validFrom || value.validUntil !== rebuilt.validUntil) throw new Error('Invalid satellite dataset time bounds.');
  return rebuilt;
}
