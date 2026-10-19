# Ephemeris reference provenance

`jpl-snapshot-2026-10-19.json` is a recorded response from the deployed normalized
Horizons adapter, not a generated fixture. The adjacent `.source.json` records
its URL, capture time and source retrieval time. Preserve these files when
editing synthetic parser/transport tests.

All nine states use Sun-centered ICRF axes, AU and AU/day, at exactly
`2026-10-19T00:00:00.000Z`. This is an hourly sample boundary, so the adapter
returns original Horizons state vectors rather than interpolating between rows.
`retrievedAt` is the oldest retrieval among the complete source set. It is
distinct from the state epoch and capture time.

`EphemerisGolden.test.ts` compares local Astronomy Engine EQJ positions at that
same UTC epoch. ICRF and EQJ/J2000 are closely aligned, not identical; this is a
model sanity comparison rather than a reference-frame conversion or a precision
certification. The tolerance is one arcminute times heliocentric distance plus
`1e-5 AU` (about 1,496 km), consistent with the local model's approximate angular
accuracy target. Moon is checked both as Sun-centered Earth + GeoMoon and as the
Earth-centered difference between the captured Moon and Earth states; the latter
uses one arcminute times lunar distance plus `1e-7 AU` (about 15 km).

Local position continuity and 24-hour resume without rendered frames are covered
by `PlanetEphemeris.test.ts` and `SimulationClock.test.ts`. Remote cache retention
and expiry after a full offline day are covered by `EphemerisSync.test.ts`.

Provider references: [JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html),
[JPL Horizons reference frames](https://ssd.jpl.nasa.gov/horizons/manual.html#frames),
[Astronomy Engine](https://github.com/cosinekitty/astronomy).
