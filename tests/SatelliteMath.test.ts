import { describe, expect, it } from 'vitest';
import { eqjToEcef, createEarthOrientation } from '../src/astronomy/earthOrientation';
import { createSatelliteDataset, DAY_MS, ommEpoch, parseOmmRecord, parseOmmRecords, validateSatelliteDataset } from '../src/satellites/omm';
import { createSatelliteSnapshot, propagateSatellite, sampleSatelliteTrajectory, temeToEcef, temeToPseudoFixed } from '../src/satellites/propagation';
import { SYNTHETIC_GPS_OMM, SYNTHETIC_STATION_OMM, VANGUARD_OMM, VANGUARD_REFERENCE } from './fixtures/satelliteReference';

const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const now = Date.parse('2026-10-19T01:00:00Z');
describe('CelesTrak JSON OMM boundary', () => {
  it('normalizes omitted CelesTrak UTC suffix and preserves modern 9-digit catalog numbers', () => {
    expect(ommEpoch('2026-10-19T00:00:00.123456')).toBe('2026-10-19T00:00:00.123Z');
    expect(parseOmmRecord({ ...SYNTHETIC_STATION_OMM, NORAD_CAT_ID: 123456789 }).NORAD_CAT_ID).toBe(123456789);
  });
  it.each([
    { EPOCH: '2026-02-30T12:00:00Z' }, { EPOCH: '2026-10-19T12:00:00+08:00' }, { REF_FRAME: 'ICRF' }, { CENTER_NAME: 'SUN' },
    { TIME_SYSTEM: 'TAI' }, { MEAN_ELEMENT_THEORY: 'KEPLER' }, { EPHEMERIS_TYPE: 2 }, { MEAN_MOTION: null },
    { MEAN_MOTION: '15junk' }, { ECCENTRICITY: 1 }, { INCLINATION: 181 }, { BSTAR: Infinity }, { NORAD_CAT_ID: 1e10 },
    { OBJECT_NAME: ' ' }, { CCSDS_OMM_VERS: '9.0' }, { ELEMENT_SET_NO: -1 },
  ])('rejects invalid or ambiguous elements %j', patch => expect(() => parseOmmRecord({ ...SYNTHETIC_STATION_OMM, ...patch })).toThrow());
  it('keeps only ISS/Tiangong from STATIONS and bounds GPS selection', () => {
    const tiangong = { ...SYNTHETIC_STATION_OMM, OBJECT_NAME: 'CSS (TIANHE)', NORAD_CAT_ID: 48274 };
    expect(parseOmmRecords([SYNTHETIC_STATION_OMM, tiangong, { ...tiangong, NORAD_CAT_ID: 90000 }], 'stations').map(r => r.NORAD_CAT_ID)).toEqual([25544, 48274]);
    expect(parseOmmRecords(Array.from({ length: 80 }, (_, i) => ({ ...SYNTHETIC_GPS_OMM, NORAD_CAT_ID: 100000 + i })), 'gps')).toHaveLength(40);
    expect(() => parseOmmRecords([SYNTHETIC_STATION_OMM, SYNTHETIC_STATION_OMM], 'stations')).toThrow('Duplicate');
  });
  it('validates metadata, source epoch, retrieval age and schema version', () => {
    const dataset = createSatelliteDataset([SYNTHETIC_STATION_OMM], 'stations', now);
    expect(dataset).toMatchObject({ source: 'CelesTrak-GP', referenceFrame: 'TEME', origin: 'Earth', quality: 'orbital elements' });
    expect(validateSatelliteDataset(dataset, now, 'stations')).toEqual(dataset);
    expect(() => validateSatelliteDataset({ ...dataset, referenceFrame: 'EQJ/J2000' }, now, 'stations')).toThrow();
    expect(() => validateSatelliteDataset(dataset, now + 8 * DAY_MS, 'stations')).toThrow('expired');
    expect(() => createSatelliteDataset([VANGUARD_OMM], 'stations', now)).toThrow();
  });
});
describe('SGP4 and frame contracts', () => {
  it('matches three published Vallado 00005 TEME reference vectors within 20m', () => {
    const record = parseOmmRecord(VANGUARD_OMM);
    for (const reference of VANGUARD_REFERENCE) {
      const state = propagateSatellite(record, new Date(Date.parse(record.EPOCH) + reference.minutes * 60_000));
      expect(distance(state.temeKm, reference.position)).toBeLessThan(0.02);
    }
  });
  it('matches satellite.js published transform fixtures and J2000 GMST sign', () => {
    // https://raw.githubusercontent.com/shashwatak/satellite-js/develop/test/transforms.json validEciToEcf[1,2]
    expect(temeToPseudoFixed({ x: 8000, y: 0, z: 8000 }, 10)).toEqual({ x: -6712.572232611619, y: 4352.168887114958, z: 8000 });
    expect(temeToPseudoFixed({ x: 8000, y: -4000, z: -8000 }, -30)).toEqual({ x: -2718.114897270775, y: -8521.25879229323, z: -8000 });
    const date = new Date('2000-01-01T12:00:00Z');
    const fixed = temeToEcef({ x: 1, y: 0, z: 0 }, date);
    expect(fixed.x).toBeCloseTo(Math.cos(280.46061837 * Math.PI / 180), 9);
    expect(fixed.y).toBeCloseTo(-Math.sin(280.46061837 * Math.PI / 180), 9);
  });
  it('converts through Earth-fixed axes to geocentric EQJ, never treating TEME as J2000', () => {
    const at = new Date(now), record = parseOmmRecord(SYNTHETIC_STATION_OMM);
    const state = propagateSatellite(record, at);
    expect(distance(eqjToEcef(state.positionKm, createEarthOrientation(at)), state.ecefKm)).toBeLessThan(1e-8);
    expect(distance(state.positionKm, state.temeKm)).toBeGreaterThan(1);
    expect(state.altitudeKm).toBeGreaterThan(300); expect(state.altitudeKm).toBeLessThan(500);
    expect(distance(state.positionKm, propagateSatellite(record, new Date(now + 1000)).positionKm)).toBeGreaterThan(7);
  });
  it('marks old predictions stale and refuses positions outside the epoch window', () => {
    const leo = parseOmmRecord(SYNTHETIC_STATION_OMM), gps = parseOmmRecord(SYNTHETIC_GPS_OMM);
    expect(propagateSatellite(leo, new Date(now + 4 * DAY_MS)).stale).toBe(true);
    expect(() => propagateSatellite(leo, new Date(now + 8 * DAY_MS))).toThrow('window');
    expect(propagateSatellite(gps, new Date(now + 8 * DAY_MS)).stale).toBe(true);
    expect(() => propagateSatellite(gps, new Date(now + 15 * DAY_MS))).toThrow('window');
    const rejected = createSatelliteSnapshot(createSatelliteDataset([SYNTHETIC_STATION_OMM], 'stations', now), new Date(now + 8 * DAY_MS));
    expect(rejected.states).toHaveLength(0); expect(rejected.rejected[0]?.reason).toContain('window');
  });
  it('samples bounded predicted past/future arcs sharing the displayed center position', () => {
    const record = parseOmmRecord(SYNTHETIC_STATION_OMM), at = new Date(now);
    const path = sampleSatelliteTrajectory(record, at, 48);
    expect(path).toMatchObject({ origin: 'Earth', referenceFrame: 'EQJ/J2000', units: 'km', quality: 'approximate prediction' });
    expect(path.past).toHaveLength(25); expect(path.future).toHaveLength(25);
    expect(distance(path.past[24]!, propagateSatellite(record, at).positionKm)).toBeLessThan(1e-9);
    expect(path.future[0]).toEqual(path.past[24]);
    expect(() => sampleSatelliteTrajectory(record, at, 10000)).toThrow();
  });
});
