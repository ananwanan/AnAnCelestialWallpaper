# Wallpaper Engine integration

The runtime is a **Web wallpaper**, not Electron. Native editor preview, independent playback and desktop rendering have been observed on 2026-10-20, with tested host properties, a 15 FPS cap and pause/resume. Offline, desktop-icon/fullscreen behavior and long-duration acceptance remain separate in [VALIDATION.md](VALIDATION.md).

## Current host evidence

The owner's initial success concerned the editor preview; independent playback needed a separate check. Earlier normal restarts and Steam file verification did not resolve black playback. The native log then provided a concrete path failure: at `2026-10-19T16:44:11Z`, `bin/weblog.txt` rejected `chronorbit_%EF%BF%BD%EF%BF%BD_rea/index.html`, although the real directory was `chronorbit_—_rea`. Main-process logs also could not open that damaged path's `project.json`. An ASCII copy retaining the real editor metadata and relative resources rendered independently. The production project was subsequently relocated to:

`D:\SteamLibrary\steamapps\common\wallpaper_engine\projects\myprojects\anan-celestial-wallpaper`

The complete pre-relocation project/config backup is [retained locally](../artifacts/WallpaperEngine-relocation-backup-2026-10-19T17-59-49-888Z-aa10b4ba-5c52-423a-a665-553d7fdf5655/relocation.json). The editor-created title, assets, property definitions/defaults and existing per-wallpaper user choices are preserved by relocation. A controller restart later rewrote some old in-memory config references; final saved-path/preference restoration must be checked separately and must not be inferred from the successful move.

A second compatibility issue affected the optional desktop drawer: visible product `<select>` elements reproducibly crashed the native renderer. Plain standalone selects worked, and removing blur or changing select styling did not fix the product case. The final build uses HTML button/listbox presentation with hidden select models. Native opening, expansion and High-quality selection passed without a crash: [final drawer capture](../artifacts/native-host-2026-10-20/final-native-panel-high.png). These A/B results do not establish a CEF internal root cause. A separate crash while opening DevTools' Network panel is not evidence of a wallpaper crash.

The final `index-DUa_F1cm.js` / `index-DqRsUQp0.css` build passed typecheck, build, 341 unit tests and [29 browser QA checks](../artifacts/host-settings-browser-custom-select-2026-10-20/README.md). Actual Monitor0 inspection showed `hostConnected=true`, `hostFps=15`, a paused frame and subsequent `hostPaused=false` rendering. All eleven assets loaded; the scene reported 24 draw calls and 13 geometries/textures. Frame count 548 at `2026-10-19T18:07:00.617Z` reached 1599 at `18:08:14.123Z`: approximately **14.3 FPS** below the 15 FPS host cap. Measurement temporarily used 15 FPS and allowed running behind a maximized window; the baseline was 60 FPS with maximized/fullscreen pause. Final preference restoration is tracked separately. No native offline, desktop-icon/fullscreen acceptance, two-hour soak or Workshop publication is claimed.

## Build and editor import

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

Open Wallpaper Engine's editor, choose **Create Wallpaper**, and select `D:\code\AnAnCelestialWallpaper\dist\index.html` as a Web wallpaper. The editor copies the output into its own project directory and manages `project.json`. Keep scripts, textures, attribution and provenance files together. Do not import `node_modules` or repository sources.

Add user properties in **Edit → Change project settings** using the exact names below. Publishing remains a separate owner-approved M6 operation.

For an **already editor-created** import, the helper merges the checked-in property definitions into the existing metadata and copies a fresh `dist/`. It preserves the title, preview, unrelated fields/properties and valid existing property choices. It creates a backup under the repository's `artifacts/` before writing, and never creates a replacement project or deletes old assets:

```powershell
node scripts/update-wallpaper-project.mjs --project 'D:\SteamLibrary\steamapps\common\wallpaper_engine\projects\myprojects\anan-celestial-wallpaper\project.json' --check --copy-dist
node scripts/update-wallpaper-project.mjs --project 'D:\SteamLibrary\steamapps\common\wallpaper_engine\projects\myprojects\anan-celestial-wallpaper\project.json' --copy-dist
```

Close the editor's project-settings dialog before running the helper, then reopen/reload the project so an older editor copy does not overwrite it. The definitions in `scripts/wallpaper-properties.json` are a property manifest, **not** a publishable Wallpaper Engine project. The helper's `--check` is read-only.

For another existing project affected by a directory-encoding problem, `scripts/relocate-wallpaper-project.mjs` provides a separate one-time relocation. Close Wallpaper Engine, its editor and pending controller processes first. Pass the real existing `project.json`, a nonexistent absolute ASCII sibling directory under the same `myprojects`, and the existing installation `config.json`. Run with `--check` first; it reports editor-history, selected-wallpaper, recent-layout and `wproperties` references without writing. The actual run verifies a complete backup before renaming, preserves unrelated configuration text and user choices, rejects links/collisions and rolls back path/config changes on failure. It does not create project metadata or delete files. This checkout's former directory has already been relocated; do not rerun its old path. Recheck saved references after normal startup so stale controller state cannot silently restore them.

## Host property contract

