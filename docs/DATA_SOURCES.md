# Astronomy data and provider constraints

## Local ephemeris is first-class

`astronomy-engine` provides offline heliocentric state evaluation for eight planets and the Moon. It returns J2000 equatorial frame (`EQJ`), heliocentric position in AU. This supports accurate time propagation without querying an API every rendered frame. Document its algorithmic limits; don't label as JPL Horizons output.

## NASA JPL Horizons

- Docs: https://ssd-api.jpl.nasa.gov/doc/horizons.html
- `https://ssd.jpl.nasa.gov/api/horizons.api?format=json&COMMAND='399'&EPHEM_TYPE=VECTORS&CENTER='500@10'&START_TIME='2026-10-19'&STOP_TIME='2026-10-20'&STEP_SIZE='1%20h'&REF_PLANE=FRAME&REF_SYSTEM=ICRF&OUT_UNITS=AU-D&VEC_CORR=NONE&VEC_TABLE=2&OBJ_DATA=NO`
- Returned `format=json` contains a text `result` field; parse cautiously, check API `signature.version` and `$$SOE`/`$$EOE`; `COMMAND=399` Earth, `499` Mars; body IDs must be explicit.
- Solar sync: attempt current-time request on startup **only when an endpoint is configured**. Re-sync every 1/6/24h. Prefer shared cached batch service for public Workshop distribution, not every installed copy downloading full ephemeris directly.
- Shared cache should return ephemeris samples and validity windows or a documented comparison state. A single 6D vector is not a license to linearly extrapolate orbital state for days.

## CelesTrak OMM GP / satellites

- Docs: https://celestrak.org/NORAD/documentation/gp-data-formats.php
- Usage Policy: https://celestrak.org/usage-policy.php
- ISS: `https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=JSON`
- Stations: `https://celestrak.org/NORAD/elements/gp.php?GROUP=STATIONS&FORMAT=JSON`
- GPS: `GROUP=GPS-OPS` (verify current group taxonomy prior to release).
- JSON OMM fields include `OBJECT_NAME`, `NORAD_CAT_ID`, `EPOCH`, `MEAN_MOTION`, `ECCENTRICITY`, etc. `satellite.js` parses OMM with `json2satrec`.
- GP refresh **once per 2h per dataset at most**. Do not request `ACTIVE` or `STARLINK` by default. LARGE groups have provider rate-enforcement; prefer filtered subsets through shared cache.
- A user-selected `1h` sync interval affects only planets, never lowers the satellite refresh TTL.
- Source data is an epoch snapshot; position for the live time is a local SGP4 prediction and becomes less reliable as source age increases.
- For frame correctness: SGP4 TEME coordinates are NOT the same as heliocentric EQJ; Earth mode needs explicitly tested transform/earth rotation service before claiming precise positioning.

## Security

- No `VITE_` API secrets. Protect optional Worker against arbitrary target URLs, oversized responses, abuse and loops. Cache keyed by dataset/time bucket, validate all responses and provide timeout/retry ceilings.
- Bundle all JS/CSS/texture assets locally; fallback to `astronomy-engine` and last known good cached OMM.

## Asset policy

Generated procedural textures are illustrative. Before publishing, replace/augment them with properly licensed images, record provenance under `public/textures/ATTRIBUTION.md` and ship any required notices.
