# Satellite elements and local prediction (M4)

M4 implements a bounded, opt-in ISS/Tiangong/GPS layer. `showSatellites=false` is the default. Disabling the layer aborts requests and the application stops propagation, trajectory sampling and satellite drawing. Host pause suspends requests and scheduling; resume preserves source cooldowns. Starlink remains unavailable until M5.

## Source and service

The client accepts a public `VITE_SATELLITE_BASE_URL`; it requests only `/api/satellites?group=stations` or `?group=gps`. No configured URL means an explicit unavailable status and no fabricated orbit data. Deployment and actual upstream availability are separate acceptance gates; the existing Horizons endpoint does not imply satellite service availability.

The separately deployed Worker now includes `SatellitesGate`, a SQLite Durable Object binding with migration `v2-satellites`. One globally named object gates both datasets. It uses fixed CelesTrak URLs with `GROUP=STATIONS&FORMAT=JSON` or `GROUP=GPS-OPS&FORMAT=JSON`, an identifying User-Agent and no redirects. There is no arbitrary URL, catalog-wide request, client secret or open proxy. Request query/method/body/origin checks remain shared with the existing service. Source responses are capped at 100 KiB and 15 seconds; identical source work coalesces with at most 32 waiters. Client responses are capped at 256 KiB and 20 seconds, including unresponsive cancellation/transport cases.

**Deployment record (2026-10-19/20):** version `c715edf2-3f4b-483c-b438-76c6fe4f3113` deployed at `https://horizons.ananwanan.cc`. Both first scoped source operations returned service503 with no usable catalog and a persisted roughly 2.2-hour Retry-After. No upstream HTTP policy-halt header was received. The route is deployed, but current ISS/Tiangong/GPS catalog acquisition is **not verified**. Production configuration points to this real service; normal wallpaper operation honors the cooldown. See [exact validation boundaries](VALIDATION.md).

