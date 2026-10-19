# Data sources, frames and limits

## Local ephemeris

[Astronomy Engine](https://github.com/cosinekitty/astronomy) is the offline model used for every displayed simulation epoch. Planet vectors are Sun-centered EQJ/J2000 in AU. `GeoMoon` is Earth-centered EQJ/AU and is added to Earth exactly once when a heliocentric Moon vector is needed. Orbits are sampled from these same functions; arbitrary decorative angular increments never drive orbital positions.

The visual model separately transforms axes to Y-up, compresses solar distance as `26 × ln(1 + distanceAU)`, exaggerates radii and expands Moon offsets 70× in the Solar view. Earth focus uses a uniform km scale for Earth, Moon and artificial satellites. Earth's local attitude/UV calibration is tested with explicit UT1≈UTC/no-polar-motion limits; other body poles/lunar surface attitude remain illustrative. Do not use Solar rendered sizes/distances as measurements. See [Earth calibration](EARTH_ORIENTATION.md).

## Deployed JPL Horizons comparison

The [Cloudflare service](HORIZONS_PROXY.md) at `https://horizons.ananwanan.cc` now implements both raw `/api/horizons.api` and normalized `/api/ephemeris?at=<UTC ISO>`. `.env.production` configures the public **base URL**, without credentials.

The browser makes one logical current-real-UTC startup comparison, then requests at 1/6/24-hour wall-clock intervals. The animation continues from local ephemerides immediately and during failure/offline operation. Time warping the scene does not change the requested remote epoch or request frequency.

The adapter requests eight explicit planet centers plus Moon, using `VECTORS`, Sun center `500@10`, `REF_SYSTEM=ICRF`, `REF_PLANE=FRAME`, `OUT_UNITS=AU-D`, `VEC_CORR=NONE`, `TIME_TYPE=UT`, Gregorian dates and position/velocity CSV. Current payloads identify API version `1.2`, although the documentation heading is `1.3`; unexpected returned versions fail closed.

Horizons `format=json` wraps **text** in `result`. The parser checks source/version, body identity, center, units, frame, geometric output, UT dates/Julian dates and exactly 25 hourly rows over one UTC day. Cubic Hermite interpolation uses adjacent position/velocity samples with at most one-hour spacing and never extrapolates. Normalized output retains `referenceFrame: ICRF` and `quality: comparison`.

The singleton Durable Object serializes source access, coalesces equivalent work, caches raw data and enforces a global request budget. A normalized cold load is nine serial body requests, not nine concurrent NASA requests per wallpaper. Browser cache envelopes are versioned and endpoint-scoped, fresh for six hours and usable for at most 24 hours from source retrieval; failures back off with jitter and respect `Retry-After`. See [exact limits](HORIZONS_PROXY.md).

### Recorded reference and interpretation

[`tests/fixtures/jpl-snapshot-2026-10-19.json`](../tests/fixtures/jpl-snapshot-2026-10-19.json) is a captured deployed response, with adjacent source provenance. All nine states have epoch `2026-10-19T00:00:00.000Z`; capture time is `2026-10-19T14:08:28.873Z` and oldest source retrieval is `2026-10-19T12:59:30.900Z`. These are distinct timestamps. The exact hourly epoch uses original samples rather than interpolation.

Golden tests compare local EQJ positions with those remote Sun-centered ICRF vectors using **one arcminute × heliocentric distance + `1e-5 AU`**. The Moon-minus-Earth test separately uses one arcminute × lunar distance + `1e-7 AU`. The captured run passed: worst heliocentric residual was Neptune at about `0.00224397 AU`; geocentric Moon residual was about `12.39 km`. These are model/frame sanity tolerances, not a precision frame transformation, observational tracking or navigation certification. A single recorded epoch does not validate the entire supported date range.

Remote results are comparison-only. `Live/Sync` describes successful source acquisition; `Cached` identifies cache reuse; the displayed trajectory remains local prediction. A stale returned point is never used to advance planetary motion for a day.

### Official provider references

Reviewed 2026-10-19: [Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html), [Horizons reference frames](https://ssd.jpl.nasa.gov/horizons/manual.html#frames), [SSD fair-use policy](https://ssd-api.jpl.nasa.gov/doc/).

SSD requires necessary requests, cached reuse, serialized source access, error backoff and an application/version/contact User-Agent. NASA's CORS restriction prevents direct website embedding; the Worker retrieves server-side with its own restricted origin policy. Upstream terms and availability still apply.

## Artificial satellites: opt-in M4

The implemented route accepts only `stations` (`STATIONS`, filtered to ISS25544/Tiangong48274 when present) or `gps` (`GPS-OPS`, at most40 matching records). It uses CelesTrak `FORMAT=JSON` OMM and `satellite.js`7.1.0 local SGP4. The current catalog decides availability; no missing station is fabricated. Every position and arc is evaluated at its stated simulation UTC, not read directly from a static source epoch.

Source records retain NORAD identity/UTC epoch/age, reject invalid numbers/frames/models, warn as elements age, and refuse out-of-window/implausible propagation. TEME/km→pseudo Earth-fixed→geocentric EQJ/km uses tested Vallado-style sidereal rotation and the Earth orientation service. UT1≈UTC and polar motion omission remain visible approximations; no precise tracking label is enabled. See [parser, source policy, stale limits and reference fixtures](SATELLITES.md).

Both client and globally shared Worker persist **at least two hours between refreshes of the same dataset**, including failures, reloads and toggles. The one-hour planetary choice cannot bypass it. CelesTrak's current policy requires stopping source queries after a non200 response; the Worker persists a global blocked state requiring owner investigation. Network errors instead use bounded cooldown/backoff/Retry-After. Disabling satellites stops requests and propagation/render work; a shared source service is configured only after actual deployment.

Reviewed official references: [CelesTrak GP formats](https://celestrak.org/NORAD/documentation/gp-data-formats.php), [usage policy](https://celestrak.org/usage-policy.php), [satellite.js](https://github.com/shashwatak/satellite-js).

## Asset and security policy

All eleven bundled texture images are credited to Solar System Scope / INOVE under CC BY 4.0. The creator's maps use edited colors and fictional fill for unmapped regions. [Per-file attribution and hashes](../public/textures/ATTRIBUTION.md) distinguish the primary license source from the pinned retrieval mirror. The starfield, Sun gradient and corona code are original. All images/scripts/styles are local at runtime; no CDN is required.

Vite `VITE_` variables are public. Only the public provider URL belongs there; Cloudflare OAuth and tokens remain outside the bundle. Upstreams and query types are allowlisted, responses are bounded and malformed data never becomes a successful cache entry.
