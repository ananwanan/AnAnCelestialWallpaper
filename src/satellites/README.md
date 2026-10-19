# Opt-in satellite prediction

`omm.ts` validates scoped CelesTrak JSON orbital elements; `propagation.ts` evaluates `satellite.js` SGP4 at the displayed simulation UTC. Outputs retain Earth-centered TEME/km and convert through pseudo Earth-fixed axes into geocentric EQJ/km for the independent Earth scene. UT1≈UTC and omission of polar motion are explicit approximations.

`sync/SatelliteSync.ts` owns source access, cancellation, cooldowns and schema cache. The renderer only consumes immutable normalized snapshots. Tracking defaults off; no decorative or stale static satellite positions stand in for predictions.

See [source policy, epoch windows, endpoint deployment and reference tests](../../docs/SATELLITES.md).
