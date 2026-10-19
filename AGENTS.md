# AGENTS.md — AnAnCelestialWallpaper

> This file is the authoritative execution brief for coding agents working in this repository. Read it before changing code. The product is a **Wallpaper Engine Web Wallpaper**, not a standalone Electron application or a generic astronomy website.

**Implementation status (2026-10-20):** M0–M3 are implemented; M4 opt-in OMM/SGP4, frame conversion, bounded rendering and shared GP cache are implemented. The GP route is deployed, but first live source operations failed with503 and persisted cooldowns; current catalog acquisition remains unverified. Earth uses a calibrated offline attitude model, approximating UT1 with UTC and omitting polar motion; satellite positions remain labeled approximate predictions. Native acceptance remains partial after confirmed normal restarts and Steam file verification: production/plain HTML previews failed and the Web helper misread IPC arguments as Chromium URLs. Do not claim native editor import, properties, FPS/pause or offline validation. See `docs/VALIDATION.md`, `docs/EARTH_ORIENTATION.md`, `docs/SATELLITES.md` and `docs/ROADMAP.md`.

## 0. Mission and guardrails

Build a polished, low-overhead, offline-capable **3D solar-system and Earth-orbit wallpaper** for Wallpaper Engine. The core is **TypeScript + Three.js + WebGL** (Vite for development/build). The visual experience must include a glowing Sun, textured spherical planets, orbital paths, real depth, rotating/zoomable camera, and an optional Earth-focused view showing actual tracked artificial satellites.

* **Truthful astronomy:** All astronomical state calculations use an explicit time, origin, reference frame and unit. Distinguish physical positions from artistic scaling; never call a fabricated orbit or decorative motion “live accurate tracking”.
* **Wallpaper-first:** The product renders silently in the background, respects the host's FPS/pause settings, avoids high CPU/GPU use, and works offline. Never require a constantly running backend for core visuals.
* **Remote data is sparse:** At startup request a current ephemeris snapshot when a configured provider is available; recompute positions **locally** against simulation time during animation. Resync at configurable **1/6/24-hour** intervals. Satellite GP/OMM records must obey **at least 2 hours between refreshes per dataset** regardless of a 1-hour selection.
* **Satellites are opt-in:** `showSatellites` defaults to `false`. Disabling it stops network fetches, background propagation and satellite draw calls; it does not affect the solar-system view.
* **No secrets in the client:** No API keys, user tokens or writeable credentials in `src/`, public assets, Vite environment variables prefixed `VITE_`, or the Workshop bundle.
* **No deceptive success:** Add visible but non-blocking data provenance labels: `Live/Sync`, `Local prediction`, `Cached`, `Demo`; distinguish requested API corrections from computed local trajectories. Never imply an API exists if not deployed.
* **No unlicensed images:** Bundle only original, explicitly redistributable, or correctly licensed artwork. Track source URL, author and license for each texture in `public/textures/ATTRIBUTION.md`.

## 1. Product scope

### 1.1 Solar System view — mandatory

- Sun, Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune as real 3D meshes.
- Texture/material-based spherical surfaces, physically motivated sun lighting, emissive/glowing Sun, subtle stars; Saturn rings when assets permit.
- Heliocentric orbital trajectories with orbital inclination and depth (no flat invented 2D concentric circles).
- Camera drag/orbit, zoom and reset; cinematic camera presets; independent mouse-interaction toggle.
- Solar-system position corresponding to the displayed simulation time, built from a tested local ephemeris; optional remote JPL Horizons synchronization.
- Show/hide labels and orbit trails; pause, speed controls and jump-to-current-time.
- Earth/Moon as minimum natural-satellite support; later major Galilean moons and selected Saturnian moons using independent ephemerides. Do not fake moon orbits with arbitrary uniform circular motion while claiming precision.

### 1.2 Earth & satellites view — mandatory

- Transition from Solar System view to Earth focus without applying the same artistically compressed planetary scales to LEO/MEO/GEO satellites.
- Detailed rotating textured Earth with optional clouds/night lights; Earth limb atmosphere as quality-permitting effect.
- Satellite groups: `STATIONS`/ISS, Chinese space station if present in the catalog, GPS; Starlink is **optional and performance-gated**.
- User can toggle all artificial satellites, choose groups, select a satellite, display its name/NORAD ID/epoch/altitude, and show recent/future trajectory arcs clearly marked as predicted.
- CelesTrak JSON OMM → `satellite.js`/SGP4 local orbit propagation; input epoch freshness and invalid/stale data checks.
- No fake real-time location from a static TLE/OMM rendered without propagating to `simulationTime`.
- Do not draw many thousands of mesh satellites individually. Use filtering, bounded subset and `THREE.InstancedMesh` or points, adaptive refresh, LOD and explicit quality presets.

