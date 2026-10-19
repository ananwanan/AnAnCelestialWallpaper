export interface RenderLoopPlatform {
  now(): number;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
  setTimer(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>;
  clearTimer(handle: ReturnType<typeof setTimeout>): void;
}

/** FPS admission uses monotonic time; astronomy always uses the separate UTC clock. */
export class RenderLoop {
  private frame: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastRendered = -Infinity;
  private suspended = true;
  private disposed = false;
  private inFrame = false;
  private fps = 30;

  constructor(private readonly render: () => void, private readonly platform: RenderLoopPlatform = {
    now: () => performance.now(), requestFrame: callback => requestAnimationFrame(callback),
    cancelFrame: handle => cancelAnimationFrame(handle), setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: handle => clearTimeout(handle),
  }) {}

  configure(fps: number, suspended: boolean): void {
    if (this.disposed) return;
    if (!Number.isFinite(fps) || fps <= 0) throw new RangeError('FPS must be positive.');
    const changed = this.suspended !== suspended || this.fps !== fps;
    this.fps = fps;
    this.suspended = suspended;
    if (changed) this.cancel();
    if (!suspended && !this.inFrame && this.frame === null && this.timer === null) {
      this.lastRendered = -Infinity;
      this.request();
    }
  }

  dispose(): void { this.disposed = true; this.cancel(); }

  private cancel(): void {
    if (this.frame !== null) this.platform.cancelFrame(this.frame);
    if (this.timer !== null) this.platform.clearTimer(this.timer);
    this.frame = null; this.timer = null;
  }

  private request(): void {
    if (this.disposed || this.suspended) return;
    this.frame = this.platform.requestFrame(() => {
      this.frame = null;
      if (this.disposed || this.suspended) return;
      this.inFrame = true;
      try {
        const now = this.platform.now();
        const period = 1000 / this.fps;
        if (now - this.lastRendered >= period - 0.1) {
          this.lastRendered = now;
          this.render();
        }
        if (this.disposed || this.suspended) return;
        const nextPeriod = 1000 / this.fps;
        this.timer = this.platform.setTimer(() => { this.timer = null; this.request(); }, Math.max(0, nextPeriod - (this.platform.now() - this.lastRendered) - 1));
      } finally {
        this.inFrame = false;
      }
    });
  }
}
