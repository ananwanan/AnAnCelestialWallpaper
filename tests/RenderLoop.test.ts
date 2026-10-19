import { describe, expect, it, vi } from 'vitest';
import { RenderLoop, type RenderLoopPlatform } from '../src/app/RenderLoop';

type TimerHandle = ReturnType<typeof setTimeout>;

/** Manual browser scheduler: RAFs run only on a supplied display frame. */
function scheduler() {
  let now = 0;
  let nextHandle = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, { callback: () => void; due: number }>();
  const platform: RenderLoopPlatform = {
    now: () => now,
    requestFrame: vi.fn(callback => { const handle = nextHandle++; frames.set(handle, callback); return handle; }),
    cancelFrame: vi.fn(handle => { frames.delete(handle); }),
    setTimer: vi.fn((callback, delay) => {
      const handle = nextHandle++;
      timers.set(handle, { callback, due: now + delay });
      return handle as unknown as TimerHandle;
    }),
    clearTimer: vi.fn(handle => { timers.delete(handle as unknown as number); }),
  };
  function elapse(to: number) {
    while (true) {
      const next = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
      if (!next || next[1].due > to) break;
      now = next[1].due;
      timers.delete(next[0]);
      next[1].callback();
    }
    now = to;
  }
  function frame(at: number) {
    elapse(at);
    const ready = [...frames.values()];
    frames.clear();
    for (const callback of ready) callback(now);
  }
  return { platform, frames, timers, elapse, frame };
}

describe('render loop lifecycle and host FPS', () => {
  it('owns no RAF or timer while paused, including cancellation of RAF handle zero', () => {
    const host = scheduler(); const render = vi.fn();
    const loop = new RenderLoop(render, host.platform);
    expect(host.frames.size + host.timers.size).toBe(0);
    loop.configure(30, false);
    expect(host.frames.size).toBe(1);
    loop.configure(30, true);
    expect(host.platform.cancelFrame).toHaveBeenCalledWith(0);
    expect(host.frames.size + host.timers.size).toBe(0);
    host.frame(60_000);
    expect(render).not.toHaveBeenCalled();
    loop.configure(30, false); host.frame(60_000);
    expect(render).toHaveBeenCalledTimes(1);
    expect(host.timers.size).toBe(1);
    loop.configure(30, true);
    expect(host.frames.size + host.timers.size).toBe(0);
  });

  it('does not duplicate work when the same host settings are repeatedly delivered', () => {
    const host = scheduler(); const render = vi.fn();
    const loop = new RenderLoop(render, host.platform);
    loop.configure(30, false); loop.configure(30, false);
    expect(host.frames.size).toBe(1);
    host.frame(0);
    loop.configure(30, false); loop.configure(30, false);
    expect(host.frames.size).toBe(0);
    expect(host.timers.size).toBe(1);
    host.frame(34);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it.each([1, 15, 24, 30, 60])('never admits display frames above the configured %s FPS cadence', (fps) => {
    const host = scheduler(); const rendered: number[] = [];
    const loop = new RenderLoop(() => { rendered.push(host.platform.now()); }, host.platform);
    loop.configure(fps, false);
    for (let at = 0; at <= 2_000; at += 5) host.frame(at);
    expect(rendered[0]).toBe(0);
    expect(rendered.length).toBeLessThanOrEqual(1 + 2 * fps);
    expect(rendered.length).toBeGreaterThanOrEqual(Math.floor(2 * fps * 0.7));
    for (let index = 1; index < rendered.length; index++) {
      expect(rendered[index]! - rendered[index - 1]!).toBeGreaterThanOrEqual(1000 / fps - 0.1);
    }
    expect(host.frames.size + host.timers.size).toBe(1);
  });

  it('renders once after a 24-hour host suspension without catch-up loops', () => {
    const host = scheduler(); const render = vi.fn();
    const loop = new RenderLoop(render, host.platform);
    loop.configure(30, false); host.frame(0);
    loop.configure(30, true); host.elapse(86_400_000);
    expect(host.frames.size + host.timers.size).toBe(0);
    loop.configure(30, false); host.frame(86_400_000);
    expect(render).toHaveBeenCalledTimes(2);
    expect(host.frames.size + host.timers.size).toBe(1);
  });

  it('can reconfigure during a render without starting two scheduling chains', () => {
    const host = scheduler();
    let loop: RenderLoop;
    const rendered: number[] = [];
    loop = new RenderLoop(() => {
      rendered.push(host.platform.now());
      loop.configure(10, false);
    }, host.platform);
    loop.configure(30, false); host.frame(0);
    expect(host.frames.size).toBe(0);
    expect(host.timers.size).toBe(1);
    host.frame(50);
    expect(rendered).toEqual([0]);
    host.frame(100);
    expect(rendered).toEqual([0, 100]);
    expect(host.frames.size + host.timers.size).toBe(1);
  });

  it('can pause or dispose from inside rendering without scheduling a successor', () => {
    for (const dispose of [false, true]) {
      const host = scheduler();
      let loop: RenderLoop;
      loop = new RenderLoop(() => { if (dispose) loop.dispose(); else loop.configure(30, true); }, host.platform);
      loop.configure(30, false); host.frame(0);
      expect(host.frames.size + host.timers.size).toBe(0);
    }
  });

  it('disposes a pending timer and makes future configure calls inert', () => {
    const host = scheduler(); const render = vi.fn();
    const loop = new RenderLoop(render, host.platform);
    loop.configure(30, false); host.frame(0);
    loop.dispose(); loop.dispose(); loop.configure(60, false);
    expect(host.frames.size + host.timers.size).toBe(0);
    host.frame(60_000);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, NaN, Infinity])('rejects invalid FPS %s without creating work', (fps) => {
    const host = scheduler(); const loop = new RenderLoop(vi.fn(), host.platform);
    expect(() => loop.configure(fps, false)).toThrow(RangeError);
    expect(host.frames.size + host.timers.size).toBe(0);
  });
});