### 1.3 Non-goals until later milestones

- Orbital mechanics research accuracy, n-body integration, launch/reentry forecasts, user-submitted orbital elements, paid data feeds, VR, native executable, continuously networked game logic, rendering all catalogued debris.

## 2. Chosen stack

| Domain | Choice | Rationale |
|---|---|---|
| Runtime | Wallpaper Engine **Web** wallpaper | Supported HTML/JS host; ship fully local build output |
| Language | TypeScript strict mode | Typed ephemeris, data contracts, configuration |
| Build | Vite ESM; `base: './'` | Relative asset paths for local Wallpaper Engine imports |
| Graphics | Three.js / WebGL2 | 3D mesh, depth, post effects, OrbitControls |
| Local planets | `astronomy-engine` | Local heliocentric EQJ/J2000 positions, offline operation |
| Planets sync | NASA/JPL Horizons VECTORS via optional caching adapter | Accuracy comparison and time-window snapshot/trajectory samples |
| Artificial satellites | CelesTrak GP `FORMAT=JSON` (OMM) | Modern catalog-number support and source epoch |
| Local SGP4 | `satellite.js` | Standard model of earth satellite GP/OMM records |
| Tests | Vitest + typecheck | No WebGL needed for math/provider tests |
| Optional shared backend | Cloudflare Worker | Cache/rate-limit/CORS normalization, NOT an arbitrary public proxy |

**Do not add React, Electron, Rust, C++, WebGPU, a database, or a cloud backend without a justified ADR and product need.** Default should remain small and deployable as a static web wallpaper.

## 3. Architecture / dependency rules

```text
index.html
src/
  app/                 # boot, lifecycle and dependency composition
  astronomy/           # units, frames, planetary ephemeris and trajectory evaluation
  satellites/          # CelesTrak OMM, SGP4, freshness and grouping
  sync/                # snapshot adapters, cache, scheduling, backoff
  render/              # Three.js scene, cameras, meshes, lights, LOD and post-FX
  settings/            # Wallpaper Engine property bridge, defaults and UI
public/textures/       # local assets + per-file attribution
workers/horizons/      # optional constrained raw + normalized Horizons adapter; separately deployed
scripts/                # publishing/packaging helpers
docs/                   # architecture, roadmap, provider policies, Wallpaper Engine workflow
tests/                  # deterministic ephemeris/SGP4/property tests
```

Allowed direction: `app` composes `render`, `astronomy`, `satellites`, `sync`, `settings`. `render` consumes normalized immutable position snapshots and must not fetch URLs or parse raw API responses. `astronomy` must not depend on Three.js/WebGL. `sync` must not depend on renderer. `settings` must own settings validation and host bridge only.

Provider interfaces return **normalized data** with `source`, `retrievedAt`, `validFrom`, `validUntil`, `epoch`, `referenceFrame`, `origin`, `units`, and `quality`. Persist cache with schema version; reject incompatible or corrupt cache. Keep the last known good value on network failure, with TTL, capped exponential backoff, jitter, and no retry loops.

The optional `workers/horizons` backend implements both raw `/api/horizons.api` and normalized nine-body `/api/ephemeris?at=<UTC ISO>`. Production `.env.production` configures the public service base `https://horizons.ananwanan.cc`; never configure the raw route as that base. The adapter preserves remote ICRF and `quality: comparison`, while local EQJ snapshots drive rendering. Its ADR, deployed version, parser and cache policy are in `docs/HORIZONS_PROXY.md`.

Solar display scales are artistic: radial distance `26 * ln(1 + distanceAU)`, independent exaggerated sphere radii/minimum visible pixels and a 70x geocentric Moon offset. Paths use the same transform. Earth focus instead shares `3/6371` scene units per km among Earth, Moon and satellites, without Solar compression. Earth's pole/spin/texture mapping use GAST plus EQD→EQJ precession/nutation in both views; other body poles and lunar surface orientation remain illustrative.

## 4. Time, units and coordinate frames — critical

