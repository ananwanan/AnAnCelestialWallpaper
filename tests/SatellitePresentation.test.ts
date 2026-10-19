import { describe, expect, it, vi } from 'vitest';
import { SatellitePresentation, type SatellitePresentationInput } from '../src/app/SatellitePresentation';
import type { OmmRecord, SatelliteDataset, SatelliteSnapshot, SatelliteTrajectory } from '../src/satellites/types';

const epoch = Date.parse('2026-10-19T00:00:00.000Z');
const position = { x: 7000, y: 0, z: 0 };
const record: OmmRecord = { OBJECT_NAME: 'ISS', OBJECT_ID: '1998-067A', EPOCH: new Date(epoch).toISOString(),
  NORAD_CAT_ID: 25544, MEAN_MOTION: 15.5, ECCENTRICITY: .001, INCLINATION: 51.6, RA_OF_ASC_NODE: 20,
  ARG_OF_PERICENTER: 30, MEAN_ANOMALY: 40, BSTAR: .0001, MEAN_MOTION_DOT: .0001, MEAN_MOTION_DDOT: 0,
  ELEMENT_SET_NO: 999, REV_AT_EPOCH: 3000, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U' };
const dataset: SatelliteDataset = { schemaVersion: 1, group: 'stations', source: 'CelesTrak-GP', retrievedAt: record.EPOCH,
  epoch: record.EPOCH, validFrom: '2026-10-12T00:00:00.000Z', validUntil: '2026-10-26T00:00:00.000Z',
  referenceFrame: 'TEME', origin: 'Earth', units: 'OMM: deg, rev/day', quality: 'orbital elements', records: [record] };
function makeSnapshot(_dataset: SatelliteDataset, at: Date): SatelliteSnapshot {
  return { epoch: at.toISOString(), referenceFrame: 'EQJ/J2000', origin: 'Earth', units: 'km', quality: 'approximate prediction',
    states: [{ noradId: 25544, name: 'ISS', elementEpoch: record.EPOCH, positionKm: position, temeKm: position, ecefKm: position,
      altitudeKm: 629, ageDays: 0, stale: false }], rejected: [] };
}
function makeTrajectory(_record: OmmRecord, at: Date, _segments?: number): SatelliteTrajectory {
  return { noradId: _record.NORAD_CAT_ID, epoch: at.toISOString(), validFrom: new Date(at.getTime() - 100_000).toISOString(),
    validUntil: new Date(at.getTime() + 100_000).toISOString(), referenceFrame: 'EQJ/J2000', origin: 'Earth', units: 'km',
    quality: 'approximate prediction', past: [position, position], future: [position, position] };
}
const input = (changes: Partial<SatellitePresentationInput> = {}): SatellitePresentationInput => ({ enabled: true, viewMode: 'earth',
  showOrbits: true, quality: 'medium', dataset, selectedNoradId: 25544, at: new Date(epoch), now: 0, ...changes });
function setup() {
  const createSnapshot = vi.fn(makeSnapshot), sampleTrajectory = vi.fn(makeTrajectory);
  const presentation = new SatellitePresentation({ createSnapshot, sampleTrajectory });
  return { presentation, createSnapshot, sampleTrajectory };
}

describe('satellite presentation lifecycle and local prediction admission', () => {
  it('performs no local propagation while disabled, in Solar view or without orbital elements', () => {
    const { presentation, createSnapshot, sampleTrajectory } = setup();
    for (const changes of [{ enabled: false }, { viewMode: 'solar' as const }, { dataset: null }]) {
      expect(presentation.update(input(changes))).toEqual({ snapshot: null, trajectory: null, diagnostic: null });
    }
    expect(createSnapshot).not.toHaveBeenCalled();
    expect(sampleTrajectory).not.toHaveBeenCalled();
    presentation.update(input());
    const disabled = presentation.update(input({ enabled: false }));
    expect(disabled.snapshot).toBeNull();
    expect(disabled.trajectory).toBeNull();
    presentation.update(input({ enabled: false, now: 10_000 }));
    expect(createSnapshot).toHaveBeenCalledTimes(1);
    expect(sampleTrajectory).toHaveBeenCalledTimes(1);
  });

  it('does not repeat SGP4 or sampling at frozen simulation UTC despite elapsed wall time', () => {
    const { presentation, createSnapshot, sampleTrajectory } = setup();
    const first = presentation.update(input());
    for (const now of [10, 250, 500, 2000, 10_000]) expect(presentation.update(input({ now }))).toBe(first);
    expect(createSnapshot).toHaveBeenCalledTimes(1);
    expect(sampleTrajectory).toHaveBeenCalledTimes(1);
    presentation.update(input({ at: new Date(epoch + 500), now: 10_500 }));
    expect(createSnapshot).toHaveBeenCalledTimes(2);
    expect(sampleTrajectory).toHaveBeenCalledTimes(2);
  });

  it('updates a large simulation jump within the wall throttle and hides an obsolete arc between bounded samples', () => {
    const { presentation, createSnapshot, sampleTrajectory } = setup();
    presentation.update(input());
    const jumped = presentation.update(input({ at: new Date(epoch + 120_000), now: 100 }));
    expect(jumped.snapshot?.epoch).toBe(new Date(epoch + 120_000).toISOString());
    expect(jumped.trajectory).toBeNull();
    expect(createSnapshot).toHaveBeenCalledTimes(2);
    expect(sampleTrajectory).toHaveBeenCalledTimes(1);
    const refreshed = presentation.update(input({ at: new Date(epoch + 121_000), now: 2100 }));
    expect(refreshed.trajectory?.epoch).toBe(new Date(epoch + 121_000).toISOString());
    expect(sampleTrajectory).toHaveBeenCalledTimes(2);
  });

  it('contains freshness-boundary arc exceptions and avoids retrying an unchanged frozen failure', () => {
    const { presentation, sampleTrajectory } = setup();
    sampleTrajectory.mockImplementation(() => { throw new Error('Element epoch outside supported prediction window.'); });
    const result = presentation.update(input());
    expect(result.snapshot?.states).toHaveLength(1);
    expect(result.trajectory).toBeNull();
    expect(result.diagnostic).toContain('Element epoch outside supported prediction window');
    expect(() => presentation.update(input({ now: 10_000 }))).not.toThrow();
    expect(sampleTrajectory).toHaveBeenCalledTimes(1);
  });

  it('clears a selected arc when propagation rejects that selection and invalidates changed datasets', () => {
    const { presentation, createSnapshot, sampleTrajectory } = setup();
    presentation.update(input());
    createSnapshot.mockImplementation((_dataset, at) => ({ ...makeSnapshot(_dataset, at), states: [],
      rejected: [{ noradId: 25544, reason: 'Orbital elements too old.' }] }));
    const rejected = presentation.update(input({ at: new Date(epoch + 1000), now: 10 }));
    expect(rejected.trajectory).toBeNull();
    expect(sampleTrajectory).toHaveBeenCalledTimes(1);
    presentation.update(input({ dataset: { ...dataset }, at: new Date(epoch + 1000), now: 20 }));
    expect(createSnapshot).toHaveBeenCalledTimes(3);
  });

  it('rebuilds selected/quality arcs without repeating positions, and clears arcs when paths are hidden', () => {
    const { presentation, createSnapshot, sampleTrajectory } = setup();
    presentation.update(input());
    const low = presentation.update(input({ quality: 'low', now: 10 }));
    expect(low.trajectory).not.toBeNull();
    expect(sampleTrajectory).toHaveBeenLastCalledWith(record, new Date(epoch), 48);
    expect(createSnapshot).toHaveBeenCalledTimes(1);
    expect(presentation.update(input({ showOrbits: false, now: 20 })).trajectory).toBeNull();
    presentation.update(input({ showOrbits: true, now: 30 }));
    expect(sampleTrajectory).toHaveBeenCalledTimes(3);
    const absent = presentation.update(input({ selectedNoradId: 99999, now: 40 }));
    expect(absent.trajectory).toBeNull();
    expect(sampleTrajectory).toHaveBeenCalledTimes(3);
  });

  it('contains unexpected snapshot errors, clears previous state and does not spin at identical UTC', () => {
    const { presentation, createSnapshot, sampleTrajectory } = setup();
    presentation.update(input());
    createSnapshot.mockImplementation(() => { throw new Error('Unexpected prediction failure'); });
    const failed = presentation.update(input({ at: new Date(epoch + 1000), now: 10 }));
    expect(failed.snapshot).toBeNull();
    expect(failed.trajectory).toBeNull();
    expect(failed.diagnostic).toContain('Unexpected prediction failure');
    presentation.update(input({ at: new Date(epoch + 1000), now: 10_000 }));
    expect(createSnapshot).toHaveBeenCalledTimes(2);
    expect(sampleTrajectory).toHaveBeenCalledTimes(1);
  });
});
