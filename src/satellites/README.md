# Satellite tracking module (M4 planned)

This folder is intentionally not populated with fabricated satellite motion in the M0 browser preview.

Implementation order: CelesTrak JSON OMM narrow groups -> `satellite.js` SGP4 -> tested TEME/ECEF/inertial transforms -> Earth-focus scene -> trails/labels/filtering -> minimum 2h source refresh and stale-status UI.

`showSatellites` is part of the Wallpaper Engine settings contract, default `false`. Until M4, toggling it does **not** imply real satellite positions are rendered.