- Use UTC timestamps (ISO 8601 with `Z`) in data and persistent state. Simulation time: `sim(t) = epochSim + (realWallClock(t)-epochReal)*timeScale`. On speed change re-anchor rather than jump. Reset to real UTC instantly on command.
- Never use rendered-frame delta accumulation as the long-term wall clock; resume from minimized/paused state without time drift.
- Astronomical positions: choose **Sun-centered EQJ / J2000 equatorial axes**, positions in **AU** at the astronomy layer, then transform into the renderer's Y-up axes. JPL queries must specify a compatible reference system, reference plane, center (`500@10`), units and geometric correction (`VEC_CORR=NONE`).
- Astronomy Engine `HelioVector` returns heliocentric EQJ positions in AU. Local Earth/Moon shall share the same epoch/frame as other bodies.
- Satellite SGP4 positions are Earth-centered **TEME** (km), **not ICRF/EQJ**. Do **not** silently add TEME coordinates to heliocentric J2000 vectors. A frame conversion service must handle TEME→Earth-fixed/inertial orientation and Earth transform; tests against verified reference cases are mandatory before enabling a scientifically accurate label. Until then mark satellites as an **approximate visualization** if an approximation is used.
- Preserve scientific radii and distances separately from display scales: do not claim rendered sphere diameters or orbital spacing are to scale. Implement separate `solarScale`, `planetRadiusExaggeration`, `earthFocusKmToScene`.
- OMM orbital propagation accuracy degrades as orbital elements become stale, especially LEO; display source epoch, age, and stale warnings; refuse implausible/out-of-range propagations.
- Planetary positions vary continuously: do **not** linearly extrapolate a single velocity vector for 24 hours. Prefer local ephemeris evaluation per requested date; a provider that returns state samples can use tested interpolation (e.g. cubic Hermite with position+velocity and bounded spacing). Never “update” trajectories by arbitrary angular increments.

## 5. Network policy and synchronization

### 5.1 Planetary ephemeris

- V1 must render immediately using local `astronomy-engine` for the current time, without waiting for network.
- After boot, **attempt one logical sync operation** for a current-time ephemeris snapshot when `VITE_EPHEMERIS_BASE_URL` is configured. Avoid N direct Horizons calls per user if distribution scales; shared cached Worker is preferred for Workshop publication.
- Configure astronomical snapshot refresh `1h` / `6h` / `24h` (default `6h`). On a missing endpoint, offline state or failure, continue local calculation; do not display invented external synchronization status.
- JPL Horizons `format=json` wraps a **text** ephemeris in the JSON `result` field; parse the `$$SOE...$$EOE` region with strict validation and explicit frame/unit metadata. Invalid/ambiguous formats fail closed.
- A snapshot without a propagation/interpolation method may serve as a comparison/verification only. Do not substitute a stale single-point state for per-frame trajectories.

### 5.2 Artificial satellite GP

- Query CelesTrak GP with `FORMAT=JSON`, prefer `GROUP=STATIONS`, `GROUP=GPS-OPS` (validate group against current docs), or individual `CATNR`; do not default to bulk `ACTIVE`/`STARLINK` downloads.
- **Minimum 2 hours between source refreshes** for the same GP dataset regardless of user-selected 1h planetary sync. Respect server limits, 403/429 responses, provider usage notices and `Retry-After` when present; use a shared public cache service in production.
- `showSatellites=false` means **zero** CelesTrak requests. Enable lazily and load a narrowly scoped group. Allow an immediate first fetch when first enabled, then schedule no faster than provider policy.
- When data is old, explain that positions are predicted and may have degraded accuracy. Allow offline use of previously cached data within defined freshness policy.
- An optional Cloudflare Worker must implement allowlisted upstreams, request limits, cache keys, cache TTL, timeouts, request-size controls, CORS policy and no open redirect/proxy endpoints; never embed private provider keys in the wallpaper.

## 6. Performance and Wallpaper Engine integration

