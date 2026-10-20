# AnAnCelestialWallpaper

**Offline-capable Three.js / WebGL solar-system wallpaper for Wallpaper Engine.**

M0–M3 and the M4 satellite pipeline are implemented. Earth orientation, texture alignment, independent Earth/Moon scale and opt-in SGP4 tracking have explicit tested contracts. Native editor preview, independent playback and desktop rendering now work from the migrated ASCII project path. The final desktop build has native host-property, 15 FPS cap and pause/resume evidence; its optional settings drawer uses HTML listboxes and has passed native opening/selection checks. **Native acceptance remains partial:** offline operation, desktop-icon/fullscreen behavior, the full display/quality matrix and a two-hour resource soak remain open. Real satellite acquisition awaits a cooldown-safe service follow-up. This is not yet a Workshop-ready release. See [validation evidence and remaining gates](docs/VALIDATION.md).

## Run and build

Requires Node.js 22.12 or newer.

```bash
npm ci
npm run dev
```

```bash
npm run typecheck
npm test
npm run build
npm run preview
```

`dist/` is the complete static wallpaper: scripts, fonts supplied by the system and all texture files work without a CDN. Import **`dist/index.html`** as a Web wallpaper in the Wallpaper Engine editor; the editor manages its project files. Use an ASCII project-directory name: the former em-dash directory was misencoded by a native launch route. The existing local project is now `D:\SteamLibrary\steamapps\common\wallpaper_engine\projects\myprojects\anan-celestial-wallpaper`. Do not import the repository or `node_modules`. Import/update instructions, the backed-up relocation helper and native acceptance boundaries are in [Wallpaper Engine integration](docs/WALLPAPER_ENGINE.md).

After building, run `./scripts/package-wallpaper.ps1` to create `artifacts/AnAnCelestialWallpaper-web.zip` and a SHA-256 build manifest. The ZIP is a local test import bundle; its `project.json` must be created by the Wallpaper Engine editor. Runtime library licenses are included in `public/THIRD_PARTY_NOTICES.txt` and texture credits in `public/textures/ATTRIBUTION.md`.

## Current features and controls

- Textured Sun, eight planets and Moon; Sun glow/corona, Saturn rings, subtle stars and inclined ephemeris-sampled paths.
- Single-language Sun, planet and Moon labels and runtime controls in English, Simplified Chinese or Traditional Chinese. **Language** (`language`) defaults to `auto`, following the language preferences exposed by the browser/Wallpaper Engine; unsupported or unavailable preferences fall back to English. Choose a language in the host property panel or optional desktop drawer; it updates the scene and UI without a reload. The language setting does not translate Wallpaper Engine's editor property captions; those belong to the imported project metadata.
- Camera drag/wheel, smooth overview/inner/outer presets, calibrated Earth close-up and physical Earth–Moon overview; labels avoid each other and the HUD.
- Wallpaper Engine's property panel controls views, cameras, labels, paths, mouse interaction, quality, UTC/speed, satellite selection and remote-comparison cadence. **在桌面显示设置控件** defaults OFF; enable it for the optional **显示与时间** drawer. Its HTML listboxes support mouse, arrow/Home/End keys, Enter/Space selection and Escape/Tab dismissal. HTTP browser development keeps its fallback. [Update an existing editor import](docs/WALLPAPER_ENGINE.md#build-and-editor-import) with the backed-up property/resource migration helper.
- The upper-left identity overlay is removed. **显示时间与数据状态栏** (`showStatusBar`, default OFF), available in host properties and the optional drawer, independently shows the lower-left UTC, rate and provenance footer. Scene labels and satellite details retain their own controls.
- When desktop controls and the status bar are enabled, footer pause freezes simulation time and resumes the last positive rate; **回到现在** resets to current UTC at 1×. Host pause suspends rendering and comparison polling while the wall-clock simulation catches up on resume.
- With desktop controls enabled: **S** Solar System, **E** Earth, **R** reset camera, **O** paths, **L** labels, **Space** simulation pause/resume, **Esc** close settings. Hidden controls disable these shortcuts so desktop typing cannot change the wallpaper.
- Opt-in **显示预测卫星** with ISS/Tiangong or GPS groups, satellite selection, NORAD ID/OMM epoch/age/altitude, and cyan recent / gold future predicted arcs. Disabled by default; disabling aborts requests and clears propagation/draw work. A configured shared GP service is required for fresh data.

