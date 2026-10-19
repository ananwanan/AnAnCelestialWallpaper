export interface PeriodicTaskPlatform {
  setTimer(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>;
  clearTimer(handle: ReturnType<typeof setTimeout>): void;
}

/** One bounded async operation at a time, with no polling timer while suspended. */
export class PeriodicTask {
  private suspended = true;
  private disposed = false;
  private pending = false;
  private rerun = false;
  private revision = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly task: () => Promise<void>,
    private readonly onSettled: () => void,
    private readonly intervalMs = 60_000,
    private readonly platform: PeriodicTaskPlatform = {
      setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
      clearTimer: handle => clearTimeout(handle),
    },
    private readonly onError: (error: unknown) => void = error => console.warn('Periodic task failed', error),
  ) {
    if (!Number.isFinite(intervalMs) || intervalMs < 1 || intervalMs > 2_147_483_647) throw new RangeError('Invalid periodic interval.');
  }

  setSuspended(suspended: boolean): void {
    if (this.disposed || this.suspended === suspended) return;
    this.suspended = suspended;
    this.revision++;
    this.cancelTimer();
    this.rerun = !suspended;
    if (!suspended) void this.run();
  }

  dispose(): void {
    this.disposed = true;
    this.rerun = false;
    this.cancelTimer();
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.platform.clearTimer(this.timer);
    this.timer = null;
  }

  private report(error: unknown): void {
    try { this.onError(error); }
    catch (handlerError) { console.warn('Periodic task error handler failed', handlerError); }
  }

  private async run(): Promise<void> {
    if (this.disposed || this.suspended || this.pending) return;
    this.pending = true;
    this.rerun = false;
    const revision = this.revision;
    const current = () => !this.disposed && !this.suspended && this.revision === revision;
    try {
      try { await this.task(); }
      catch (error) { if (current()) this.report(error); }
      if (current()) {
        try { this.onSettled(); }
        catch (error) { if (current()) this.report(error); }
      }
    } finally {
      this.pending = false;
      if (this.disposed || this.suspended) return;
      // Arbitrarily many pause/resume events during a request coalesce to one fresh check.
      if (this.rerun) { void this.run(); return; }
      this.timer = this.platform.setTimer(() => { this.timer = null; void this.run(); }, this.intervalMs);
    }
  }
}
