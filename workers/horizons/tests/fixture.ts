/** Synthetic parser-only fixture. These numbers are NOT reference ephemerides. */
export const VALID_BODY = JSON.stringify({
  signature: { source: 'NASA/JPL Horizons API', version: '1.2' },
  result: 'Reference frame : ICRF\n$$SOE\n2461332.5, A.D. 2026-Oct-19 00:00:00.0000, 1.0E+00, -2.0E-01, 3.0E-02, 4.0E-03, 5.0E-04, -6.0E-05,\n$$EOE\n',
});
