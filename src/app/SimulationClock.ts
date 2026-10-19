/** UTC wall-clock anchored simulation; does not accumulate dropped-frame deltas. */
export class SimulationClock {
  private realAnchorMs: number;
  private simAnchorMs: number;
  private rate: number;

  constructor(nowMs: number = Date.now(), rate = 1) {
    this.realAnchorMs = nowMs;
    this.simAnchorMs = nowMs;
    this.rate = rate;
  }

  at(realNowMs: number = Date.now()): Date {
    return new Date(this.simAnchorMs + (realNowMs - this.realAnchorMs) * this.rate);
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
    this.realAnchorMs = realNowMs;
    this.simAnchorMs = realNowMs;
    this.rate = 1;
  }

  get timeScale(): number { return this.rate; }
}
