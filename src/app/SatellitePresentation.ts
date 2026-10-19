import { createSatelliteSnapshot, sampleSatelliteTrajectory } from '../satellites/propagation';
import type { SatelliteDataset, SatelliteSnapshot, SatelliteTrajectory } from '../satellites/types';
import type { Quality, ViewMode } from '../settings/Settings';

export interface SatellitePresentationInput {
  readonly enabled: boolean;
  readonly viewMode: ViewMode;
  readonly showOrbits: boolean;
  readonly quality: Quality;
  readonly dataset: SatelliteDataset | null;
  readonly selectedNoradId: number | null;
  readonly at: Date;
  /** Monotonic wall milliseconds, independent of the displayed simulation UTC. */
  readonly now: number;
}
export interface SatellitePresentationState {
  readonly snapshot: SatelliteSnapshot | null;
  readonly trajectory: SatelliteTrajectory | null;
  readonly diagnostic: string | null;
}
interface Dependencies {
  createSnapshot: typeof createSatelliteSnapshot;
  sampleTrajectory: typeof sampleSatelliteTrajectory;
}
const EMPTY: SatellitePresentationState = Object.freeze({ snapshot: null, trajectory: null, diagnostic: null });
const POSITION_WALL_INTERVAL_MS = 250;
const POSITION_SIM_INTERVAL_MS = 1000;
const ARC_WALL_INTERVAL_MS = 2000;
/** At large time warps an old arc is hidden between bounded wall-time sampling operations. */
const ARC_MAX_SIM_DRIFT_MS = 60_000;

/**
 * Bounded app composition of already validated elements and local prediction functions.
 * Disabled/hidden views never invoke SGP4. A failed trail must never terminate the render loop.
 */
export class SatellitePresentation {
  private result: SatellitePresentationState = EMPTY;
  private dataset: SatelliteDataset | null = null;
  private selection: number | null = null;
  private quality: Quality = 'medium';
  private showOrbits = false;
  private lastPositionWall = -Infinity;
  private lastPositionEpoch = NaN;
  private lastArcWall = -Infinity;
  private lastArcEpoch = NaN;
  private arcDiagnostic: string | null = null;
  private readonly dependencies: Dependencies;

  constructor(dependencies: Partial<Dependencies> = {}) {
    this.dependencies = { createSnapshot: dependencies.createSnapshot ?? createSatelliteSnapshot,
      sampleTrajectory: dependencies.sampleTrajectory ?? sampleSatelliteTrajectory };
  }

  get state(): SatellitePresentationState { return this.result; }

  reset(): SatellitePresentationState {
    this.dataset = null;
    this.selection = null;
    this.lastPositionWall = this.lastArcWall = -Infinity;
    this.lastPositionEpoch = this.lastArcEpoch = NaN;
    this.arcDiagnostic = null;
    this.showOrbits = false;
    this.result = EMPTY;
    return this.result;
  }

  update(input: SatellitePresentationInput): SatellitePresentationState {
    if (!input.enabled || input.viewMode !== 'earth' || !input.dataset) return this.reset();
    const epoch = input.at.getTime();
    if (!Number.isFinite(epoch) || !Number.isFinite(input.now)) {
      this.reset();
      return this.commit(null, null, 'Satellite prediction requires a finite simulation UTC and monotonic clock.');
    }
    const changedDataset = input.dataset !== this.dataset;
    const changedSelection = input.selectedNoradId !== this.selection;
    const changedQuality = input.quality !== this.quality;
    const pathsEnabled = input.showOrbits && !this.showOrbits;
    this.dataset = input.dataset;
    this.selection = input.selectedNoradId;
    this.quality = input.quality;
    this.showOrbits = input.showOrbits;
    let snapshot = this.result.snapshot;
    let trajectory = this.result.trajectory;
    if (changedDataset || !Number.isFinite(this.lastPositionEpoch) || epoch !== this.lastPositionEpoch
      && (input.now - this.lastPositionWall >= POSITION_WALL_INTERVAL_MS
        || Math.abs(epoch - this.lastPositionEpoch) >= POSITION_SIM_INTERVAL_MS)) {
      this.lastPositionWall = input.now;
      this.lastPositionEpoch = epoch;
      try { snapshot = this.dependencies.createSnapshot(input.dataset, input.at); }
      catch (error) {
        this.lastArcEpoch = NaN;
        return this.commit(null, null, `Satellite prediction unavailable: ${message(error)}`);
      }
    }
    if (!snapshot) return this.result;
    const selectedState = snapshot.states.find(state => state.noradId === input.selectedNoradId);
    const selectedRecord = input.dataset.records.find(record => record.NORAD_CAT_ID === input.selectedNoradId);
    if (!input.showOrbits || !selectedState || !selectedRecord) {
      this.arcDiagnostic = null;
      this.lastArcEpoch = NaN;
      return this.commit(snapshot, null, null);
    }
    const forceArc = changedDataset || changedSelection || changedQuality || pathsEnabled;
    if (forceArc || !Number.isFinite(this.lastArcEpoch)
      || epoch !== this.lastArcEpoch && input.now - this.lastArcWall >= ARC_WALL_INTERVAL_MS) {
      this.lastArcWall = input.now;
      this.lastArcEpoch = epoch;
      this.arcDiagnostic = null;
      try { trajectory = this.dependencies.sampleTrajectory(selectedRecord, input.at, input.quality === 'low' ? 48 : 96); }
      catch (error) {
        trajectory = null;
        this.arcDiagnostic = `Predicted arc unavailable: ${message(error)}`;
      }
    } else if (trajectory && Math.abs(epoch - Date.parse(trajectory.epoch)) > ARC_MAX_SIM_DRIFT_MS) {
      trajectory = null;
    }
    return this.commit(snapshot, trajectory, this.arcDiagnostic);
  }

  private commit(snapshot: SatelliteSnapshot | null, trajectory: SatelliteTrajectory | null, diagnostic: string | null): SatellitePresentationState {
    if (snapshot !== this.result.snapshot || trajectory !== this.result.trajectory || diagnostic !== this.result.diagnostic) {
      this.result = Object.freeze({ snapshot, trajectory, diagnostic });
    }
    return this.result;
  }
}

function message(error: unknown): string { return error instanceof Error ? error.message : 'Local propagation failed.'; }