| Key | Type | Values/default |
|---|---|---|
| `viewMode` | combo | `solar`, `earth`; `solar` |
| `cameraPreset` | combo | `default`, `inner`, `outer`, `earthMoon`; `default`. Inner/outer apply in Solar view; Earth–Moon applies in Earth view. Incompatible choices use that view's default. |
| `showDesktopSettings` | bool | `false`; enables optional desktop navigation, settings drawer and simulation-pause button |
| `showSatellites` | bool | `false`; enabling lazily requests scoped GP, disabling aborts requests and clears propagation/drawing |
| `satelliteGroup` | combo | `stations`, `gps`; `stations`. Starlink is not offered before its performance gate. |
| `satelliteSelection` | textinput | `0` automatic; `25544` ISS, `48274` Tiangong; a GPS NORAD ID must belong to the GPS group. This selects within the loaded group and makes no extra catalog request. |
| `syncInterval` | combo | `1`, `6`, `24`; `6` hours |
| `timeScale` | slider | 0–86400; `1` |
| `simulationUtc` | textinput | empty by default. On change, a canonical UTC value such as `2026-10-20T00:00:00Z` jumps the local clock; clearing a previously set value returns to current UTC. Allowed years 1962–2100; invalid dates are ignored. The selected time rate is retained. |
| `showOrbits` | bool | `true` |
| `showLabels` | bool | `true` |
| `enableMouse` | bool | `true` |
| `quality` | combo | `low`, `medium`, `high`; `medium` |

Properties live in Wallpaper Engine's Installed-wallpaper properties sidebar. On a local `file://` import the interactive desktop controls start hidden even before the first host callback. Changing `showDesktopSettings` to false closes any open drawer, removes the navigation/pause buttons from tab order, and disables wallpaper keyboard shortcuts so desktop typing does not change the scene. Read-only time, provenance, scientific-scale notes and enabled satellite details remain visible. Mouse orbit/zoom has its own independent `enableMouse` property; desktop-icon input forwarding remains a host behavior to verify.

The optional drawer uses HTML listboxes rather than opening native select popups. Click a choice or use Arrow Up/Down, Home/End and Enter/Space; Escape, Tab, outside clicks and drawer hiding dismiss the list. Dynamic satellite options and disabled/no-data state use the same validated settings/change path as host properties.

Normal HTTP(S) development previews keep the browser controls until a real/simulated host callback takes over. The bridge is installed before DOM/WebGL initialization. `applyUserProperties` receives wrapped partial values; unrelated settings are retained. `applyGeneralProperties({fps})` accepts the host's plain FPS value. There is no separate wallpaper FPS slider: Wallpaper Engine's main Performance settings own the cap. The optional drawer reports the cap and measured render FPS; DOM diagnostics also expose `data-observed-fps`, frame count and simulated UTC.

`setPaused(true)` cancels render scheduling and suspends periodic synchronization/propagation; resume recomputes the displayed epoch from the wall clock. This differs from `timeScale=0`, which freezes simulation time. Document visibility loss also suspends work. Native paused/resumed desktop states and the 15 FPS setting have been observed; offline operation, the complete host-property matrix and desktop behavior still require their own acceptance evidence.

## Direct preview and property reproduction

The [official CLI guide](https://help.wallpaperengine.io/en/functionality/cli.html) documents direct Web files or project metadata, named previews and property updates. Start Wallpaper Engine normally **before** sending commands; the invocation below is a temporary controller that forwards to that running host. Use an ASCII absolute path with backslashes. Pass RAW JSON as one unmodified command-line string with `Start-Process -ArgumentList`; PowerShell's direct native-argument form did not reliably forward the JSON during this run. Wait for the controller to exit, then confirm the wallpaper has loaded before applying another command:

```powershell
$wallpaperEngine = 'D:\SteamLibrary\steamapps\common\wallpaper_engine\wallpaper64.exe'
$project = 'D:\SteamLibrary\steamapps\common\wallpaper_engine\projects\myprojects\anan-celestial-wallpaper\project.json'
$openArguments = '-control openWallpaper -file "' + $project + '" -playInWindow "AnAn Celestial validation" -width 1920 -height 1080'
Start-Process -FilePath $wallpaperEngine -ArgumentList $openArguments -WorkingDirectory (Split-Path $wallpaperEngine) -WindowStyle Hidden -Wait
$propertyArguments = '-control applyProperties -location "AnAn Celestial validation" -properties RAW~({"showLabels":false,"quality":"low"})~END'
Start-Process -FilePath $wallpaperEngine -ArgumentList $propertyArguments -WorkingDirectory (Split-Path $wallpaperEngine) -WindowStyle Hidden -Wait
```

The controller wait prevents overlapping command senders; it does not itself prove the asynchronous wallpaper has finished loading or applying a property. Check changes one at a time and retain the user's original performance preferences. The native 15 FPS/pause observations above do not complete native offline, fullscreen or two-hour performance acceptance.

## Acceptance checklist

- [x] Relative-path production build and complete local texture assets.
- [x] Tested early listener, property normalization, partial updates, FPS cap and pause/resume logic in automated tests.
- [x] Browser production scene shows local Sun/eight planets/Moon and loads eleven textures without failure.
- [x] Browser quality/control matrix and five rendered resolution captures, cold/warm offline behavior, recovery and simulated host callbacks; see [validation](VALIDATION.md). These are not native host evidence.
- [x] Native editor import visibly renders final production build; real user-property definitions appear in editor and main property UI.
- [x] Independent native playback and Monitor0 desktop rendering visibly work from the ASCII project path.
- [x] Tested native property delivery, HTML-listbox selection, 15 FPS cap and paused/resumed host states observed.
- [ ] Complete native partial-property, 30 FPS, quality/display and final saved-preference matrix.
- [ ] Native offline operation and no CelesTrak requests verified.
- [ ] Two-hour resource soak and 1080p/1440p/4K/ultrawide host matrix.

References: [Web workflow](https://docs.wallpaperengine.io/en/web/first/gettingstarted.html), [property listener](https://docs.wallpaperengine.io/en/web/api/propertylistener.html), [FPS](https://docs.wallpaperengine.io/en/web/performance/fps.html).
