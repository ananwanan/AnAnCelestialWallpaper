# Architecture

## Implemented flow

```text
Host partial properties / browser controls
            |
     validated Settings ---- UTC SimulationClock
            |                       |
     throttled RenderLoop      Astronomy Engine (offline)
            |                       |
            +---------- immutable SolarSnapshot (EQJ, Sun, AU)
                                    |
                      SolarScene / calibrated Earth focus
                       meshes, paths, labels, cameras

Real UTC ---- EphemerisSync ---- Cloudflare /api/ephemeris
                  |              singleton HorizonsGate
          versioned browser       serial + cached JPL requests
          cache / backoff                  |
                  +--- normalized ICRF comparison snapshot
                         same-epoch local comparison / HUD
```

Remote state never replaces rendered local planetary ephemerides. A separate opt-in flow obtains scoped CelesTrak OMM through `/api/satellites`, validates/caches it in `SatelliteSync`, and propagates locally with `satellite.js` at explicit simulation epochs. `SatellitePresentation` bounds position/arc sampling; `SatelliteLayer` receives only immutable Earth-centered EQJ/km snapshots and trajectories. Disabled means no GP request, propagation or satellite draw calls. The shared Worker has a separate singleton `SatellitesGate`, with two bounded dataset keys and persisted source-policy controls; see [SATELLITES.md](SATELLITES.md).

## Boundaries and coordinates

- `astronomy/planetEphemeris.ts` evaluates planets in Sun-centered EQJ/J2000 AU and Moon in Earth-centered EQJ AU, sharing one explicit UTC epoch. `createSolarSnapshot` produces immutable state; `sampleSolarTrajectories` uses the same ephemeris for paths.
- `app` owns clocks, lifecycle, provider composition and scheduling. It gives `SolarScene.render(solar, earth)` normalized immutable data sharing one epoch; the renderer neither fetches nor evaluates ephemerides. Satellite state and selected arcs use separate setters.
- `render` transforms EQJ `(x,y,z)` into Three.js `(x,z,-y)`. Its artistic radial distance is `26 × ln(1 + distanceAU)`, preserving direction/inclination. Per-body display radii and minimum visible pixels are independent of retained physical radii. The Moon offset is additionally exaggerated 70× and added to Earth's display position exactly once.
- Earth focus uses `earthFocusKmToScene = 3/6371` for Earth, Moon, sampled lunar paths and satellites. No solar logarithmic compression or 70× lunar exaggeration enters this group. Earth and Moon sphere sizes share the same km scale; the Earth–Moon preset fits the physical lunar distance.
- `astronomy/earthOrientation.ts` uses GAST and EQD→EQJ precession/nutation for a calibrated Earth-fixed basis. Actual SphereGeometry UV tests anchor north/Greenwich/east without mirroring. Its offline model approximates UT1≈UTC and omits polar motion; other planet poles, Saturn ring tilt and lunar surface attitude remain illustrative. See [calibration/reference tests](EARTH_ORIENTATION.md).

`SolarSnapshot` contains `epoch`, `referenceFrame: EQJ/J2000`, `origin: Sun`, `units: AU`, eight `planets` vectors and `moonGeocentricAU`. `SolarTrajectories` adds per-body time windows and sampled vectors; its Moon series explicitly remains geocentric. `EarthViewSnapshot` contains a calibrated basis, geocentric Moon km position and Sun direction at that same epoch. Satellite raw TEME/km is converted through pseudo Earth-fixed coordinates into geocentric EQJ/km before rendering; it is never added to heliocentric AU.

## Clocks, render loop and lifetime

`SimulationClock` evaluates `sim = epochSim + (realUTC - epochReal) × timeScale`. Speed changes re-anchor without jumping; UTC jumps and reset are explicit. Setting speed to zero freezes simulation time. Host pause/document visibility instead stop frame scheduling without changing the clock anchor, so resume uses the elapsed wall time.

The Wallpaper Engine listener registers before DOM/WebGL/texture initialization. The bridge validates only known properties, merges partial updates and handles general FPS plus pause separately. Its 13 user properties include camera presets, NORAD selection and UTC jumps. `applyClockSettings` applies date/rate changes at one wall-clock anchor; clearing a UTC jump preserves the chosen rate, including zero. Browser controls use the same validation path. The last positive time rate is tracked centrally, so zero-rate pause restores the selected rate rather than an unrelated default.

`showDesktopSettings=false` hides interactive navigation, settings and simulation-pause controls in local imports before the first host callback; it also closes the drawer, removes hidden UI label exclusions and disables shortcuts. Read-only UTC/provenance remains visible. HTTP(S) development retains the fallback until the host takes over. `DesktopSelectControls` presents the optional drawer's choices as HTML buttons/listboxes. Hidden native selects remain the existing value/options/change model; explicit refresh handles programmatic host values and a mutation observer handles option/disabled changes. Keyboard navigation skips disabled entries, focus/outside clicks close lists, drawer hiding closes all lists and option keys do not reach wallpaper shortcuts. This is a compatibility response to a reproduced native crash involving visible product selects; plain select controls worked, so an internal CEF cause is not established. The final listboxes passed browser checks and native opening/High selection.

`scripts/wallpaper-properties.json` defines the actual editor controls. `update-wallpaper-project.mjs` extends an existing editor-created `project.json`, backs up metadata/overwritten files and copies the fresh static build without deleting old resources. `relocate-wallpaper-project.mjs` separately repairs an existing project's directory identity: it accepts only a new ASCII sibling under the same `myprojects`, rejects links/junctions and configuration-key collisions, and verifies a complete project/config backup before renaming. It replaces complete old-directory prefixes in JSON string tokens, checks the resulting semantics, preserves unrelated text/user choices and rolls back the directory/config after a failed write. The real project was relocated to `myprojects/anan-celestial-wallpaper` after logs proved the former em-dash path was misencoded. The host/editor must be stopped for migration and saved references rechecked after restart because another controller process can rewrite an older in-memory configuration.

