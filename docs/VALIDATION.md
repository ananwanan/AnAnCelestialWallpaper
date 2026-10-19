# Validation record — 2026-10-19/20

`Verified` means the stated check was executed. `Partial` means implementation or some evidence exists but the full acceptance route remains open. `Planned` means it was not exercised. Browser tests, deployed API checks and native Wallpaper Engine acceptance are separate.

## M3/M4 continuation — latest build, 2026-10-20

This section supersedes the earlier build's Earth-demo and satellite-planned statements. Earlier M0–M2 evidence below remains historical; screenshots and package hashes must be associated with their stated build.

| Check | Status | Evidence / limit |
|---|---|---|
| Local typecheck / unit suite / production build | Verified | Final run at 00:07 Asia/Shanghai: `npm run typecheck`, `npm test`, `npm run build` executed through the local npm CLI; 294 tests in 20 files passed. The production JS is 706,824 bytes, with the existing Vite size advisory. This is not a measured GPU/FPS result. |
| Earth attitude and UV | Verified | Independent ERFA/SOFA reference basis, orthonormal/inverse km conversion, UTC rollover/eastward spin, actual SphereGeometry north/Greenwich/east UV checks and exact shared solar/Earth epochs. The attitude approximates UT1≈UTC and omits polar motion; [model details](EARTH_ORIENTATION.md). |
| Independent Earth/Moon focus | Verified in math and browser | Earth/Moon radii, physical km distance/trajectory, Sun direction, close-up and Earth–Moon preset; J2000→2100 jumps recompute orientation/position at the displayed epoch. Low/Medium/High, 1080×1920 portrait and 3840×1080 were inspected; eleven assets loaded with zero failures. [Earth capture](../artifacts/m3-review/earth-closeup.png), [Earth–Moon view](../artifacts/m3-review/earth-moon-overview.png). |
| OMM/SGP4/frame/freshness | Verified in tests | Data/sync cases include strict OMM, modern catalog IDs, three published Vallado TEME vectors, satellite.js pseudo-fixed reference transforms, EQJ inverse roundtrip, stale/refusal policy, predicted arcs, persistent refresh/cache/backoff and abort/timeout. Synthetic test records never become default runtime data. |
| Satellite rendering and app cadence | Verified in tests | Six layer tests and seven presentation tests cover bounded buffers, same km transform, selected marker/past/future arcs, OFF clearing, solar hiding, disposal, frozen-time no-work, time-jump invalidation and independent arc failures. |
| Production browser satellite flows | Verified with explicitly controlled test data | [QA record](../artifacts/m3-m4-production-qa/browser-qa.json): fresh default-OFF produced zero GP network events and zero satellite draws. Real source errors/cooldowns remained visible. Separate intercepted test origins used names beginning TEST FIXTURE / SYNTHETIC NOT LIVE to exercise ISS/Tiangong/GPS selection, epoch/altitude, four bounded satellite draws, predicted arcs, cached offline propagation, GPS stale warning at8.5days, station refusal at8.5days, cached reload without GP fetch and expired-source Unavailable/zero draws. These are integration tests, not current catalog acquisition. Interceptions/offline emulation were cleared and test tabs/servers closed. |
| Worker checks and deployment | Verified | Worker typecheck, all 101 tests and dry-run passed. Version `c715edf2-3f4b-483c-b438-76c6fe4f3113` deployed to `horizons.ananwanan.cc`, with a separate singleton SatellitesGate and migration. Existing Horizons behavior remains covered. |
| Real CelesTrak catalog acquisition | Partial / unavailable | First STATIONS request returned service503, Retry-After7985s; first GPS request at `2026-10-19T15:58:45.3189478Z` returned503, Retry-After8093s. Neither returned a dataset or X-Satellite-Blocked. Subsequent browser requests encountered the persisted shared429 cooldown. No usable current ISS/Tiangong/GPS catalog, successful source sync or real-satellite screenshot is claimed. The real route remains configured; cooldowns were not bypassed. |
| Native host restart | Verified restart; display still failed | At23:40 Asia/Shanghai a normal PID39248 replaced old PID7472 without `-safe`. Recovery notice acknowledged. Both production and plain HTML controls displayed black; Web helper IPC values appeared as Chromium navigation URLs. See native section below. |
| Steam file verification | Verified | At00:01 on2026-10-20, Steam verified build23967692 and finished `No Error`; no changed file download is recorded. Restarted normal host PID31380. The final production preview visibly remained black: [post-verification capture](../artifacts/native-after-steam-verification.png). This does not close native FPS/property/pause/offline gates. |
| Final static import bundle | Verified | Built `2026-10-19T16:08:22.8814921Z` (2026-10-20 00:08 Asia/Shanghai): 17 files; ZIP 5,335,254 bytes; every entry matched manifest bytes/SHA-256. Archive SHA-256 `8796344e630e7bd656496f8ba00577bce131fa443fb43c1384033807cca6c951`. No fixture, project.json, node_modules or environment file is bundled. Node/WASM worker code is absent. [Local test ZIP](../artifacts/AnAnCelestialWallpaper-web.zip). |