- Respect Wallpaper Engine `wallpaperPropertyListener.applyUserProperties`, `applyGeneralProperties` (`fps`) and `setPaused`. Register listener **before expensive initialization** to avoid missing initial settings. No unconditional `60fps` loop.
- Use `requestAnimationFrame` with host FPS throttling; idle/pause safely. Recommend default ≤30 FPS (actual host setting takes precedence), quality modes Low/Medium/High.
- `renderer.setPixelRatio(min(devicePixelRatio, qualityCap))`, frustum culling, geometry sharing, texture mipmaps, texture compression where supported, disposal of Three resources, draw-call budget, bounded buffers, adaptive starfield.
- Batch satellite rendering with InstancedMesh/Points; avoid allocating vectors/meshes or recalculating expensive ephemerides unnecessarily in hot paths. Separate astronomy update cadence from smooth interpolation/render cadence where appropriate; render data must correspond to current simulation time.
- Camera zoom should never clip a focused Earth or Sun; on focus switch update `near/far`, controls target and camera damping safely.
- Bundle scripts, fonts and textures in the built wallpaper; no CDN dependencies. Test `dist/index.html` through Wallpaper Engine (a `file://` browser preview may have different CORS/ESM behavior).
- Wallpaper Engine `project.json` is generated/managed by its editor; do not pretend a handwritten dummy `project.json` is a publishable project. Document required property keys and configure them in editor.
- Test 16:9, 21:9, 32:9, 1080p, 1440p, 4K; ensure labels and controls do not interfere with desktop icons or obstruct full-screen work.

## 7. Settings contract

Keys for Wallpaper Engine editor (must match exact names in the host project settings):

| Key | Type | Default | Behavior |
|---|---|---|---|
| `viewMode` | combo | `solar` | `solar` / `earth` |
| `showSatellites` | bool | `false` | Lazy-load/toggle satellite layer |
| `satelliteGroup` | combo | `stations` | `stations`, `gps`, later `starlink` |
| `syncInterval` | combo | `6` | Planet sync `1`, `6`, `24` hours |
| `timeScale` | slider | `1` | Simulation speed, e.g. `0` to `86400` |
| `showOrbits` | bool | `true` | Planet and satellite orbit lines |
| `showLabels` | bool | `true` | Names + data labels |
| `enableMouse` | bool | `true` | Camera drag and wheel |
| `quality` | combo | `medium` | `low`, `medium`, `high` |

The host sends **partial property change objects**; never reset other settings on an unrelated property change. Keep a keyboard/UI fallback in normal browser for development.

## 8. Asset and visual design

- Deep black/navy starfield, minimal HUD, calm slow motion, warm sun glow, restrained bloom; visual hierarchy must remain clear behind desktop icons.
- Local procedural textures are allowed as V0 placeholders but **must be labeled illustrative**; real Earth day/night and high-resolution planet maps require documented, redistributable sources.
- Earth clouds should rotate at appropriate rate and should not imply geospatial precision from placeholder texture art.
- Astronomical orbit paths should be sampled from the **same ephemeris implementation** used for the body's instantaneous position; line trajectories must share reference frame and expected time window.
- Render pixel/depth values rather than physically accurate planet radii when artistic mode enabled; allow a transparent explanation `Distances/diameters visually exaggerated` in documentation.

## 9. Quality bar and testing

> **Temporary CI pause (2026-10-19):** Automatic GitHub Actions CI has been intentionally disabled by removing `.github/workflows/ci.yml`. The previous workflow is archived at `docs/ci-workflow.yml.disabled` for later restoration; it must not be re-enabled without explicit repository-owner authorization. See `docs/CI.md`. During the pause, run `npm run typecheck`, `npm test` and `npm run build` locally before marking work verified, and report checks as unverified when they cannot be run.

### Automated

- `npm run typecheck`, `npm run test`, `npm run build` pass on clean install.
- Unit tests for: simulation clock re-anchoring and resume, position continuity, Sun-centered vs Earth-centered conversions, moon parent origin, UTC round-trip, OMM parser rejection, stale epoch policy, provider refresh cadence (including 1h selection capped to 2h for CelesTrak), cancellation when satellites are disabled, property partial update semantics.
- Known-epoch golden checks against authoritative JPL/Satellite.js reference vectors with documented tolerance.
- No secret keys, surprise upstream calls or external runtime JS/CSS/textures in production output.

### Manual / acceptance

