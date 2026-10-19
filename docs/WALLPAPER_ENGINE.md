# Wallpaper Engine Web wallpaper integration

Official docs: https://docs.wallpaperengine.io/en/web/first/gettingstarted.html

## Import

1. `npm install && npm run build`.
2. Open Wallpaper Engine editor → Create Wallpaper → import **`dist/index.html`** (Web wallpaper).
3. The editor will **copy** output files into its own project directory and manage `project.json`. Do not import the whole repository, `node_modules`, or source folder.
4. From Editor → Edit → Change project settings, create user properties with exact keys below.
5. Use Workshop → Share wallpaper to publish, only after testing/licensing checks; editor can update the same Workshop item later.

## Properties to add in the editor

| Key | Type | Values/default |
|---|---|---|
| `viewMode` | combo | `solar`, `earth`; default `solar` |
| `showSatellites` | bool | default `false` |
| `satelliteGroup` | combo | `stations`, `gps`, eventually `starlink`; default `stations` |
| `syncInterval` | combo | `1`, `6`, `24`; default `6` |
| `timeScale` | slider | 0–86400; default `1` |
| `showOrbits` | bool | default `true` |
| `showLabels` | bool | default `true` |
| `enableMouse` | bool | default `true` |
| `quality` | combo | `low`, `medium`, `high`; default `medium` |

The `wallpaperPropertyListener` must be assigned as a global before expensive initialization. Handle **partial updates**, `applyGeneralProperties({fps})` and `setPaused(bool)`. In M0 the bridge supports core view/orbits/time/fps but not yet full satellite display or texture quality controls.

## Performance / manual checklist

- [ ] Works without Internet and never relies on CDN scripts.
- [ ] Supports Wallpaper Engine's FPS limit and pause/focus behavior; no forced 60fps override.
- [ ] Solar / Earth view at 1080p, 1440p, 4K, 21:9 and 32:9.
- [ ] `showSatellites=false` triggers no satellite API requests.
- [ ] `showSatellites=true` shows appropriate satellite selections with epoch/staleness.
- [ ] With all network requests blocked, local celestial motion continues.
- [ ] Full bundled textures have documented rights for redistribution.
- [ ] Production build runs with relative paths (`base: './'`).

**Wallpaper Engine integration has not been verified until tested in the actual desktop application.**

Official FPS API: https://docs.wallpaperengine.io/en/web/performance/fps.html
Official properties API: https://docs.wallpaperengine.io/en/web/customization/properties.html