There are no new cloud/night textures. The static licensed day map remains a reference image rather than live weather. The satellite surface/frame approximation is explicit in the interface and never labeled precision tracking. CI remains paused; no workflow was restored.

The [final production Earth capture](../artifacts/m3-m4-production-qa/production-earth.png) uses the final `index-D4x4Qiwg.js` bundle, real local astronomy and the actual Horizons cached comparison (passed), all11 textures loaded, and satellites OFF with count/draws0. Synthetic fixture screenshots in that directory are labeled TEST-ONLY and must never be used as live-tracking evidence.

## Local and deployed checks

| Check | Status | Evidence / limit |
|---|---|---|
| Clean dependency install | Verified | `npm ci` completed; zero reported vulnerabilities at this run. |
| Typecheck / unit suite / production build | Verified | Final run at 23:05 Asia/Shanghai: typecheck, 225 tests in 14 files and production build passed. The 653.45 kB JavaScript chunk retains Vite's bundle-size advisory; this is not an FPS or GPU measurement. |
| M1 focused ephemeris/assets/layout tests | Verified | 21 cases passed, including immutable epochs/origins, Moon parent placement, sampled-path consistency, texture SHA-256/licenses, label collisions, aspect-safe focus bounds and an actual OrbitControls camera-flight regression. |
| Worker local checks | Verified | Typecheck, 88 tests and deployment dry-run passed for the M2 normalized adapter. |
| Deployed raw and normalized API | Verified | Version `b9358797-d756-4778-8005-5003d0616aba`; smoke at `2026-10-19T14:08:32.988Z`: raw `HIT`, normalized first `MISS` then `HIT`, complete nine-body UTC/Sun/ICRF/AU-D contract, CORS and request rejections. |
| Captured JPL reference | Verified | Recorded at `2026-10-19T14:08:28.873Z`; state epoch `2026-10-19T00:00:00.000Z`; oldest source retrieval `2026-10-19T12:59:30.900Z`. Two golden tests passed; [fixture provenance](../tests/fixtures/README.md). |
| Long-time/offline behavior | Verified in automated tests | Wall-clock resume/re-anchoring, cache corruption/expiry, network fallback/backoff and cancellation are covered. This is not a 24-hour browser or host soak. |
| Static import package | Verified | Rebuilt at `2026-10-19T15:05:50.0224604Z`: 17 files, 5,314,870 bytes; every ZIP entry matched the manifest's size and SHA-256. The bundle excludes `project.json`, `node_modules` and environment files, and includes runtime MIT and texture attribution notices. Archive SHA-256: `bbcde03930ef008e889263d3fa7bafa9aca8534bcc9a7c3511a2c57277437d57`. |

The reference comparison permits one arcminute × heliocentric distance + `1e-5 AU`, with a separate geocentric Moon tolerance. Worst recorded heliocentric residual was about `0.00224397 AU` for Neptune; Moon-minus-Earth residual was about `12.39 km`. Remote ICRF and local EQJ are not silently equated. These checks establish model sanity at one recorded epoch, not precision certification across all dates.

