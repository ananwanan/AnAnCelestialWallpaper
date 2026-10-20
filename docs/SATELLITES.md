# Satellite elements and local prediction (M4)

M4 implements a bounded, opt-in ISS/Tiangong/GPS layer. `showSatellites=false` is the default. Disabling the layer aborts requests and the application stops propagation, trajectory sampling and satellite drawing. Host pause suspends requests and scheduling; resume preserves source cooldowns. Starlink remains unavailable until M5.

## Source and service

The client accepts a public `VITE_SATELLITE_BASE_URL`; it requests only `/api/satellites?group=stations` or `?group=gps`. No configured URL means an explicit unavailable status and no fabricated orbit data. Deployment and actual upstream availability are separate acceptance gates; the existing Horizons endpoint does not imply satellite service availability.

The separately deployed Worker now includes `SatellitesGate`, a SQLite Durable Object binding with migration `v2-satellites`. One globally named object gates both datasets. It uses fixed CelesTrak URLs with `GROUP=STATIONS&FORMAT=JSON` or `GROUP=GPS-OPS&FORMAT=JSON`, an identifying User-Agent and no redirects. There is no arbitrary URL, catalog-wide request, client secret or open proxy. Request query/method/body/origin checks remain shared with the existing service. Source responses are capped at 100 KiB and 15 seconds; identical source work coalesces with at most 32 waiters. Client responses are capped at 256 KiB and 20 seconds, including unresponsive cancellation/transport cases.

**Deployment record (2026-10-19/20):** the initial M4 version `c715edf2-3f4b-483c-b438-76c6fe4f3113` deployed at `https://horizons.ananwanan.cc`. Both first scoped source operations returned service503 with no usable catalog and a persisted roughly 2.2-hour Retry-After. No upstream HTTP policy-halt header was received. The current version `d3b4c583-ff86-4ad2-9d14-38c46a7456fe` adds read-only diagnostics and persists the phase of subsequent source failures. It preserves the same Durable Object name, storage schema, cache and cooldowns. The route is deployed, but current ISS/Tiangong/GPS catalog acquisition is **not verified**. Production configuration points to this real service; normal wallpaper operation honors the cooldown. See [exact validation boundaries](VALIDATION.md).

**Latest live follow-up at 2026-10-20 06:30–06:31 Asia/Shanghai:** the final bounded operation scheduled for 06:28 ran only after both recorded cooldowns expired. One attempt per dataset again produced a **15,000 ms timeout before any HTTP response**, matching the 02:14–02:15 result. The diagnostics do not establish an upstream HTTP503 or an OMM parser failure. Source connectivity from this deployed Worker remains unresolved; no actual ISS, Tianhe or GPS element epoch, current propagation result or real-satellite screenshot was obtained. Automatic follow-up has ended; further investigation requires evidence about the Worker-to-CelesTrak network path. See the detailed records below.