The Solar view compresses orbital distances (`26 × ln(1 + distanceAU)`), exaggerates body sizes and expands the geocentric Moon offset 70×. Earth focus uses a separate uniform km scale for Earth, Moon and satellites. Earth's pole, spin and Greenwich texture alignment use a local sidereal-time/precession/nutation model; UT1≈UTC and omitted polar motion limit precision. Other bodies' poles and lunar surface orientation remain illustrative. See [Earth calibration](docs/EARTH_ORIENTATION.md).

## Local astronomy and optional Horizons comparison

The scene always uses local Astronomy Engine heliocentric EQJ/J2000 positions at the displayed simulation time. Moon placement uses Earth plus a separately computed geocentric Moon vector.

The public Cloudflare service is deployed at [horizons.ananwanan.cc](https://horizons.ananwanan.cc/health). It provides both constrained raw Horizons output and a real normalized `/api/ephemeris?at=<UTC ISO>` route for eight planets plus Moon. The production configuration contains only this public service URL:

```dotenv
VITE_EPHEMERIS_BASE_URL=https://horizons.ananwanan.cc
```

Set the **service base**, not `/api/horizons.api`. A startup operation requests current real UTC once; later requests follow the selected wall-clock cadence. Time warp never causes per-frame NASA calls. The Worker caches and serializes upstream access; the browser validates metadata, caches usable comparisons and backs off on failure. A cold nine-body request may take tens of seconds; local rendering starts immediately.

`Live/Sync` and `Cached` refer to the remote **comparison**, not the rendered trajectory. Remote ICRF and local EQJ axes are closely aligned but are not silently treated as identical. The recorded JPL fixture and documented tolerances provide a model sanity check, not research/navigation accuracy. Offline state remains `Local prediction` or a clearly identified cached comparison.

For a fully offline build, set `VITE_EPHEMERIS_BASE_URL=` in ignored `.env.production.local` and rebuild. The development server has no remote endpoint unless one is configured for that mode. See [provider contract and deployment](docs/HORIZONS_PROXY.md).

## Scope and assets

`showSatellites` defaults to false. `satellite.js` 7.1.0 propagates validated scoped CelesTrak OMM at the simulation epoch. TEME→pseudo Earth-fixed→EQJ retains documented approximations; the UI labels predictions accordingly and refuses propagation far outside each source epoch. Client and shared Worker persist ≥2-hour source refresh reservations, including failures, reloads and toggles. Never configure a nonexistent GP service; [SATELLITES.md](docs/SATELLITES.md) records deployment and provider details. Optional Starlink, night-light/cloud layers, full device/performance profiling and Workshop release remain later work.

All eleven bundled texture files are credited to Solar System Scope / INOVE under CC BY 4.0, with per-file URLs and SHA-256 provenance in [texture attribution](public/textures/ATTRIBUTION.md). The maps include the creator's edited colors and fill for unmapped regions. Source-code licensing still requires an owner decision; texture licensing does not license repository code.

## Validation and documentation

**GitHub Actions CI remains intentionally paused (2026-10-19).** Run local checks before considering changes verified. The archived workflow must not be restored without owner authorization; see [CI policy](docs/CI.md).

- [Current validation and acceptance boundaries](docs/VALIDATION.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data sources and scientific limits](docs/DATA_SOURCES.md)
- [Earth orientation and texture calibration](docs/EARTH_ORIENTATION.md)
- [Satellite data, frame and freshness policy](docs/SATELLITES.md)
- [Cloudflare Horizons API](docs/HORIZONS_PROXY.md)
- [Wallpaper Engine integration](docs/WALLPAPER_ENGINE.md)
- [Agent instructions](AGENTS.md)