## Production browser evidence

The built production wallpaper was served at `http://127.0.0.1:4173`. Its public service performed a real startup comparison: source `Cached`, comparison passed, all 11 images loaded, zero asset failures and 24 draw calls. The scene displayed Sun, eight planets, Moon, Saturn rings, paths and aligned labels.

Continuation browser QA completed at `2026-10-19T14:59:01.217Z`. Exact observations are recorded in [`artifacts/browser-qa.json`](../artifacts/browser-qa.json). Each resolution capture waited for a rendered frame, rather than saving the old canvas immediately after a resize.

| Coverage | Status | Limit |
|---|---|---|
| Rendered 1080p, 1440p, 4K, 21:9 and 32:9 layout | Verified | Five captures linked below; each showed 10 labels with zero label/label or label/HUD overlaps and no viewport overflow. This verifies layout, not a GPU performance budget. |
| Presets, Earth demo and reset | Verified | Inner/outer/overview presets and reset worked. Earth focus visibly identifies `EARTH · DEMO`, used 3 draw calls and retained bounded resources; this is not M3 orientation acceptance. |
| Time controls | Verified | 60× → zero → resume restored 60×. UTC jump to `2027-01-02T03:04:05.000Z` remained frozen across roughly 10 seconds of quality checks; reset returned to current UTC. |
| Labels, paths, mouse and keyboard | Verified | Paths OFF reduced draw calls from 24 to 15. Mouse OFF prevented wheel changes; mouse ON enabled zoom and drag projection changes. Escape closed the drawer from an input, keyboard O toggled paths, and Space on the focused Earth button activated that button without pausing time. |
| Bounded quality/resource toggles | Verified | Six Low/Medium/High switches kept geometry and texture counts at 13 each. Triangle counts were 5,666 / 17,106 / 44,034; Low used 23 draw calls and Medium/High 24. This short sequence does not prove long-term leak freedom. |
| Cold API-blocked browser load | Verified | Fresh localhost origin without a cached comparison: `Local prediction`, 11 assets, zero asset failures, continuing frames (3 → 69), one blocked API attempt, zero CelesTrak requests and zero external runtime asset requests. [Offline capture](../artifacts/offline-first-load-1080p.png). |
| Warm cached offline and recovery | Verified | Existing comparison remained visibly cached offline. After unblocking and reloading, the real service returned `Cached` with comparison passed. |
| Host callbacks simulated in the real browser page | Verified as simulation only | During a 2,538 ms callback pause frames stayed 179 → 179 and no HTTP requests occurred; resume worked. Plain numeric FPS 5 was accepted and restored to 30. Partial user properties preserved unrelated flags. These are not native host measurements. |
| True document-hidden/minimized transition | Unverified | Activating another window still reported `visible`; no actual hidden-state or native minimized/fullscreen pause pass is claimed. Automated lifecycle tests cover the logic. |
| Actual 30 FPS, 4K GPU budget or iGPU/dGPU comparison | Planned measurement | 30 is the configured default cap, not a measured performance claim. |
| Two-hour memory/CPU/GPU soak | Planned | No long-duration resource-stability claim. |

Verified frame-wait captures:

- [1920×1080](../artifacts/verified-solar-1920x1080.png)
- [2560×1440](../artifacts/verified-solar-2560x1440.png)
- [3840×2160](../artifacts/verified-solar-3840x2160.png)
- [2560×1080](../artifacts/verified-solar-2560x1080.png)
- [3840×1080](../artifacts/verified-solar-3840x1080.png)

Earlier rapid-resize intermediate images are superseded by these verified captures. Scoped network blocking was removed, capture logging disabled, the temporary warm-cache tab closed and the production preview restored to Solar / 1× / 30 cap / Medium, labels, paths and mouse enabled.

## Native Wallpaper Engine gate