1. Fresh browser load shows Sun, eight planets, inclined 3D orbits and orbitable camera **without network**.
2. Switching to Earth focus presents a sphere and scale-appropriate environment; returning to Solar view does not leak objects.
3. With artificial satellites disabled, network inspection shows no CelesTrak request and no satellite-render work.
4. When enabled, known satellite shows its real OMM epoch and predicted 3D orbit; controls show source and staleness.
5. Changing planetary sync interval leaves satellite minimum 2h refresh intact.
6. With blocked network, scene keeps running and visibly reports offline/cached mode.
7. Pause/focus loss respects Wallpaper Engine; reopening updates positions to current simulated time.
8. Runs for 2 hours without runaway memory/CPU, at host FPS cap and all quality levels.
9. `dist/` imports into Wallpaper Engine as Web wallpaper; custom properties work; standalone Workshop bundle has no node_modules/remote CDN dependency.

## 10. Development roadmap — commit-sized milestones

- **M0 Bootstrap — implemented, native acceptance partial:** Vite/WebGL scene, local ephemeris, deterministic clock and early host bridge. Browser success does not close the native import/FPS/pause gate.
- **M1 Solar visual polish — implemented:** local licensed textures, Sun glow/corona, sampled inclined paths, Moon, Saturn ring, collision-aware labels, smooth presets and quality budgets. Browser evidence is separate from native/long-duration performance.
- **M2 Correct time & ephemerides — implemented:** UTC timeline/rate/jump/reset/pause, normalized Horizons adapter, bounded hourly Hermite comparison, current real-UTC startup operation, 1/6/24h scheduling, browser cache/backoff/fallback and captured-reference tests. Remote state is a comparison, not the rendered trajectory.
- **M3 Earth focus — implemented:** calibrated offline attitude and texture mapping, independent km scale, physical Earth/Moon placement/orbit, safe close-up and Earth–Moon camera; no optional cloud/night maps added.
- **M4 Satellite tracking — implemented; acceptance tracked separately:** opt-in targeted CelesTrak OMM, local SGP4, tested TEME→PEF→EQJ approximation, ISS/Tiangong/GPS selection, predicted arcs, shared/client cache ≥2h, stale/refusal policy. No precision navigation claim; see validation for actual provider/browser/native coverage.
- **M5 Density and UX:** optional Starlink subsampling, InstancedMesh, LOD, filters, satellite selection, quality modes, artist-friendly controls.
- **M6 Wallpaper Engine release:** import `dist/index.html`, set editor properties, test host FPS/pause/offline/4K, verify asset licenses, Steam Workshop preview/description/release checklist.

Each milestone ends with: locally verified typecheck/test/build (automatic CI is temporarily paused); updated docs; no fake API calls or artificial “real-time” labels; one runnable demo screenshot/video where meaningful. Create issues with acceptance criteria, not a giant all-features pull request.

## 11. Workflow for coding agents

1. Inspect README, AGENTS and relevant `docs/` files. Establish which milestone is currently complete; never infer from planned filenames that a feature works.
2. Break work into the smallest independently testable feature. Update `docs/ROADMAP.md` acceptance status and add unit tests as appropriate.
3. Prefer architecture-preserving additions; ask for design review before changing the core coordinate/time model.
4. For provider changes, inspect the **current** official documentation and usage policy. Cite authoritative API references in docs. Record rate limits, data provenance and parser assumptions.
5. Fail gracefully with diagnostics; protect remote endpoints with abort/timeout; no unbounded retries or silent exceptions.
6. Run typecheck, tests and production build locally before completion while CI is paused; if dependencies/network prevent running them, disclose explicitly. Do not restore GitHub Actions workflows unless the owner explicitly requests it.
7. Never publish Workshop content, create a paid listing, upload copyrighted images, or change repo license without explicit owner authorization.
8. Keep `AGENTS.md` and `docs/ARCHITECTURE.md` consistent with reality. `docs/ROADMAP.md` must distinguish **planned**, **partial** and **verified**.

## 12. Official references

- Wallpaper Engine Web workflow: https://docs.wallpaperengine.io/en/web/first/gettingstarted.html
- Wallpaper Engine property listener: https://docs.wallpaperengine.io/en/web/api/propertylistener.html
- Wallpaper Engine FPS: https://docs.wallpaperengine.io/en/web/performance/fps.html
- JPL Horizons API: https://ssd-api.jpl.nasa.gov/doc/horizons.html
- CelesTrak GP OMM: https://celestrak.org/NORAD/documentation/gp-data-formats.php
- CelesTrak usage policy: https://celestrak.org/usage-policy.php
- Astronomy Engine: https://github.com/cosinekitty/astronomy
- satellite.js: https://github.com/shashwatak/satellite-js
