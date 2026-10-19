/** UTC wall-clock anchored simulation; does not accumulate dropped-frame deltas. */
function validEpoch(epochMs: number): void {
  if (!Number.isFinite(epochMs) || Math.abs(epochMs) > 8.64e15) throw new RangeError('Invalid UTC epoch');
}

export class SimulationClock {
  private realAnchorMs: number;
  private simAnchorMs: number;
  private rate: number;

  constructor(nowMs: number = Date.now(), rate = 1) {
    if (!Number.isFinite(nowMs) || !Number.isFinite(rate) || rate < 0 || rate > 86400) {
      throw new RangeError('Invalid simulation clock anchor or rate');
    }
    validEpoch(nowMs);
    this.realAnchorMs = nowMs;
    this.simAnchorMs = nowMs;
    this.rate = rate;
  }

  at(realNowMs: number = Date.now()): Date {
    validEpoch(realNowMs);
    const epoch = this.simAnchorMs + (realNowMs - this.realAnchorMs) * this.rate;
    validEpoch(epoch);
    return new Date(epoch);
  }

  setRate(rate: number, realNowMs: number = Date.now()): void {
    if (!Number.isFinite(rate) || rate < 0 || rate > 86400) {
      throw new RangeError('timeScale must be between 0 and 86400');
    }
    this.simAnchorMs = this.at(realNowMs).getTime();
    this.realAnchorMs = realNowMs;
    this.rate = rate;
  }

  reset(realNowMs: number = Date.now()): void {
    validEpoch(realNowMs);
    this.realAnchorMs = realNowMs;
    this.simAnchorMs = realNowMs;
    this.rate = 1;
  }

  /** Set the displayed UTC epoch while retaining the selected time scale. */
  setTime(at: Date, realNowMs: number = Date.now()): void {
    const epoch = at.getTime();
    validEpoch(epoch);
    validEpoch(realNowMs);
    this.simAnchorMs = epoch;
    this.realAnchorMs = realNowMs;
  }

  get timeScale(): number { return this.rate; }
}