**Partial / unverified.** Wallpaper Engine 2.8.42 was installed and running. The documented direct `dist/index.html` preview route was attempted, but the host displayed `Aw, Snap` / `Crashpad_NotConnectedToHandler`. A plain no-JavaScript HTML control was also black. Read-only process metadata at 22:52 Asia/Shanghai still showed engine PID 7472, started on October 18 with `-safe -silent -service`; closing its UI did not establish an engine restart.

This does not prove whether application code works in a healthy host. It also does not establish editor import, native property delivery, native FPS/pause, offline native operation or desktop behavior. No editor-managed project or dummy `project.json` is claimed. M0's native gate remains open.

That earlier no-restart state was superseded by the confirmed restart and later Steam verification recorded above. The native gate remains open: [black production preview](../artifacts/native-restart-black.png), [no-script HTML control](../artifacts/native-html-control-black.png), [Chromium IPC symptoms](../artifacts/native-chromium-ipc.png). The erroneous URL `0.0.153.80` encodes PID39248 exactly (`153×256+80`), and other tabs match the Web helper's `WPEWebIpcHandler`/`monitor200` launch arguments. This is failure before application rendering, not proof of an application WebGL fault. Installed Web helper and CEF signatures were valid; the vendor's internal defect remains unknown. A [developer reply acknowledges the matching symptom](https://www.reddit.com/r/wallpaperengine/comments/1ua5yul/comment/osoapu3/). No editor-managed project or native property/FPS/pause/offline success is claimed.

## Reproduce

```powershell
Set-Location D:\code\AnAnCelestialWallpaper
npm ci
npm run typecheck
npm test
npm run build
npm run preview
```

Open the reported preview URL. The production configuration requests only the public Horizons base. Open **显示与时间** to exercise presets, toggles, quality, UTC jump, pause/resume and reset. Test each quality at 16:9, 21:9, 32:9 and 4K, waiting for the canvas to redraw after resizing. Close the drawer to inspect collision-free labels. Native reproduction commands and exact property keys are in [WALLPAPER_ENGINE.md](WALLPAPER_ENGINE.md).

In a normal browser console, the following checks simulate host callbacks; they are **not native host evidence**:

```javascript
window.wallpaperPropertyListener.applyUserProperties({ showLabels: { value: false }, quality: { value: 'low' } });
window.wallpaperPropertyListener.applyGeneralProperties({ fps: 15 });
window.wallpaperPropertyListener.setPaused(true);
window.wallpaperPropertyListener.setPaused(false);
```

`#app` exposes `data-frame-count`, `data-sim-time`, `data-source-state`, `data-comparison-passed`, `data-draw-calls`, `data-triangles`, `data-geometries`, `data-textures`, `data-loaded-assets`, `data-failed-assets` and `data-pixel-ratio` for inspection. Use wall-clock measurements for FPS, and leave enough time for the HUD's lower update cadence.

The sequential live provider smoke command is:

```powershell
node scripts/check-horizons-proxy.mjs https://horizons.ananwanan.cc
```

Respect `Retry-After`; do not run concurrent smoke checks. A cold normalized request may perform nine serial source calls. The independent Worker package has its own `npm run typecheck`, `npm test` and `npm run build` (deployment dry-run).

## Release boundaries

M3 is implemented with browser/math coverage; M4 is implemented with deterministic and integration coverage while live source acquisition remains unavailable. Native acceptance, source-code licensing, the full device/performance matrix and Workshop publication remain open. CI remains paused; no GitHub Actions workflow was re-enabled.

The static import bundle is generated by `scripts/package-wallpaper.ps1` at `artifacts/AnAnCelestialWallpaper-web.zip`, with per-file SHA-256 hashes in `artifacts/build-manifest.json`. Import `index.html` after extracting the ZIP. This is a local test bundle, without editor-generated `project.json` or a Workshop publication. It includes runtime dependency MIT notices and texture CC BY 4.0 attribution.

The verified captures and browser QA JSON are browser evidence; they do not replace the native host acceptance gate. The final package manifest and archive hash above correspond to the final production build.
