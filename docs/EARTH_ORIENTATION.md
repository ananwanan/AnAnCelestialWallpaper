# Calibrated Earth focus (M3)

Implemented on 2026-10-19. This describes the numerical and rendering contract; browser evidence and native Wallpaper Engine acceptance are recorded separately in `VALIDATION.md`.

## Coordinate and time contract

`createEarthViewSnapshot(solar)` consumes the same immutable `SolarSnapshot` used for planetary rendering. It returns Earth-centered EQJ/J2000 positions in **km**, with the same UTC `epoch`. The Moon vector is the existing Astronomy Engine `GeoMoon` vector multiplied by the exact AU definition, **149,597,870.7 km/AU**. Sun lighting uses the negative heliocentric Earth vector, normalized in EQJ. No extra ephemeris or network requests happen inside the renderer.

`createEarthOrientation(at)` constructs three unit vectors: the equatorial Greenwich meridian, 90° east equatorial meridian, and north pole. It first rotates the terrestrial meridians by Astronomy Engine's Greenwich Apparent Sidereal Time (GAST) into the **true equator/equinox of date (EQD)**, then applies `Rotation_EQD_EQJ`. This includes Earth spin, precession and nutation consistently. `ecefToEqj` and its inverse expose that orthonormal basis for the satellite frame service.

EQJ is already an equatorial frame. Adding another constant 23.44° tilt to the rendered Earth would double-count the obliquity: the planetary orbit is inclined relative to EQJ, while Earth's J2000 pole is near EQJ +Z. The calibrated basis is used in both Solar and Earth views. Other planet poles and lunar surface orientation remain illustrative.

The underlying astronomy library approximates **UT1 with UTC** and derives TT using its Delta-T model. We do not fetch IERS Earth orientation parameters and omit polar motion, celestial pole offsets, and subdaily tidal corrections. This is calibrated wallpaper orientation, with explicit limits, rather than an IERS/ITRF geodetic solution. UTC dates do not encode leap seconds as a separate JavaScript instant. Satellite conversion remains labeled an approximate prediction.

## Surface map alignment

The bundled licensed `2k_earth_daymap.jpg` is a static, north-up equirectangular map with Greenwich at its horizontal center and the antimeridian at its seam. Its imagery is edited and is not current weather or precision terrain.

Three.js `SphereGeometry` places the north pole at local +Y, `u = 0.5` on local +X, and increasing east longitude toward local −Z. The texture upload's normal `flipY` setting maps the top image row to `v = 1` (north). The surface basis is therefore:

| Sphere local axis | Earth-fixed direction | Rendered EQJ/Y-up direction |
|---|---|---|
| +X | Greenwich equator | mapped Greenwich basis |
| +Y | North pole | mapped north basis |
| +Z | 90° west equator | negative mapped east basis |

The global conversion is `(x, y, z) EQJ → (x, z, −y)`; it preserves handedness. The surface rotation is a proper quaternion with determinant +1. Tests run against actual SphereGeometry vertices and UVs, including the seam and both poles, and verify Greenwich/east/north without mirroring.

## Independent Earth/Moon scale and camera

Earth focus uses exactly **3 / 6371 scene units per km**, rather than the Solar view's logarithmic AU compression. Earth's mean sphere radius is 6371 km; the Moon's radius is 1737.4 km. Earth, Moon separation, lunar sampled orbit and artificial satellites all use the same km scale. Earth is spherical and terrain-neutral; oblateness, relief, eclipse shadows and lunar libration rendering are not part of this implementation.

The Earth close-up retains drag/zoom and a safe camera distance. The Earth–Moon overview camera fits the full lunar orbit around a stable Earth target, with an apogee margin. Its wide zoom range allows the physically distant Moon to be seen; the Moon is naturally outside the initial Earth close-up. The same ephemeris-generated geocentric trajectory is rendered at this physical scale. Camera travel, portrait/wide aspect changes, near/far bounds and return to Solar mode retain the existing controls and resource lifecycle.

The already licensed day map and a subtle original atmosphere shell are sufficient for M3. No extra cloud/night-light assets or requests were added. Illumination direction is astronomical; atmosphere scattering, ambient fill and photometric intensity are artistic. The Solar view continues to use exaggerated body radii, compressed planetary distances and its explicitly exaggerated Moon offset.

The focus globe and atmosphere use bounded 32/64/96 longitudinal segments for Low/Medium/High quality, separately from the Solar view's shared 24/40/64 sphere. Quality changes dispose both old sphere geometries before replacing them; they do not accumulate meshes or textures.

## Verification and references

`tests/earthOrientation.test.ts` compares all three basis axes at **2006-01-01 00:00 UT1** against the independent ERFA/SOFA `C2t06a` reference matrix (MJD 53736). The **5×10⁻⁶ rad (~1 arcsec)** bound accounts for the reference's nonzero polar motion, GCRS/J2000 frame bias and different TT assumptions. This is one known-epoch check, not a universal accuracy guarantee. Further tests cover orthonormality, invertibility in km, UTC rollover and eastward spin, absence of the spurious second obliquity, SphereGeometry UV calibration, shared epochs, Moon distance/radius ratios and Sun direction.

Primary references reviewed on 2026-10-19:

- [Astronomy Engine JavaScript API](https://github.com/cosinekitty/astronomy/blob/master/source/js/README.md): `SiderealTime`, `Rotation_EQD_EQJ`, `GeoMoon`, `AstroTime`; explicitly documents the UT1≈UTC assumption.
- [Three.js r186 SphereGeometry source](https://github.com/mrdoob/three.js/blob/r186/src/geometries/SphereGeometry.js): vertex and UV conventions, matching the installed Three.js release family.
- [ERFA reference test source](https://github.com/liberfa/erfa/blob/master/src/t_erfa_c.c): `t_c2t06a` matrix, time and pole parameters. ERFA is derived from the [IAU SOFA library](https://www.iausofa.org/2023-10-11c).
- [IERS Conventions Chapter 5](https://iers-conventions.obspm.fr/chapter5.php): terrestrial/celestial transformations and the Earth orientation effects omitted by this offline approximation.
- [Existing texture attribution](../public/textures/ATTRIBUTION.md): Solar System Scope / INOVE, CC BY 4.0.

Focused math/layout/renderer checks passed locally: **28 tests**, using `node node_modules/vitest/vitest.mjs run tests/earthOrientation.test.ts tests/visualLayout.test.ts tests/SatelliteLayer.test.ts`. `node node_modules/typescript/bin/tsc --noEmit` also passed during integration. Full production build/browser/native results belong in `VALIDATION.md`; these tests do not prove native FPS, pause or multi-hour stability.

An independent local development browser review also exercised 1080×1920 portrait and 3840×1080 (32:9), Earth close-up and Earth–Moon overview, return to Solar mode, all quality settings, and paused-time jumps from J2000 to 2100-12-31. The displayed epoch and orientation epoch matched exactly after each jump, Moon distance recomputed, all 11 bitmap assets loaded without errors, and console warning/error capture was empty. The remote provider was unconfigured in that development session. Captures are in the ignored local `artifacts/m3-review/` directory; this is browser/local-ephemeris evidence, independent from production API and native host acceptance.
