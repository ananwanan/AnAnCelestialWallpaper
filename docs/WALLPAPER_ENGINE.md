# Wallpaper Engine integration

The runtime is a **Web wallpaper**, not Electron. The production browser build is working; native acceptance is still open. [VALIDATION.md](VALIDATION.md) records the host attempt and distinguishes it from browser checks.

## Current host evidence

The earlier 2026-10-19 attempt used an old `-safe -silent -service` process and failed with `Crashpad_NotConnectedToHandler`. A real restart at 23:40 Asia/Shanghai replaced PID7472 with PID39248, started without `-safe`; the startup recovery notice was acknowledged. Both the production wallpaper and a no-JavaScript/no-WebGL/no-network HTML control still rendered black. The Web helper opened Chromium tabs for its own IPC arguments: `0.0.153.80` exactly encodes PID39248, alongside `WPEWebIpcHandler` and `monitor200` values.

This localizes failure before the wallpaper's HTML executes. Installed 2.8.42 Web helper/CEF binaries have valid vendor signatures; the evidence does not establish corruption or the vendor's internal cause. A matching symptom has a [developer acknowledgement](https://www.reddit.com/r/wallpaperengine/comments/1ua5yul/comment/osoapu3/). Steam file verification was executed on 2026-10-20 at 00:01 Asia/Shanghai and completed with `No Error`; post-verification native results are in VALIDATION.md. Native display, editor properties, FPS, pause/resume and offline operation remain unverified until a working host can execute a Web wallpaper.

No editor-created project or Workshop upload is claimed, and no dummy `project.json` has been generated.

## Build and editor import

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

Open Wallpaper Engine's editor, choose **Create Wallpaper**, and select `D:\code\AnAnCelestialWallpaper\dist\index.html` as a Web wallpaper. The editor copies the output into its own project directory and manages `project.json`. Keep scripts, textures, attribution and provenance files together. Do not import `node_modules` or repository sources.

Add user properties in **Edit → Change project settings** using the exact names below. Publishing remains a separate owner-approved M6 operation.

## Host property contract

| Key | Type | Values/default |
|---|---|---|
| `viewMode` | combo | `solar`, `earth`; `solar` |
| `showSatellites` | bool | `false`; enabling lazily requests scoped GP, disabling aborts requests and clears propagation/drawing |
| `satelliteGroup` | combo | `stations`, `gps`, future `starlink`; `stations` |
| `syncInterval` | combo | `1`, `6`, `24`; `6` hours |
| `timeScale` | slider | 0–86400; `1` |
| `showOrbits` | bool | `true` |
| `showLabels` | bool | `true` |
| `enableMouse` | bool | `true` |
| `quality` | combo | `low`, `medium`, `high`; `medium` |

The bridge is installed before DOM/WebGL initialization. `applyUserProperties` receives wrapped partial values; unrelated settings are retained. `applyGeneralProperties({fps})` accepts the host's plain FPS value. `setPaused(true)` suspends rendering; resume recomputes the displayed epoch from the wall clock. This differs from the footer pause, which sets `timeScale=0` and freezes simulation time. Automated bridge/clock/loop tests pass; delivery by the actual native host is pending.

## Direct preview and property reproduction

The [official CLI guide](https://help.wallpaperengine.io/en/functionality/cli.html) documents direct `index.html` files for Web wallpapers, window previews and property changes. These commands reproduce the intended route; they are not evidence of a successful native render in this environment. Set the executable to the real installation path and start Wallpaper Engine normally first:

```powershell
$wallpaperEngine = 'C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine\wallpaper64.exe'
& $wallpaperEngine -control openWallpaper -file 'D:\code\AnAnCelestialWallpaper\dist\index.html' -playInWindow 'AnAn Celestial validation' -width 1920 -height 1080
& $wallpaperEngine -control applyProperties -location 'AnAn Celestial validation' -properties 'RAW~({"showLabels":false,"quality":"low"})~END'
```

After a real web preview works, check property changes one at a time, native FPS at 15/30, pause/resume, offline behavior and fullscreen performance settings. Use the same built `dist/` for browser and host comparisons.

## Acceptance checklist

- [x] Relative-path production build and complete local texture assets.
- [x] Tested early listener, property normalization, partial updates, FPS cap and pause/resume logic in automated tests.
- [x] Browser production scene shows local Sun/eight planets/Moon and loads eleven textures without failure.
- [x] Browser quality/control matrix and five rendered resolution captures, cold/warm offline behavior, recovery and simulated host callbacks; see [validation](VALIDATION.md). These are not native host evidence.
- [ ] Native Web preview/editor import visibly works.
- [ ] Native partial properties, FPS and pause delivery verified.
- [ ] Native offline operation and no CelesTrak requests verified.
- [ ] Two-hour resource soak and 1080p/1440p/4K/ultrawide host matrix.

References: [Web workflow](https://docs.wallpaperengine.io/en/web/first/gettingstarted.html), [property listener](https://docs.wallpaperengine.io/en/web/api/propertylistener.html), [FPS](https://docs.wallpaperengine.io/en/web/performance/fps.html).
