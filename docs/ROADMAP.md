# Roadmap and acceptance criteria

Status: `[x]` implemented with stated evidence; `[~]` partial or acceptance still open; `[ ]` planned. Implementation, browser verification and native host acceptance are separate. Current evidence is in [VALIDATION.md](VALIDATION.md).

**CI remains paused (2026-10-19).** Run local typecheck, tests and production build. Do not restore the archived GitHub Actions workflow without owner authorization; see [CI.md](CI.md).

## M0 — Foundation: implemented; native host gate partial

- [x] Strict TypeScript/Vite/Three.js skeleton, relative assets and offline Sun/eight-planet scene.
- [x] Deterministic UTC wall-clock, early host listener, validated partial properties and host FPS/pause lifecycle.
- [x] Clean `npm ci` with zero reported vulnerabilities, local typecheck/test/build and production browser rendering.
- [x] Actual editor import/preview observed on 2026-10-20, including the updated build with desktop controls hidden; real editor-generated metadata is preserved and backed up.
- [x] Product properties appear in the editor and Wallpaper Engine's main properties panel; optional desktop settings switch defaults OFF.
- [x] ASCII real-project migration fixed the observed damaged-path startup; final build independently renders. Native HTML button/listbox settings opened, expanded and selected High quality without the earlier select-related CEF crash.
- [x] Scoped native delivery: desktop-controls and time-rate properties, desktop15 FPS admission (~14.3 measured), actual host pause/resume,11 textures and24 draw calls. See exact coverage in VALIDATION.md.
- [~] Broader native acceptance: warm blocked-HTTP page test passed; OS-disconnected startup, desktop icon forwarding, fullscreen/display matrix and long-duration measurements remain open.

**Core native evidence now exists:** import/rendering, tested settings and host lifecycle work within the recorded scope. Remaining release/device gates are M6; browser and native evidence stay separate.

## M1 — Solar visual quality: implemented and browser verified

- [x] Eleven local Sun/planet/Moon/ring maps, verified creator CC BY 4.0 attribution and SHA-256 provenance.
- [x] Textured spheres, Sun glow/corona, Saturn rings, local ephemeris Moon, stars and inclined sampled trajectories.
- [x] Smooth overview/inner/outer presets, separate basic Earth view, collision-aware labels and mouse toggle.
- [x] Low/Medium/High shared geometry, DPR/star budgets, capped scheduling and resource cleanup.
- [x] Production browser scene loaded all eleven assets with zero failures and 24 draw calls; default configured cap is 30 FPS.
- [x] Frame-wait captures at 1920×1080, 2560×1440, 3840×2160, 2560×1080 and 3840×1080: ten labels each, zero label/HUD overlaps or viewport overflow. This is not a 4K GPU performance result.
- [x] Browser drawer, presets, basic Earth demo, time/UTC/reset, paths/labels, mouse and keyboard interactions verified. Six quality switches retained 13 geometries / 13 textures; short toggle checks do not replace a soak.
- [ ] Two-hour CPU/memory/GPU soak and representative iGPU/dGPU measurements.

**Browser exit verified:** visual assets, layout and controls passed within recorded coverage. Native acceptance, real GPU/FPS measurements and long-duration soak remain open; calibrated Earth/body orientation is M3.

## M2 — Time, Horizons comparison and caching: implemented

- [x] UTC timeline, pause/resume, rate re-anchoring, jump/reset and dropped-frame/long-resume tests.
- [x] Deployed normalized nine-body `/api/ephemeris` plus constrained raw Horizons route.
- [x] Strict source/version/body/frame/unit/time validation and bounded hourly cubic Hermite interpolation.
- [x] One startup real-UTC comparison, 1/6/24-hour wall-clock scheduling, versioned browser cache and local fallback.
- [x] Capped backoff/jitter, source `Retry-After`, timeouts, cancellation and readable source/cache labels.
- [x] One shared Cloudflare Durable Object serializes/caches upstream traffic; live normalized MISS→HIT and raw HIT checks passed on the custom domain.
- [x] Captured JPL fixture with provenance, nine-body same-epoch sanity comparison and separate geocentric Moon parent test; tolerances and model limits documented.
- [x] Production browser startup used the deployed normalized service: `Cached`, comparison passed, eleven assets loaded without failure.
- [x] Browser cold uncached API-blocked startup, warm cached offline use and real-service recovery verified; local frames continued with no CelesTrak or external runtime asset requests.
- [x] Actual page callback simulation verified pause/no frames/no HTTP, resume and numeric FPS/partial properties. Native delivery and a true document-hidden/minimized transition remain unverified.

Remote ICRF samples validate local EQJ output at the same UTC epoch; the scene remains local. `Live/Sync` labels a reference operation, not an externally driven rendered trajectory or precision certification.

## M3 — Calibrated Earth focus: implemented

- [x] GAST spin plus EQD→EQJ precession/nutation, independent ERFA/SOFA reference and actual SphereGeometry UV checks.
- [x] Calibrated Earth/Moon focus, shared physical km scale, ephemeris Moon orbit, Sun direction and Earth–Moon camera.
- [x] Existing licensed static day map retained; optional night/cloud layers were unnecessary for this milestone.
- [x] Explicit UT1≈UTC / no polar-motion limitation; other body poles and lunar surface orientation remain illustrative.
- [x] Browser scene/layout, Earth–Moon/quality/epoch jumps and portrait/32:9 coverage passed; records in VALIDATION.md. Native acceptance remains a separate open gate.

## M4 — Artificial satellites: implemented; acceptance tracked separately

- [x] Opt-in validated targeted OMM, bounded local SGP4 and batched Points; default OFF stops fetch/propagation/draw work.
- [x] Tested TEME→PEF→EQJ approximation, with Vallado/satellite.js reference cases; approximate prediction labels remain mandatory.
- [x] ISS/Tiangong (when in catalog)/GPS selection, source epochs/age/altitude, recent/future predicted arcs, stale warnings and out-of-window refusal.
- [x] Client/shared Worker persisted ≥2-hour per-dataset refresh, bounded cache, cancellation/timeouts, backoff/Retry-After and source-policy halt.
- [x] Deployed read-only GP gate status, persisted failure-phase diagnostics and a cooldown-aware serial smoke script. Existing allowances were preserved; no new source request was made during cooldown.
- [~] Cooldown-safe real STATIONS/GPS attempts at 02:14–02:15 and the final 06:30–06:31 Asia/Shanghai follow-up all timed out after 15s before HTTP headers; no current elements were acquired. The 06:28 scheduled continuation has completed and automatic follow-up has ended. Preserved new gates are 2026-10-20T08:04:34.322Z / 06:37:31.838Z (STATIONS/GPS), not a retry schedule. Investigate the Worker-to-CelesTrak network path before further deliberate source work; no reset or alternate-egress bypass. Real epochs/propagation/rendering remain unverified. See VALIDATION.md.

## M5 — Density and performance: planned

- [ ] Optional Starlink filtering/subsampling, instancing and LOD.
- [ ] Extended interaction/accessibility polish and long-running iGPU/dGPU profiles.
- [ ] Native host performance/quality tuning after the M0 gate is resolved.

## M6 — Wallpaper Engine release: planned

- [~] Editor/independent rendering,13 property definitions and scoped native property/FPS/pause checks passed. Full property/device matrix remains unverified.
- [ ] Offline/FPS/pause/Windows/resolution matrix and two-hour soak completed.
- [ ] Final source-code license decision, notices, release preview and standalone bundle audit.
- [ ] Owner explicitly approves Workshop publication.

No Workshop publication or fabricated `project.json` is part of the current implementation.
