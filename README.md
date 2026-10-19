# AnAnCelestialWallpaper

**Three.js / WebGL 3D Solar System and Earth-orbit wallpaper for Wallpaper Engine.**

> **Status: M0 prototype, not Workshop-ready.** The included standalone browser preview is a locally calculated Solar System demo with a camera and view toggles. JPL multi-body synchronization, full satellite tracking, calibrated reference-frame conversion, production texture assets, and Wallpaper Engine host testing are planned milestones rather than completed features.

## Objectives

- 3D heliocentric Sun, eight planets, true depth, orbit lines, interactive camera and glow.
- Earth-focused view with optional **real** artificial satellites (ISS, Tiangong, GPS, later filtered Starlink), using CelesTrak OMM + local SGP4.
- Startup current-time ephemeris sync **once** when an endpoint is configured; local continuous evaluation; periodic solar sync at 1h/6h/24h.
- Strict CelesTrak refresh minimum **2h**, irrespective of planet sync selection; satellites OFF by default.
- Offline-first, no CDN scripts, low resource use; native Wallpaper Engine property listener, host FPS/pause handling.

## Quick start (development)

```bash
npm install
npm run dev
```

Open the Vite address. Build a static wallpaper:

```bash
npm run typecheck
npm run test
npm run build
```

Production static files are in `dist/`. In Wallpaper Engine use **Create Wallpaper** and import `dist/index.html` as a **Web wallpaper**; Wallpaper Engine copies it to its editor project folder. Configure host properties following `docs/WALLPAPER_ENGINE.md`. **Do not import the whole repo or node_modules.**

## Current prototype controls

- Left mouse drag: orbit camera. Mouse wheel: zoom.
- **S**: Solar System view; **E**: Earth focus (basic placeholder), **R**: reset camera; **O**: orbit lines.
- Top-right UI: view switch, orbit visibility and illustrative timeline speeds.

The local planet positions come from Astronomy Engine (heliocentric EQJ/J2000 vectors). Body sizes, orbital apparent spacing and textures are visually exaggerated and should not be used as physical size comparisons.

## Data contracts & caveats

- NASA Horizons: planned optional current snapshot/ephemeris sync. **No production ephemeris endpoint is deployed by this repository.** `VITE_EPHEMERIS_BASE_URL` is an optional future shared-cache provider. The local preview works without it. The sync adapter may query the configured service only; it does not silently make per-frame NASA requests.
- Artificial satellites: satellite.js/SGP4 is planned and must not be represented as fully implemented in this M0 preview. See `docs/ROADMAP.md`.
- CelesTrak rates: GP dataset updates roughly every two hours; large dataset polling too frequently can be blocked. See official usage policy.
- All assets must be local in the Workshop bundle, documented in `public/textures/ATTRIBUTION.md`.

## Documentation

- [Agent instructions](AGENTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Development roadmap](docs/ROADMAP.md)
- [Data providers and refresh](docs/DATA_SOURCES.md)
- [Wallpaper Engine integration](docs/WALLPAPER_ENGINE.md)

## Publishing via GitHub

Create an empty repository named `AnAnCelestialWallpaper` in your GitHub account (do not initialize README/license), then:

```bash
git init -b main
git add .
git commit -m "chore: initialize 3D celestial wallpaper"
git remote add origin https://github.com/ananwanan/AnAnCelestialWallpaper.git
git push -u origin main
```

The repository has **no license file yet** by design; decide source-code and third-party asset distribution terms before publication.