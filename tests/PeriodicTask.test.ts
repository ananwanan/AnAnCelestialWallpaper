import { afterEach, describe, expect, it, vi } from 'vitest';
import { PeriodicTask, type PeriodicTaskPlatform } from '../src/app/PeriodicTask';

function platform(): PeriodicTaskPlatform {
  return {
    setTimer: vi.fn((callback, milliseconds) => setTimeout(callback, milliseconds)),
    clearTimer: vi.fn(handle => clearTimeout(handle)),
  };
}
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('lifecycle-owned periodic async task', () => {
  it('starts suspended, checks once immediately on resume and schedules from completion', async () => {
    vi.useFakeTimers();
    const task = vi.fn(async () => {}), settled = vi.fn();
    const loop = new PeriodicTask(task, settled);
    loop.setSuspended(true);
    expect(task).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    loop.setSuspended(false); loop.setSuspended(false);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(1);
    loop.setSuspended(false);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2); expect(settled).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    loop.dispose();
  });

  it('clears the next timer throughout suspension and immediately rechecks on resume', async () => {
    vi.useFakeTimers();
    const task = vi.fn(async () => {}), settled = vi.fn(), timers = platform();
    const loop = new PeriodicTask(task, settled, 60_000, timers);
    loop.setSuspended(false); await vi.advanceTimersByTimeAsync(0);
    loop.setSuspended(true);
    expect(timers.clearTimer).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(task).toHaveBeenCalledTimes(1);
    loop.setSuspended(false);
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(1);
    loop.dispose();
  });

  it('never overlaps pending work or queues repeated unsuspend events', async () => {
    vi.useFakeTimers();
    const pending = deferred();
    const task = vi.fn(() => pending.promise), settled = vi.fn();
    const loop = new PeriodicTask(task, settled, 10);
    loop.setSuspended(false);
    for (let index = 0; index < 10; index++) loop.setSuspended(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(task).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    pending.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(1);
    loop.dispose();
  });

  it('suppresses completion while paused and starts fresh when resumed later', async () => {
    vi.useFakeTimers();
    const pending = deferred(); const task = vi.fn(() => pending.promise), settled = vi.fn();
    const loop = new PeriodicTask(task, settled);
    loop.setSuspended(false); loop.setSuspended(true);
    pending.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(settled).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    loop.setSuspended(false); await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(2); expect(settled).toHaveBeenCalledTimes(1);
    loop.dispose();
  });

  it('coalesces pause/resume during a pending request to one fresh task before publishing', async () => {
    vi.useFakeTimers();
    const old = deferred(), fresh = deferred();
    const task = vi.fn().mockImplementationOnce(() => old.promise).mockImplementationOnce(() => fresh.promise);
    const settled = vi.fn(); const loop = new PeriodicTask(task, settled);
    loop.setSuspended(false);
    for (let index = 0; index < 20; index++) { loop.setSuspended(true); loop.setSuspended(false); }
    expect(task).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    old.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(2); expect(settled).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    fresh.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(2); expect(settled).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(1);
    loop.dispose();
  });

  it('disposes pending work without publishing or starting another request when it settles', async () => {
    vi.useFakeTimers();
    const pending = deferred(); const task = vi.fn(() => pending.promise), settled = vi.fn(), error = vi.fn();
    const loop = new PeriodicTask(task, settled, 100, platform(), error);
    loop.setSuspended(false); loop.dispose(); loop.dispose(); loop.setSuspended(false);
    pending.reject(new Error('late failure')); await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1); expect(settled).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('disposes an armed timer and ignores later lifecycle changes', async () => {
    vi.useFakeTimers();
    const task = vi.fn(async () => {}), settled = vi.fn();
    const loop = new PeriodicTask(task, settled);
    loop.setSuspended(false); await vi.advanceTimersByTimeAsync(0); loop.dispose();
    loop.setSuspended(true); loop.setSuspended(false); await vi.advanceTimersByTimeAsync(86_400_000);
    expect(task).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it('handles rejection, publishes the settled status and continues at the normal interval', async () => {
    vi.useFakeTimers();
    const failure = new Error('bounded provider failure');
    const task = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined), settled = vi.fn(), error = vi.fn();
    const loop = new PeriodicTask(task, settled, 100, platform(), error);
    loop.setSuspended(false); await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledExactlyOnceWith(failure); expect(settled).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(task).toHaveBeenCalledTimes(2); expect(settled).toHaveBeenCalledTimes(2); expect(error).toHaveBeenCalledTimes(1);
    loop.dispose();
  });

  it('does not publish rejected work after suspension', async () => {
    vi.useFakeTimers();
    const pending = deferred(), error = vi.fn(), settled = vi.fn();
    const loop = new PeriodicTask(() => pending.promise, settled, 100, platform(), error);
    loop.setSuspended(false); loop.setSuspended(true); pending.reject(new Error('late'));
    await vi.advanceTimersByTimeAsync(0);
    expect(error).not.toHaveBeenCalled(); expect(settled).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    loop.dispose();
  });

  it('allows reentrant lifecycle changes from completion without duplicate timers', async () => {
    vi.useFakeTimers();
    const task = vi.fn(async () => {}); let loop: PeriodicTask;
    const settled = vi.fn(() => { if (settled.mock.calls.length === 1) { loop.setSuspended(true); loop.setSuspended(false); } });
    loop = new PeriodicTask(task, settled);
    loop.setSuspended(false); await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(2); expect(settled).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(1);
    loop.dispose();
  });

  it('allows disposal from an error callback without publishing or scheduling', async () => {
    vi.useFakeTimers();
    const settled = vi.fn(); let loop: PeriodicTask;
    loop = new PeriodicTask(async () => { throw new Error('failed'); }, settled, 100, platform(), () => loop.dispose());
    loop.setSuspended(false); await vi.advanceTimersByTimeAsync(0);
    expect(settled).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('catches completion/error-handler failures without dropping the scheduling lifecycle', async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = new Error('UI callback');
    const task = vi.fn(async () => {}), error = vi.fn(() => { throw new Error('logger'); });
    const loop = new PeriodicTask(task, () => { throw failure; }, 100, platform(), error);
    loop.setSuspended(false); await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledWith(failure); expect(warning).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(1);
    loop.dispose();
  });

  it.each([0, -1, NaN, Infinity, 2_147_483_648])('rejects unsafe timer interval %s', interval => {
    expect(() => new PeriodicTask(async () => {}, () => {}, interval)).toThrow(RangeError);
  });
});