Reviewed 2026-10-19: [CelesTrak GP format/query documentation](https://celestrak.org/NORAD/documentation/gp-data-formats.php) and [usage policy](https://celestrak.org/usage-policy.php). The documented JSON format omits redundant Earth/TEME/UTC/SGP4 fields; explicit conflicting values are rejected. STATIONS and GPS-OPS are documented group choices. CelesTrak updates GP data at two-hour intervals and asks clients to stop source querying after any non-200 HTTP response for human investigation.

Both service and client persist a minimum two-hour reservation **before** starting a dataset request. Reload, group toggle, disable/enable, failed request or one-hour planetary interval cannot erase it. Source failures retain usable last-good data. Transport/parser failures have capped exponential backoff with jitter and `Retry-After`; upstream non-200 responses set a durable **global source halt**, propagated through `X-Satellite-Blocked: true`, until the repository owner investigates and deliberately repairs the server gate. There is no wallpaper button that bypasses a provider halt. A service-generated transient 429/503 without that header uses its cooldown instead. Deleting all client storage cannot bypass the server reservation.

Responses expose `X-Satellite-Cache: MISS/HIT/STALE`, `X-Satellite-Source`, `X-Satellite-Retrieved-At`, `Age`, `Retry-After` and the policy-halt header through the configured CORS allowlist. `Live/Sync` means fresh orbital-element acquisition; every displayed position remains a local prediction. A cached or stale response keeps its original source retrieval time.

## Data boundary and bounded groups

`SatelliteDataset` includes schemaVersion 1, source `CelesTrak-GP`, source retrieval UTC, oldest source epoch, prediction validity bounds, Earth origin, TEME frame, element units and quality `orbital elements`. The full record retains name, NORAD ID, UTC element epoch, mean motion and drag/eccentricity/orientation terms. Cache validation rejects incompatible metadata, ambiguous dates, duplicate IDs, invalid fields and source retrieval older than seven days. Expired payloads do not reset their separate network allowance.

The strict parser accepts numeric JSON fields or finite numeric strings; rejects NaN/null/coerced booleans, unsupported frame/model/time system, impossible calendar dates, incompatible OMM versions and implausible orbital ranges. Epochs without a suffix are interpreted as UTC under the documented CelesTrak contract. JavaScript Date truncates sub-millisecond fractions; normalized stored timestamps always end in `Z`. Nine-digit NORAD catalog IDs do not pass through a five-digit TLE representation.

STATIONS input is filtered to ISS/ZARYA 25544 and CSS/Tianhe 48274 **when present**. A missing catalog entry is never invented. GPS-OPS input is restricted to GPS/NAVSTAR identities and at most 40 records. At most 128 input records are parsed. The parser rejects a malformed dataset rather than silently blessing a truncated or partially invalid source response.

## Propagation and coordinate limits

[`satellite.js` 7.1.0](https://github.com/shashwatak/satellite-js) provides pure JavaScript SGP4/SDP4. Its optional WASM facilities are unused. SatRec initialization is cached per immutable element record. Propagation uses the displayed UTC simulation date, independent of wall-clock source refreshes. The implementation rejects library errors, non-finite states, radius outside 6,370–100,000 km or geodetic altitude outside 80–95,000 km.

SGP4 output is Earth-centered **TEME/km**, never heliocentric EQJ. The conversion is TEME → pseudo Earth-fixed using the Vallado GMST rotation, approximating UT1=UTC and zero polar motion; then Earth-fixed → EQJ/J2000 through the tested M3 Greenwich/east/north basis. The normalized renderer boundary is Earth-centered EQJ/J2000/km and quality **approximate prediction**. The M3 Earth orientation uses precession/nutation plus GAST, so a TEME vector is not simply relabeled J2000. UT1/polar-motion/EOP corrections are not a precision tracking service, and omission of them remains visible in the interface.

Predicted arcs span half an orbital period before and after their stated simulation center, with 16–192 even segments. Every sample is individually propagated and converted at its own epoch to the common inertial axes. Past and future segments share the exact center sample and are labeled predicted. The renderer never applies Solar distance compression to these positions.

| Policy | LEO / stations | MEO / GPS-like mean motion <3 rev/day |
|---|---:|---:|
| Stale warning from absolute element age | >3 days | >7 days |
| Refuse propagation from absolute epoch offset | >7 days | >14 days |
| Maximum source cache retrieval age | 7 days | 7 days |

These conservative product windows are project policy, not guarantees of orbital accuracy. Input elements more than 30 days old or more than one day in the future at source retrieval are rejected. Large simulation-time jumps can therefore leave planets visible while satellites explicitly report that propagation was refused. Stale data, decay, atmospheric drag uncertainty and maneuvers can reduce accuracy well before the hard cutoff.

## Reproducible reference and lifecycle tests

The pinned satellite.js public barrel also exports optional WASM/Node worker backends. Vite scans those workers before eliminating unused exports, which initially failed the static wallpaper build. `vite.config.ts` has a guarded pre-transform that removes only the optional WASM re-export from the installed barrel and excludes it from dependency prebundling; the published JavaScript SGP4 functions and TypeScript types remain unchanged. A changed dependency barrel fails closed for review. The production build must remain free of Node imports, WASM workers and remote runtime assets.

`tests/fixtures/satelliteReference.ts` records Vallado AIAA-2006-6753 case 00005 (Vanguard) numeric elements and three published TEME reference positions at epoch, +360 and +720 minutes. Inputs match the [official CelesTrak conversion example](https://raw.githubusercontent.com/CelesTrak/fundamentals-of-astrodynamics/main/software/matlab/exsgp4_teme.m); expected vectors come from the [published verification output preserved by python-sgp4](https://raw.githubusercontent.com/brandon-rhodes/python-sgp4/master/sgp4/tcppver.out). The 20 m Euclidean tolerance includes sub-millisecond source epoch truncation. This is a regression fixture, not current satellite data.

Earth-fixed rotation has exact checks against the [satellite.js transform fixtures](https://raw.githubusercontent.com/shashwatak/satellite-js/develop/test/transforms.json), a J2000 GMST sign/reference check and an M3 inverse-frame round trip. Tests also cover source epoch stale/refusal windows, bounded past/future samples, parser rejection, current-time position movement, immutable dataset identity, zero requests before enabling, cancellation, host suspension, ignored abort signals, persisted cadence, group switches, failure/reload backoff, Retry-After, cache corruption/expiry and upstream policy halts. Worker tests separately cover global reservations, coalescing, strict routes/CORS, source blocking, stale fallback and timeout.

Browser, native Wallpaper Engine, real source catalog availability and long-duration resource behavior remain separate validation records in [VALIDATION.md](VALIDATION.md). No default runtime fixture is presented as actual tracked satellites.