Reviewed again 2026-10-20 (Asia/Shanghai): [CelesTrak GP format/query documentation](https://celestrak.org/NORAD/documentation/gp-data-formats.php) and [usage policy](https://celestrak.org/usage-policy.php). The documented JSON format omits redundant Earth/TEME/UTC/SGP4 fields; explicit conflicting values are rejected. STATIONS and GPS-OPS are documented group choices. CelesTrak updates GP data at two-hour intervals and asks clients to stop source querying after any non-200 HTTP response for human investigation.

Both service and client persist a minimum two-hour reservation **before** starting a dataset request. Reload, group toggle, disable/enable, failed request or one-hour planetary interval cannot erase it. Source failures retain usable last-good data. Transport/parser failures have capped exponential backoff with jitter and `Retry-After`; upstream non-200 responses set a durable **global source halt**, propagated through `X-Satellite-Blocked: true`, until the repository owner investigates and deliberately repairs the server gate. There is no wallpaper button that bypasses a provider halt. A service-generated transient 429/503 without that header uses its cooldown instead. Deleting all client storage cannot bypass the server reservation.

Responses expose `X-Satellite-Cache: MISS/HIT/STALE`, `X-Satellite-Source`, `X-Satellite-Retrieved-At`, `Age`, `Retry-After` and the policy-halt header through the configured CORS allowlist. `Live/Sync` means fresh orbital-element acquisition; every displayed position remains a local prediction. A cached or stale response keeps its original source retrieval time.

## Read-only investigation and cooldown-safe follow-up

`GET /api/satellites/status` reports server UTC, the two-hour minimum, global policy halt, active group and each dataset's `nextAllowedAt`, remaining seconds, failure count, usable cached record count, source retrieval/epoch and most recent attempt diagnostic. It never contacts CelesTrak, reserves an attempt, writes state or clears a halt. It accepts no query parameters; CORS, bodyless GET and origin restrictions match the data route. The normalized `/api/satellites?group=...` response contract consumed by the wallpaper is unchanged. The wallpaper does not poll the status route.

New attempt diagnostics retain UTC start/completion, duration, upstream HTTP status when available and a bounded message. `outcome` distinguishes `timeout`, `transport`, `http`, `validation`, `configuration`, `storage` and `success`. Diagnostic persistence is optional: its failure cannot turn valid data into a failed acquisition. The earlier deployment did not retain its error cause, so a `null` `lastAttempt` for those historical failures does **not** establish whether they were a network timeout, transport exception or parser rejection. A generic service503 without a policy-halt header does not establish that CelesTrak itself returned HTTP503.

Live read-only verification at `2026-10-19T16:47:15Z` (2026-10-20 00:47:15 Asia/Shanghai) confirmed `blocked=null`, no active request, one historical failure per group and zero usable cached records. Both reads retained exactly the same allowances; deployment did not erase them. Reset parameters, POST and unlisted origins were rejected. No source data route was requested during this investigation.

| Dataset | Exact persisted next allowed UTC | Asia/Shanghai |
|---|---|---|
| STATIONS / ISS and Tianhe when present | 2026-10-19 18:11:08.373Z | 2026-10-20 02:11:08.373 |
| GPS-OPS | 2026-10-19 18:13:36.201Z | 2026-10-20 02:13:36.201 |

The machine-readable evidence is [the read-only service report](../artifacts/satellite-service-2026-10-20/satellites-service-2026-10-19T16-47-15-968Z.json). These timestamps describe this recorded state, not a permanent retry schedule. Always read the current status before any later source operation.

From the repository root, this command is read-only by default:

```powershell
node scripts/check-satellites-service.mjs https://horizons.ananwanan.cc --output=artifacts/satellite-service-2026-10-20
```

After **both** current allowances have expired, and only if status reports no global halt or active operation, permit one sequential attempt for STATIONS followed by GPS-OPS:

```powershell
node scripts/check-satellites-service.mjs https://horizons.ananwanan.cc --fetch --groups=stations,gps --output=artifacts/satellite-service-2026-10-20
```

The script reads the server gate first, skips datasets in cooldown and stops after the first HTTP error, invalid response, policy halt or stale fallback. HTTP status, Retry-After and response SHA-256 are retained even when the body is not JSON; a transport exception also retains its started attempt and error. It has no automatic retry, direct CelesTrak request, alternate proxy, storage reset or halt-clearing option. A successful response records the exact normalized payload, cache/source headers, NORAD identities and element epochs, then checks finite SGP4 TEME positions, plausible altitude and movement after 60 seconds at the requested real UTC. Prediction refusal for stale epochs remains explicit. These host math checks do not establish native rendering, Earth-frame precision or long-duration performance. Confirm ISS 25544 and Tianhe 48274 only when actually returned; do not fabricate a missing object.

On a failed follow-up, inspect `statusAfter.datasets[].lastAttempt` and its new allowance before changing code:

- `timeout` / `transport`: investigate connectivity from this deployed Worker and its fixed HTTPS source. Do not diagnose a local browser or a different egress route as proof that this Worker can fetch the source.
- `http`: leave the durable global source halt intact. Review the source status and official policy; owner investigation is required before a deliberate repair. Do not clear state merely to try again.
- `validation`: review the exact content-type/JSON/OMM error and source contract. Keep the strict metadata, bounds and epoch checks; do not relabel invalid or synthetic elements as live data.
- `configuration` / `storage`: fix that service failure while preserving the gate. Re-read current cooldowns before any further attempt.

If STATIONS fails with a diagnosed transport/timeout and **no** upstream non-200 response or global halt, an operator may inspect that failure, re-read the status and independently try `--fetch --groups=gps` once after GPS's own allowance expires. This preserves the new STATIONS cooldown; the script never makes this decision automatically. Any upstream non-200/global halt forbids further source querying for either group until owner investigation and repair.

The diagnostic-only deployment passed Worker typecheck, **114 tests** and deployment dry-run. Tests include read-only/no-mutation status behavior, persisted failure phases, optional diagnostic storage failure, unchanged wallpaper-client integration and seven synthetic local-server smoke checks for read-only defaults, cooldown/halt preservation, sequential SGP4 checks and stop-on-error. The existing four root satellite suites also passed (**49 tests**). Synthetic smoke data is confined to tests and is not real-catalog evidence.

### Actual cooled follow-up, 2026-10-20 02:14–02:15 Asia/Shanghai

The [18:14:16Z preflight status](../artifacts/satellite-service-2026-10-20/satellites-service-2026-10-19T18-14-16-132Z.json) confirmed both allowances had expired, no global halt and no active operation. The first safe smoke stopped after STATIONS failed. Its persisted diagnostic was then inspected: `outcome=timeout`, `upstreamStatus=null`, no global halt. A [second read-only status](../artifacts/satellite-service-2026-10-20/satellites-service-2026-10-19T18-14-48-962Z.json) confirmed GPS remained independently allowed; only then was a single `--groups=gps` operation run. This was two sequential source operations, not an automatic retry of either dataset.

| Dataset | Source operation UTC | Result | New durable next allowed UTC / Asia/Shanghai |
|---|---|---|---|
| STATIONS | 18:14:21.160Z–18:14:36.160Z | service503; Retry-After14481s; timeout15000ms; no HTTP response | 2026-10-19 22:15:56.915Z / 2026-10-20 06:15:56.915 |
| GPS-OPS | 18:14:54.081Z–18:15:09.081Z | service503; Retry-After15133s; timeout15000ms; no HTTP response | 2026-10-19 22:27:21.946Z / 2026-10-20 06:27:21.946 |

Exact payloads, hashes, headers and gate diagnostics are in the [STATIONS attempt report](../artifacts/satellite-service-2026-10-20/satellites-service-2026-10-19T18-14-21-000Z.json) and [GPS attempt report](../artifacts/satellite-service-2026-10-20/satellites-service-2026-10-19T18-14-54-052Z.json). Both retained `blocked=null`, `cachedRecords=0`, failure count2 and message `CelesTrak request timed out.`. No new attempt was made inside either new cooldown, and no gate was reset or alternate source/egress used.

The measured boundary is the Worker's fixed CelesTrak fetch not returning response headers before the application's existing 15-second deadline. The available evidence does not distinguish DNS, TCP/TLS, provider firewall or slow upstream response. It supplies no definite parser or local code defect to repair. Increasing deadlines, switching domains/egress, clearing storage or weakening OMM validation would not constitute a verified fix. Next investigation should use Cloudflare-side network/trace evidence for this same source path before a further deliberate, gate-approved operation. These new allowances supersede the earlier 02:11/02:13 recorded schedule; read the current status before any later source work.

### Final scheduled follow-up, 2026-10-20 06:30–06:31 Asia/Shanghai

The 06:28 heartbeat first read the current instructions and records and found no equivalent completed follow-up. The [22:30:30Z read-only preflight](../artifacts/satellite-service-2026-10-20/satellites-service-2026-10-19T22-30-30-264Z.json) confirmed both current allowances had expired, `blocked=null`, `activeGroup=null` and unchanged 02:14 diagnostics. The serial `--fetch --groups=stations,gps` smoke stopped on its first STATIONS error; it did not query GPS. Manual inspection established `outcome=timeout`, `upstreamStatus=null` and no global halt. A [fresh 22:31:05Z read-only status](../artifacts/satellite-service-2026-10-20/satellites-service-2026-10-19T22-31-05-604Z.json) preserved the new STATIONS reservation and confirmed GPS remained independently eligible. Only then was one GPS-only source operation run.

| Dataset | Source operation UTC on 2026-10-19 | Result | New durable next allowed UTC / Asia/Shanghai on 2026-10-20 |
|---|---|---|---|
| STATIONS | 22:30:40.957Z–22:30:55.957Z | service503; Retry-After34419s; timeout15000ms; no upstream HTTP response | 2026-10-20 08:04:34.322Z / 16:04:34.322 |
| GPS-OPS | 22:31:11.224Z–22:31:26.224Z | service503; Retry-After29166s; timeout15000ms; no upstream HTTP response | 2026-10-20 06:37:31.838Z / 14:37:31.838 |

Exact response payloads, hashes, headers and persisted source diagnostics are in the [final STATIONS report](../artifacts/satellite-service-2026-10-20/satellites-service-2026-10-19T22-30-40-089Z.json) and [final GPS report](../artifacts/satellite-service-2026-10-20/satellites-service-2026-10-19T22-31-10-355Z.json). Both groups ended with failure count 3, `cachedRecords=0`, `retrievedAt=null`, `epoch=null` and `upstreamStatus=null`; final global halt and active group remained null. GPS's report retained the exact new STATIONS gate. These new allowances supersede the historical 06:15/06:27 gates and are persisted reservations, **not a new retry schedule**.

The repeated failure boundary remains receipt of upstream HTTP headers, before OMM parsing or SGP4 could run. No current ISS 25544, Tianhe 48274 or GPS catalog validation, real-data propagation or native real-satellite rendering can be claimed. The evidence does not isolate DNS, TCP/TLS, provider firewall or slow response, and establishes no local code defect to repair. This run changed no runtime/provider code, deployed nothing and preserved all source gates and host settings. It ends the automatic follow-up: no additional retry or chat was scheduled. Further work must investigate the Cloudflare Worker-to-CelesTrak network path before any deliberate source operation approved by the current durable gate; no alternate egress, storage reset, increased deadline or relaxed parser was used.

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
