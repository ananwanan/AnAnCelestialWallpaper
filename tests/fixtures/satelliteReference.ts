/** Numeric regression elements: Vallado AIAA-2006-6753 verification case 00005, NOT current orbit data.
 * Input: https://raw.githubusercontent.com/CelesTrak/fundamentals-of-astrodynamics/main/software/matlab/exsgp4_teme.m
 * Expected TEME km: https://raw.githubusercontent.com/brandon-rhodes/python-sgp4/master/sgp4/tcppver.out
 * TLE epoch 00179.78495062 -> UTC 2000-06-27T18:50:19.733568Z. Date truncation <1ms: tolerance 0.02km.
 */
export const VANGUARD_OMM = {
  OBJECT_NAME: 'VANGUARD 1', OBJECT_ID: '1958-002B', EPOCH: '2000-06-27T18:50:19.733568',
  NORAD_CAT_ID: 5, MEAN_MOTION: 10.82419157, ECCENTRICITY: 0.1859667, INCLINATION: 34.2682,
  RA_OF_ASC_NODE: 348.7242, ARG_OF_PERICENTER: 331.7664, MEAN_ANOMALY: 19.3264,
  BSTAR: 0.000028098, MEAN_MOTION_DOT: 0.00000023, MEAN_MOTION_DDOT: 0,
  ELEMENT_SET_NO: 475, REV_AT_EPOCH: 41366, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U',
};
export const VANGUARD_REFERENCE = [
  { minutes: 0, position: { x: 7022.46529266, y: -1400.08296755, z: 0.03995155 } },
  { minutes: 360, position: { x: -7154.03120202, y: -3783.17682504, z: -3536.19412294 } },
  { minutes: 720, position: { x: -7134.59340119, y: 6531.68641334, z: 3260.27186483 } },
];
/** Synthetic narrowly-scoped input for scheduling/parser tests; never bundled as current satellite data. */
export const SYNTHETIC_STATION_OMM = { ...VANGUARD_OMM, OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A',
  EPOCH: '2026-10-19T00:00:00.000000', NORAD_CAT_ID: 25544, MEAN_MOTION: 15.5, ECCENTRICITY: 0.0006, INCLINATION: 51.64 };
export const SYNTHETIC_GPS_OMM = { ...SYNTHETIC_STATION_OMM, OBJECT_NAME: 'GPS BIIR-2 (PRN 13)', NORAD_CAT_ID: 24876, MEAN_MOTION: 2.0056, INCLINATION: 55 };
