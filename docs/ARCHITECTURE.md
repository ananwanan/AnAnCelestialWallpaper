# Architecture

## Data flow

```text
Wallpaper Engine properties / browser dev toolbar
                 |
        Validated Settings ---- Simulation Clock (UTC)
                 |                 |
Ephemeris Sync (optional API)      +-- Astronomy Engine -> heliocentric EQJ/AU
  -> typed snapshots, cache       +-- Satellite.js SGP4 -> TEME/km
  -> refresh scheduler               |  frame service & correctness tests
                 |                  v
                 +------ Normalized immutable scene-state
                                          |
                         +----------------+----------------+
                         |                                 |
                 SolarScene (AU)                  EarthFocusScene (km)
                         +----------------+----------------+
                                          |
                             Three.js Renderer / WebGL
                                          |
                                  Wallpaper Engine
```

## Frame and scale

- Canonical planetary state: heliocentric equatorial J2000 (EQJ), units AU, time UTC; renderer rotates `(x,y,z)` to `(x,z,-y)` so Three's up axis is +Y.
- Satellite `satellite.js` SGP4 output: Earth-centered TEME in km, epoch-sensitive. This is **not identical** to J2000 EQJ: a tested frame transform needs to account for the intended Earth-fixed frame, Earth orientation and date. Do not mix without conversion. First complete M4 conversion tests before claiming precision.
- Solar scene: scene units = AU * scale. Earth focus: scene units = km * local Earth radius scale, and separate near/far camera range. This avoids satellites disappearing because the Solar System spans billions of km.
- Rendered planet radii are deliberately exaggerated; physical sizes retained separately for information display.
- Orbital polylines are samples from the same time-dependent ephemeris, not unrelated ornamental ellipses. Adaptive refinement in later milestones.

## Sync model

- Planet position evaluation works offline every frame from `astronomy-engine`. It uses the displayed simulated UTC time, not a continuously incremented arbitrary angle.
- After boot, a **single logical ephemeris sync** is attempted if the environment includes a `VITE_EPHEMERIS_BASE_URL`. The provider must return validated, timestamped bodies; acceptance into authoritative cache requires a defined way to interpolate/propagate over time. Otherwise use it only for validation and report `local` state.
- Solar sync interval enum: 1, 6, 24 hours, default 6. Cache across wallpaper restarts where safe.
- Satellites: start disabled. Only after opt-in, request narrow GP groups / catalog entries. Group cache TTL minimum 2 hours; satellite propagation continuous and completely local between refreshes.
- Unavailable or unconfigured provider is not an error for offline solar view.

## Surface API contracts (target)

`GET {base}/api/ephemeris?at=<UTC ISO>`

```json
{
  "schemaVersion": 1,
  "source": "JPL-Horizons",
  "retrievedAt": "2026-10-19T00:00:00Z",
  "referenceFrame": "EQJ/J2000",
  "origin": "Sun",
  "units": "AU, AU/day",
  "states": [
    {"id":"earth","epoch":"2026-10-19T00:00:00Z","positionAU":{"x":0,"y":0,"z":0},"velocityAUPerDay":{"x":0,"y":0,"z":0}}
  ]
}
```

The zero vectors shown are **schema-only placeholders, not astronomical data**. Require a source-version identifier, validity interval and state validation before using a sample. Do not extrapolate one returned position and velocity linearly for many hours.

`GET {base}/api/satellites?group=stations` returns validated CelesTrak OMM records plus source epoch, retrieval time and last-good cache status. The Worker should coalesce requests across public users, never forward arbitrary URLs.

## Security & deployment

- Web wallpaper may be opened under a local-file origin; remote CORS can differ from normal localhost development. Use a restrictive configured shared cache service rather than a permissive open URL proxy.
- Vite `VITE_` vars are public; no credentials here. Validate remote schemas and cap payloads before parsing.
- `vite.config.ts` sets relative `base: './'` so hashed bundles and textures can be imported by Wallpaper Engine.
- `project.json` is authored and updated by Wallpaper Engine after import. Build tooling must not overwrite it.

## UI customization contract

`showSatellites=false`, `viewMode=solar`, `satelliteGroup=stations`, `syncInterval=6`, `timeScale=1`, `quality=medium`, `showOrbits=true`, `showLabels=true`, `enableMouse=true`. Wallpaper Engine sends only changed properties; merge partial updates.

See `AGENTS.md` for project invariants, `docs/DATA_SOURCES.md` for provider fair-use and `docs/WALLPAPER_ENGINE.md` for release steps.