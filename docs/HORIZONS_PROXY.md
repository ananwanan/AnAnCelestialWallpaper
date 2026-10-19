# Horizons Cloudflare proxy

The optional `workers/horizons` service provides constrained raw output and normalized nine-body comparisons from the fixed upstream [`https://ssd.jpl.nasa.gov/api/horizons.api`](https://ssd.jpl.nasa.gov/api/horizons.api). It deploys independently of the offline wallpaper.

**Deployment status: normalized and raw API checks passed on 2026-10-19 at `14:08:32.988Z` (22:08 Asia/Shanghai).**

- Primary base URL: https://horizons.ananwanan.cc
- Primary raw API: https://horizons.ananwanan.cc/api/horizons.api
- Primary normalized API: `https://horizons.ananwanan.cc/api/ephemeris?at=<UTC ISO>`
- Verified fallback base URL: https://anan-celestial-horizons.anan-celestial.workers.dev
- Verified fallback raw API: https://anan-celestial-horizons.anan-celestial.workers.dev/api/horizons.api
- M2 smoke version: `b9358797-d756-4778-8005-5003d0616aba`. M4 deployment `c715edf2-3f4b-483c-b438-76c6fe4f3113` adds a separately gated `/api/satellites`; its first source operations failed and remain in cooldown. [Satellite policy and live boundary](SATELLITES.md).
- Live smoke: raw Earth query `HIT`; first normalized nine-body request `MISS`, identical normalized request `HIT`. Upstream signature is `NASA/JPL Horizons API` / `1.2`; all normalized bodies have the requested UTC epoch and Sun/ICRF/AU-D metadata.
- `/health`, local-file `Origin: null`, and rejection of arbitrary targets, duplicate parameters, unsupported body/units, unlisted origins and POST verified by `scripts/check-horizons-proxy.mjs`.
- Clean install, local typecheck/tests/build and Worker validation have passed; latest full-suite count and browser/native acceptance boundaries are in [VALIDATION.md](VALIDATION.md). Native Wallpaper Engine preview remains unverified after a host failure.

**Hostname rename (2026-10-19):** The account's Workers subdomain changed from `imorning.workers.dev` to `anan-celestial.workers.dev`. The previous Worker hostname stopped routing. The new hostname passed HTTPS, health, Horizons payload, shared-cache HIT, CORS and request-rejection checks at `2026-10-19T13:17:43.372Z`. Both vector requests were cache hits, retaining the original source retrieval timestamp; renaming did not trigger a new NASA fetch.

**Custom domain (2026-10-19):** `horizons.ananwanan.cc` is bound to the existing production `anan-celestial-horizons` Worker. HTTPS, `/health`, Horizons vectors, local-file CORS and invalid-request rejection passed at `2026-10-19T13:29:15.296Z`. Both vector requests returned `HIT`, retaining source retrieval time `2026-10-19T12:59:30.900Z`; the custom domain shares the same Worker and Durable Object cache. The verified `workers.dev` hostname remains available as a fallback. `workers/horizons/wrangler.jsonc` declares the custom domain under `routes` with `custom_domain: true` for subsequent deployments.

## ADR: optional server-side cache

The repository owner requested Cloudflare login and a Horizons API reverse proxy on 2026-10-19. A small Worker provides controlled server-side access, shared caching and upstream request serialization. The static wallpaper still renders locally without a backend. The Worker uses a single SQLite-backed Durable Object only for its bounded cache, request coordination and backoff; this storage is not a wallpaper database.

The public route accepts a limited solar-system vector query rather than an arbitrary target URL. This preserves the project's no-open-proxy requirement. The Worker is an opt-in deployment and is excluded from the Vite bundle.

## Normalized API and wallpaper integration

`GET /api/ephemeris?at=<UTC ISO>` is implemented and deployed. Set `VITE_EPHEMERIS_BASE_URL=https://horizons.ananwanan.cc`, as production does. The client adds `/api/ephemeris`; do not set the base to the raw route.

The request accepts exactly one `at` parameter, an explicit UTC ISO timestamp; the supported interval is `1962-01-01T00:00:00Z <= at < 2100-12-31T00:00:00Z`, allowing a complete source day. The full normalized URL is capped at 256 characters. Unknown, duplicate or missing parameters fail closed.

One operation returns Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune and Moon. Each body uses 25 hourly position/velocity samples over the requested UTC day. The adapter validates source/version, target ID, Sun center, ICRF frame, AU-D units, geometric vectors, UT/Gregorian headings, Julian/calendar agreement and exact hourly spacing. Cubic Hermite interpolation is bounded to adjacent samples and never extrapolates.

The shared schema carries `schemaVersion: 1`, `source: JPL-Horizons`, `apiVersion: 1.2`, requested `epoch`, oldest source `retrievedAt`, `validFrom`, `validUntil`, `referenceFrame: ICRF`, `origin: Sun`, `units: AU, AU/day`, `quality: comparison`, `interpolation: cubic-hermite-hourly` and nine states. The validity window does not authorize propagation of a returned point indefinitely.

The scene continues local EQJ evaluation at its displayed simulation time. Remote data is compared at its own UTC epoch and never substitutes for local motion. Time warp does not alter remote real-UTC cadence. `Live/Sync` refers to a fresh acquisition; `Cached` identifies reuse. ICRF/EQJ comparison is a sanity check, not a precision frame conversion.

A cold batch performs nine serialized source queries under a 75-second server budget; the browser timeout is 90 seconds. Startup never blocks the first local frame. Equivalent requests coalesce; a busy different-day batch receives 429 rather than an unbounded queue. The browser retains a validated versioned comparison for at most 24 hours, with six-hour freshness, and backs off with jitter/`Retry-After` on failure.

Captured live data and provenance are under `tests/fixtures/`; [DATA_SOURCES.md](DATA_SOURCES.md) documents reference tolerances and residuals. `/api/satellites` remains unimplemented.

## Raw API

`GET /api/horizons.api` returns the Horizons JSON envelope. `format=json` still contains a **text** ephemeris in `result`, along with `signature`; it is not a JSON array of position vectors. A consumer must validate source/version, table markers, epochs, units, origin and frame before interpreting the data. An HTTP 200 alone is insufficient because Horizons can return input errors inside its payload.

The raw route is a separate constrained diagnostic contract. Its envelope is distinct from the implemented normalized route above; raw JSON is never passed directly to the renderer.

### Request contract

`GET /health` reports service configuration without contacting JPL. `GET /api/horizons.api` accepts:

| Parameter | Default | Accepted values |
|---|---|---|
| `COMMAND` | `399` (Earth) | `10` Sun; `199`, `299`, `399`, `499`, `599`, `699`, `799`, `899` planet centers; `301` Moon |
| `START_TIME`, `STOP_TIME` | Current UTC day at midnight through the next midnight | Supply both or neither; Gregorian dates `YYYY-MM-DD` or timestamps `YYYY-MM-DDTHH:mm:ssZ`; positive span of at most 7 days, years 1962–2100 |
| `STEP_SIZE` | `1 h` | Integer hours/days/minutes equivalent to whole hours, from 1 hour through 7 days; at most 169 output samples |

Parameter names are case-insensitive; single-quoted Horizons values are accepted. Unknown or duplicate parameters fail with 400. The full URL is capped at 2,048 characters. Bare calendar timestamps are interpreted as UT, never the machine's local timezone. Requests before 1962 are rejected to avoid treating historical UT1 as UTC.

The following settings are always enforced; callers may repeat them only with the matching value:

```text
format=json   OBJ_DATA=NO   MAKE_EPHEM=YES   EPHEM_TYPE=VECTORS
CENTER=500@10   REF_PLANE=FRAME   REF_SYSTEM=ICRF   OUT_UNITS=AU-D
VEC_CORR=NONE   VEC_TABLE=2   CSV_FORMAT=YES   TIME_TYPE=UT
CAL_TYPE=GREGORIAN   VEC_LABELS=NO   TIME_DIGITS=SECONDS
```

The response is geometric, Sun-centered ICRF equatorial position/velocity in AU and AU/day. Moon vectors are also Sun-centered; they are not Earth-relative Moon orbits. The proxy checks source/API version (`1.2`), one `$$SOE`/`$$EOE` region, bounded sample count and numeric six-component CSV rows. The normalized route additionally validates metadata and time as described above.

The official documentation identifies itself as version 1.3, but the actual upstream JSON returned `signature.version: "1.2"` during verification on 2026-10-19. The parser explicitly supports that observed payload version and rejects other versions until reviewed; the documentation heading is not substituted for the returned signature.

## Operating policy

- Fixed HTTPS upstream and path; no arbitrary URL, custom orbital elements, SPK binary generation or redirect following.
- Only bounded heliocentric geometric state-vector queries for approved Sun/planet/Moon body IDs. Request and response sizes, date span and sample count are capped.
- One shared Durable Object serializes upstream access, with at least 2 seconds between source requests and at most 60 upstream attempts per hour globally. Identical concurrent requests coalesce, with at most 32 waiting callers; a distinct cache miss while busy receives 429 with `Retry-After`.
- Successful raw responses are fresh for 6 hours. On failure/busy state, a last-good response may be served up to 24 hours after retrieval and is explicitly marked stale. Cache storage holds at most 128 keys. This TTL does not change the wallpaper's 1/6/24-hour comparison selection or the separate CelesTrak policy.
- Source failures trigger capped backoff with jitter; `Retry-After` is respected. Failed, oversized or malformed responses never become successful cache entries.
- CORS is explicitly configured for development/local-file origins and approved deployed origins. CORS is a browser restriction, not client authentication or abuse prevention.
- No upstream credentials are needed. Cloudflare OAuth credentials stay in Wrangler's local configuration, outside source control and the Workshop bundle.

Upstream responses are capped at 100 KiB and a request times out after 15 seconds. Admission limits are global, not per-client authentication. An Internet client can consume the shared request allowance; use Cloudflare account-level traffic controls if the service is distributed widely.

Successful responses include `X-Horizons-Cache: MISS`, `HIT` or `STALE`, `X-Horizons-Retrieved-At`, `X-Horizons-Source` and `Age`. Stale responses include `Warning: 110`; cooldown errors use `Retry-After`. These are transport/cache diagnostics, not a claim of scientifically validated wallpaper integration.

## Setup and deployment

Run the commands from the independent Worker package, not the wallpaper package:

```powershell
Set-Location D:\code\AnAnCelestialWallpaper\workers\horizons
npm ci
npm run login
npm run whoami
npm run typecheck
npm test
npm run build
npm run deploy
```

Before deploying, inspect `wrangler.jsonc`:

- `UPSTREAM_USER_AGENT`: product/version plus a public maintainer contact URL, currently the repository URL. Keep the contact accurate.
- `ALLOWED_ORIGINS`: comma-separated exact origins; defaults are `null`, `http://127.0.0.1:5173`, `http://localhost:5173`, `http://127.0.0.1:4173` and `http://localhost:4173`. `null` supports opaque local-file origins and cannot identify a particular wallpaper. Remove it if unused; add any approved HTTPS origin explicitly. Requests without an Origin header are allowed for API tools.
- `HORIZONS_GATE`: the Durable Object binding and `v1` SQLite class migration are required. Keep one named coordination object per deployment; deploying additional independent copies does not share the upstream concurrency budget.

`npm run build` is a Wrangler deployment dry-run, with output in ignored `build/`; it does not publish. `npm run dev` runs the Worker locally at Wrangler's reported address. `npm run deploy` publishes the Worker and applies its Durable Object migration. Never put Cloudflare tokens in `src/`, public files or `VITE_` variables.

Use the verified primary hostname below, or the `workers.dev` fallback above. The second identical vector request should be a cache hit:

```powershell
$workerBase = 'https://horizons.ananwanan.cc'
curl.exe -i "${workerBase}/health"
$earthQuery = '/api/horizons.api?COMMAND=399&START_TIME=2026-10-19&STOP_TIME=2026-10-20&STEP_SIZE=1%20h'
curl.exe -i "${workerBase}${earthQuery}"
curl.exe -i "${workerBase}${earthQuery}"
```

The sequential live smoke check covers raw/normalized output, cache reuse and rejection cases. A genuinely cold normalized check can require nine serialized source requests:

```powershell
node scripts/check-horizons-proxy.mjs https://horizons.ananwanan.cc
```

Run this command from the repository root. A failed upstream response stops the check; respect its `Retry-After` before another attempt.

For CORS inspection, add `-H 'Origin: null'` or a configured localhost Origin. An unlisted browser Origin must receive no access grant; the health request itself is not evidence that upstream access works.

The wallpaper's own verification remains `npm run typecheck`, `npm test` and `npm run build` from the repository root. Automatic GitHub Actions CI remains paused.

## Official references

Reviewed 2026-10-19:

- [JPL Horizons API parameters, JSON envelope and HTTP errors](https://ssd-api.jpl.nasa.gov/doc/horizons.html)
- [JPL SSD API fair-use policy](https://ssd-api.jpl.nasa.gov/doc/): necessary requests only, cached reuse, one upstream request at a time, error backoff, identifying User-Agent and NASA CORS restrictions.
- [Cloudflare Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/)
- [Cloudflare Durable Object coordination rules](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)

Upstream terms still apply to server-side retrieval. The proxy does not promise permanent NASA availability, remove source version checks, or grant additional data-use rights.
