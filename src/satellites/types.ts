export type SatelliteGroup = 'stations' | 'gps';
export interface KmVector { readonly x: number; readonly y: number; readonly z: number; }
/** Validated CelesTrak GP JSON fields; angles deg, mean motion rev/day, UTC epoch. */
export interface OmmRecord {
  readonly OBJECT_NAME: string; readonly OBJECT_ID: string; readonly EPOCH: string;
  readonly NORAD_CAT_ID: number; readonly MEAN_MOTION: number; readonly ECCENTRICITY: number;
  readonly INCLINATION: number; readonly RA_OF_ASC_NODE: number; readonly ARG_OF_PERICENTER: number;
  readonly MEAN_ANOMALY: number; readonly BSTAR: number; readonly MEAN_MOTION_DOT: number;
  readonly MEAN_MOTION_DDOT: number; readonly ELEMENT_SET_NO: number; readonly REV_AT_EPOCH: number;
  readonly EPHEMERIS_TYPE: 0; readonly CLASSIFICATION_TYPE: 'U';
}
export interface SatelliteDataset {
  readonly schemaVersion: 1; readonly group: SatelliteGroup; readonly source: 'CelesTrak-GP';
  readonly retrievedAt: string; readonly epoch: string; readonly validFrom: string; readonly validUntil: string;
  readonly referenceFrame: 'TEME'; readonly origin: 'Earth'; readonly units: 'OMM: deg, rev/day';
  readonly quality: 'orbital elements'; readonly records: readonly OmmRecord[];
}
export interface SatelliteState {
  readonly noradId: number; readonly name: string; readonly elementEpoch: string;
  readonly positionKm: KmVector; readonly temeKm: KmVector; readonly ecefKm: KmVector;
  readonly altitudeKm: number; readonly ageDays: number; readonly stale: boolean;
}
export interface SatelliteSnapshot {
  readonly epoch: string; readonly referenceFrame: 'EQJ/J2000'; readonly origin: 'Earth'; readonly units: 'km';
  readonly quality: 'approximate prediction'; readonly states: readonly SatelliteState[];
  readonly rejected: readonly { readonly noradId: number; readonly reason: string }[];
}
export interface SatelliteTrajectory {
  readonly noradId: number; readonly epoch: string; readonly validFrom: string; readonly validUntil: string;
  readonly referenceFrame: 'EQJ/J2000'; readonly origin: 'Earth'; readonly units: 'km';
  readonly quality: 'approximate prediction'; readonly past: readonly KmVector[]; readonly future: readonly KmVector[];
}
