# Texture provenance

**Credit:** Planet, Sun, Moon and Saturn ring textures by [Solar System Scope / INOVE](https://www.solarsystemscope.com/textures/), licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). Original image bytes are unchanged. The wallpaper applies artistic lighting, exaggerated radii and compressed distances during rendering.

The creator's [texture page](https://www.solarsystemscope.com/textures/) was reviewed on **2026-10-19** and explicitly permits redistribution and adaptation under CC BY 4.0. The creator describes NASA-based imagery/elevation, enhanced colors and fictional fill in unmapped regions. These are static, edited planetary maps, not live imagery or precision terrain. Venus uses its cloud/atmosphere map rather than claiming its solid surface is visible.

| Bundled file | Purpose | Author | Original source | License |
|---|---|---|---|---|
| `2k_sun.jpg` | Sun surface | Solar System Scope / INOVE | [Source](https://www.solarsystemscope.com/textures/download/2k_sun.jpg) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `2k_mercury.jpg` | Mercury surface | Solar System Scope / INOVE | [Source](https://www.solarsystemscope.com/textures/download/2k_mercury.jpg) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `2k_venus_atmosphere.jpg` | Venus clouds | Solar System Scope / INOVE | [Source](https://www.solarsystemscope.com/textures/download/2k_venus_atmosphere.jpg) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `2k_earth_daymap.jpg` | Earth day surface | Solar System Scope / INOVE | [Source](https://www.solarsystemscope.com/textures/download/2k_earth_daymap.jpg) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `2k_mars.jpg` | Mars surface | Solar System Scope / INOVE | [Source](https://www.solarsystemscope.com/textures/download/2k_mars.jpg) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `2k_jupiter.jpg` | Jupiter surface | Solar System Scope / INOVE | [Source](https://www.solarsystemscope.com/textures/download/2k_jupiter.jpg) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `2k_saturn.jpg` | Saturn surface | Solar System Scope / INOVE | [Source](https://www.solarsystemscope.com/textures/download/2k_saturn.jpg) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `2k_saturn_ring_alpha.png` | Saturn radial ring strip with alpha | Solar System Scope / INOVE | [Source](https://www.solarsystemscope.com/textures/download/2k_saturn_ring_alpha.png) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `2k_uranus.jpg` | Uranus surface | Solar System Scope / INOVE | [Source](https://www.solarsystemscope.com/textures/download/2k_uranus.jpg) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `2k_neptune.jpg` | Neptune surface | Solar System Scope / INOVE | [Source](https://www.solarsystemscope.com/textures/download/2k_neptune.jpg) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `2k_moon.jpg` | Moon surface | Solar System Scope / INOVE | [Source](https://www.solarsystemscope.com/textures/download/2k_moon.jpg) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

All spherical maps are 2048×1024 JPEGs; the ring strip is a 2048×125 PNG. The 11 images total about 5 MiB. `provenance.json` records the author, original download URL, license, actual retrieval URL, dimensions, byte size and SHA-256 for every file.

Direct creator downloads returned HTTP 403 from the build environment. Unchanged originals were retrieved from the public [SolarSystem mirror](https://github.com/TanvirAhmedArnab/SolarSystem/tree/a949159a0050484634ebaf4e5124cfd17376bc49/SourceAssets/ThirdParty/Textures/SolarSystemScope) at pinned commit `a949159a0050484634ebaf4e5124cfd17376bc49`. Each downloaded image was checked against that commit's Git LFS SHA-256 pointer. The mirror is a retrieval location, not the authority for the license; the creator's page above is the licensing source. No mirror code or other assets were imported.

The star point field, radial Sun halo and corona shader are original project code, with no third-party bitmap. Earth's pole, spin and north-up/Greenwich texture mapping are calibrated with the local attitude model (UT1≈UTC, polar motion omitted). Other planet poles, lunar surface alignment and Sun lighting intensity remain illustrative; scientific frame/orbit positions come from the separate local ephemeris. No night-light or cloud texture was added. Keep this credit file and the linked license with distributed wallpaper assets.