`RenderLoop` enforces host FPS (default 30), cancels scheduling when suspended and resumes without a rendered-frame clock. Labels update at a lower cadence. Paths refresh after a large simulation-date change or explicit jump/quality change rather than being rebuilt every frame.

`PeriodicTask` schedules comparison checks without a polling timer while host/document suspension is active. Resume triggers an immediate eligibility check; repeated pause/resume events during a pending operation coalesce into one later check, never concurrent requests. Orbit refresh timers are also cleared on suspension. Native desktop inspection observed `hostConnected=true`, the host's 15 FPS setting and paused/resumed callbacks; a resumed 73.506-second interval advanced 1,051 frames, approximately 14.3 FPS. This verifies the measured host path; native offline behavior, desktop icons, fullscreen rules and long-duration resource behavior remain separate acceptance gates.

Quality uses capped DPR 1/1.5/2, shared solar spheres at 24/40/64 segments and 600/1500/2600 stars. Earth-focus sphere detail is independently budgeted. Low quality hides the corona. Sun glow uses a small original radial texture and cheap shell rather than full-screen bloom passes. Camera presets and zoom bounds adapt to aspect ratio; travel temporarily permits the whole path before restoring focus bounds, avoiding an OrbitControls snap. Loaded texture sampler changes mark textures for GPU update. UI rectangles are excluded from label placement. Earth focus and the satellite inspector visibly state frame/units, source epochs and approximation limits.

Satellite Points use preallocated buffers, 32/64/128 render capacities and a bounded 2/40 source subset. SGP4 positions refresh at a bounded wall cadence or when simulation drift requires it; identical frozen epochs skip work. Selected past/future arcs resample at a separate two-second wall cadence, disappear when obsolete at high rates, and fail independently of rendering. Turning the layer off aborts source work and drops CPU/GPU snapshot references and draw ranges. Host suspension aborts pending GP work and removes polling timers while preserving cache reservations.

`pagehide` aborts UI listeners, disconnects the desktop-listbox observers, clears timers, disposes sync/render loops, restores the prior host listener and disposes scene geometry, materials and textures. Replacing paths/quality resources releases their previous GPU allocations.

## Implemented remote contract

`GET https://horizons.ananwanan.cc/api/ephemeris?at=<UTC ISO>` returns the shared `astronomy/ephemerisSnapshot.ts` schema:

| Field | Meaning |
|---|---|
| `schemaVersion`, `source`, `apiVersion` | `1`, `JPL-Horizons`, observed upstream payload `1.2` |
| `epoch`, `retrievedAt` | Requested comparison epoch; oldest retrieval across the complete source set |
| `validFrom`, `validUntil` | Bracketing one-day source window, not permission to extrapolate a returned state |
| `referenceFrame`, `origin`, `units` | `ICRF`, `Sun`, `AU, AU/day` |
| `quality`, `interpolation` | `comparison`, `cubic-hermite-hourly` |
| `states` | All eight named planets plus `Moon`, one shared epoch, finite position and velocity |

The Worker obtains 25 hourly position/velocity samples per body over a UTC day and uses bounded cubic Hermite interpolation at the requested epoch. It validates identity, origin, frame, units, time headings, row epochs and sample spacing. It never linearly extrapolates a stale single vector.

The client sends one logical request at startup when configured, using **real UTC**, then schedules 1/6/24-hour comparisons. A cold batch can take tens of seconds; the request timeout is 90 seconds and local visuals are independent. Cache envelopes are versioned and endpoint-scoped. Corrupt/incompatible/older-than-24-hour entries are rejected; six-hour freshness and 24-hour usability are distinct. Failure keeps a usable last-good comparison with capped exponential backoff, jitter and `Retry-After` handling. There is no credential in the client.

A stale HTTP-200 fallback remains cached comparison data and honors the source cooldown; it does not reset the normal success cadence. Source-age/state getters expire data even before the next timer tick after a long pause. Offline state is reflected immediately, and cleanup cancellation is not awaited in error paths, preventing a stuck body cancellation from delaying fallback/teardown.

`/api/horizons.api` remains a separate constrained raw-output route. `/api/satellites?group=stations|gps` is a separately gated GP route. `/api/satellites/status` reports persistent allowances and bounded attempt diagnostics without contacting the source or mutating its gate; the wallpaper does not poll it. Diagnostics distinguish transport, timeout, upstream HTTP, validation and storage failures. Deployment and real upstream validation are recorded in [satellite policy](SATELLITES.md). See [Horizons service policy](HORIZONS_PROXY.md).

## Comparison limits

The comparison explicitly retains remote ICRF versus local EQJ labels. Its heliocentric sanity tolerance is one arcminute times Sun distance plus `1e-5 AU`; it does not implement a precision ICRF↔EQJ transformation. A captured, provenance-recorded JPL fixture checks all nine bodies and a separate Moon-minus-Earth case. See [data source limits](DATA_SOURCES.md) and [validation](VALIDATION.md).

Production assets use Vite `base: './'`, include all local textures, and carry attribution. The optional Worker is separately deployed, not bundled into the wallpaper. Editor import, independent playback, desktop rendering, tested host properties, the native 15 FPS cap and pause/resume have evidence. Native offline operation, the complete property/display/quality matrix, desktop-icon/fullscreen behavior and the two-hour soak remain open. Final saved path/preferences are tracked separately from temporary measurement settings in [validation](VALIDATION.md). A browser success is not host evidence.
