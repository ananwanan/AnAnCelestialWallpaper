# Roadmap and acceptance criteria

Status key: `[x]` implemented in initial scaffolding, `[~]` partial implementation, `[ ]` planned/unverified.

**CI policy (2026-10-19):** Automatic GitHub Actions CI is **temporarily disabled**; active `.github/workflows/ci.yml` was removed and archived at `docs/ci-workflow.yml.disabled`. Validation remains a manual/local requirement (`npm run typecheck`, `npm test`, `npm run build`). Do not enable CI without owner approval. See [CI status and reactivation](CI.md).

## M0 — Bootstrap / offline prototype

- [x] Vite/TypeScript/Three.js skeleton and relative production assets.
- [x] Basic offline Sun and eight planets, astronomy-engine heliocentric positions, orbitable camera.
- [x] Minimal Earth-focused scene and browser controls (not final quality).
- [x] AGENTS.md, architecture, data policy, integration notes.
- [x] Automatic CI intentionally paused; previous workflow retained in `docs/ci-workflow.yml.disabled` for later restoration.
- [~] Manual/local test and build verification (requires npm dependencies; no verified clean build yet).
- [ ] Verified Wallpaper Engine import and user properties in actual application.

**Exit:** Clean `npm install`, local typecheck/test/build all succeed (CI paused); offline scene is visible in a browser and Wallpaper Engine.

## M1 — Solar visual quality

- [ ] Redistributable planet sphere textures with accurate provenance; artist-grade Sun glow, corona and controlled bloom.
- [ ] Saturn rings, Earth's Moon, stars, inclined trajectory lines, orbit labels, zoom/preset transitions.
- [ ] No GC spikes, responsive 16:9/21:9/32:9; FPS/user quality budget.

**Exit:** M1 visual checklist and texture attribution signed off.

## M2 — Time, remote synchronization & caching

- [ ] UTC simulation controls, clock suspend/resume and time warp tests.
- [ ] NASA Horizons adapter with schema/units/frame guard and current-time startup snapshot.
- [ ] Valid interpolation of time-window position/velocity samples, or documented local evaluation with remote validation.
- [ ] 1/6/24h refresh scheduler, offline cache, exponential-backoff and source status badge.
- [ ] Hosted and rate-limited Cloudflare Worker (optional but recommended before public release).

**Exit:** Current time and time-scaled trajectory match known reference vectors within documented tolerance, even after 24h offline.

## M3 — Earth focus

- [ ] Verified Earth orientation and rotation frame; high-quality cloud/day/night texture with license.
- [ ] Smooth focus camera transition, Earth scale calibration, globe labels and physically reasonable lighting.

**Exit:** Earth orientation/reference-frame tests pass; cinematic view runs smoothly.

## M4 — Artificial satellite tracking

- [ ] Satellite switch OFF = no CelesTrak requests and no SGP4 work.
- [ ] OMM JSON read/validation, `satellite.js` SGP4 and TEME↔Earth/inertial conversion tests.
- [ ] ISS, Tiangong (if in data), GPS groups; orbital trails, selectable NORAD information; OMM age/status.
- [ ] Separate source refresh scheduler with 2h minimum + on-disk cache, stale/failure policy.

**Exit:** Epoch/current position comparisons against external reference and anti-overfetch tests.

## M5 — Performance & customization

- [ ] Optional filtered Starlink; InstancedMesh/Points + LOD and max satellite counts.
- [ ] Wallpaper Engine editable user properties; host FPS cap, pause/restart and quality presets.
- [ ] Time/profile performance tests on typical iGPU and dGPU.

**Exit:** Target 30 FPS under medium settings with explicit test hardware and no unreasonable background usage.

## M6 — Workshop release

- [ ] Local static assets only, license/third-party notices, screenshot/preview video.
- [ ] Tested build imported via `dist/index.html` in Wallpaper Engine editor.
- [ ] Verified offline, FPS, settings, Win 10/11, 1080p/1440p/4K and ultrawide.
- [ ] Workshop publishing and post-publish update workflow.

**Exit:** Owner explicitly approves Workshop publication; no automatic external uploads by agents.