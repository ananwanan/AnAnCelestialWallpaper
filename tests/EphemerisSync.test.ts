import { afterEach, describe, expect, it, vi } from 'vitest';
import { EphemerisSync } from '../src/sync/EphemerisSync';
import { SNAPSHOT_MAX_AGE_MS, compareEphemerisSnapshot, validateEphemerisSnapshot } from '../src/astronomy/ephemerisSnapshot';
import { snapshotFixture } from './ephemerisFixture';

const NOW = Date.UTC(2026, 9, 19, 12);
const HOUR = 3_600_000;
function storageFixture() {
  const values = new Map<string, string>();
  return { values, getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value); }), removeItem: vi.fn((key: string) => { values.delete(key); }) };
}
function response(now: number, cache = 'MISS') { return new Response(JSON.stringify(snapshotFixture(now)), { headers: { 'Content-Type': 'application/json', 'X-Horizons-Cache': cache } }); }
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('strict normalized snapshot contract', () => {
  it('requires complete Sun-centered ICRF states at one explicit UTC epoch', () => {
    expect(validateEphemerisSnapshot(snapshotFixture(NOW), NOW).states).toHaveLength(9);
    const mutable = () => JSON.parse(JSON.stringify(snapshotFixture(NOW)));
    for (const change of [
      (s: ReturnType<typeof mutable>) => { s.schemaVersion = 2; }, (s: ReturnType<typeof mutable>) => { s.referenceFrame = 'EQJ/J2000'; },
      (s: ReturnType<typeof mutable>) => { s.units = 'km'; }, (s: ReturnType<typeof mutable>) => { s.origin = 'Earth'; },
      (s: ReturnType<typeof mutable>) => { s.states.pop(); }, (s: ReturnType<typeof mutable>) => { s.states[8] = s.states[0]; },
      (s: ReturnType<typeof mutable>) => { s.states[0].positionAU.x = NaN; }, (s: ReturnType<typeof mutable>) => { s.states[0].epoch = '2026-10-19T00:00:00Z'; },
      (s: ReturnType<typeof mutable>) => { s.epoch = '2026-10-19T12:00:00+08:00'; }, (s: ReturnType<typeof mutable>) => { s.validUntil = '2026-10-26T00:00:00Z'; },
      (s: ReturnType<typeof mutable>) => { s.retrievedAt = new Date(NOW + HOUR).toISOString(); }, (s: ReturnType<typeof mutable>) => { s.apiVersion = '1.3'; },
    ]) { const snapshot = mutable(); change(snapshot); expect(() => validateEphemerisSnapshot(snapshot, NOW)).toThrow(); }
    expect(() => validateEphemerisSnapshot(snapshotFixture(NOW), NOW + SNAPSHOT_MAX_AGE_MS + 1)).toThrow('expired');
  });
  it('compares at the snapshot epoch with an explicit approximate frame/model tolerance', () => {
    const snapshot = snapshotFixture(NOW);
    const local = vi.fn((id: string) => snapshot.states.find((state) => state.id === id)!.positionAU);
    expect(compareEphemerisSnapshot(snapshot, local).passed).toBe(true);
    expect(local).toHaveBeenCalledWith('Moon', new Date(NOW));
    const bad = compareEphemerisSnapshot(snapshot, () => ({ x: 0, y: 0, z: 0 }));
    expect(bad.passed).toBe(false); expect(bad.note).toContain('not identical');
  });
});

describe('wall-clock ephemeris synchronization', () => {
  it('makes zero requests when unconfigured or given an invalid URL', async () => {
    const fetch = vi.fn();
    for (const base of [undefined, '', 'http://remote.example', 'https://user:secret@example.com', 'https://example.com?token=secret']) {
      const sync = new EphemerisSync(base, 6, { fetch, now: () => NOW, storage: null }); await sync.tick();
      expect(sync.status.label).toBe('Local prediction');
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('performs one startup operation at real UTC even when rendering a time-warped date', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => response(NOW));
    const sync = new EphemerisSync('https://example.com/', 6, { fetch, now: () => NOW, storage: null });
    await Promise.all([sync.tick(new Date('2040-01-01T00:00:00Z')), sync.tick(), sync.tick()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]![0])).toBe(`https://example.com/api/ephemeris?at=${encodeURIComponent(new Date(NOW).toISOString())}`);
    expect(sync.status.label).toBe('Live/Sync'); expect(sync.snapshot?.states).toHaveLength(9);
  });
  it.each([1, 6, 24] as const)('schedules %ih refresh by wall clock without per-frame requests', async (interval) => {
    let now = NOW; const fetch = vi.fn(async () => response(now));
    const sync = new EphemerisSync('https://example.com', interval, { fetch, now: () => now, storage: null });
    await sync.tick(); now += interval * HOUR - 1; await sync.tick(); expect(fetch).toHaveBeenCalledTimes(1);
    now++; await sync.tick(); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('applies interval changes without resetting previous successful time', async () => {
    let now = NOW; const fetch = vi.fn(async () => response(now));
    const sync = new EphemerisSync('https://example.com', 6, { fetch, now: () => now, storage: null });
    await sync.tick(); now += HOUR; sync.setIntervalHours(1); await sync.tick(); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('keeps last good data on failure, honors Retry-After and returns Cached', async () => {
    let now = NOW; let blocked = false;
    const fetch = vi.fn(async () => blocked ? new Response('rate limit', { status: 429, headers: { 'Retry-After': '7200' } }) : response(now));
    const sync = new EphemerisSync('https://example.com', 1, { fetch, now: () => now, random: () => 0, storage: null });
    await sync.tick(); const previous = sync.snapshot; blocked = true; now += HOUR; await sync.tick();
    expect(sync.snapshot).toBe(previous); expect(sync.status.label).toBe('Cached');
    now += HOUR; await sync.tick(); expect(fetch).toHaveBeenCalledTimes(2);
    now += HOUR; await sync.tick(); expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('restores a schema-versioned cache but still attempts one current-time startup sync', async () => {
    const storage = storageFixture();
    const first = new EphemerisSync('https://example.com', 6, { fetch: async () => response(NOW), now: () => NOW, storage }); await first.tick();
    const fetch = vi.fn(async () => { throw new Error('offline'); });
    const restored = new EphemerisSync('https://example.com', 6, { fetch, now: () => NOW + HOUR, storage, random: () => 0 });
    expect(restored.status.label).toBe('Cached'); await restored.tick(); expect(fetch).toHaveBeenCalledTimes(1); expect(restored.snapshot?.epoch).toBe(new Date(NOW).toISOString());
  });
  it('rejects incompatible/corrupt/expired browser cache and tolerates disabled storage', async () => {
    for (const value of ['not json', JSON.stringify({ schemaVersion: 2 }), JSON.stringify({ schemaVersion: 1, endpoint: 'https://example.com/api/ephemeris', snapshot: snapshotFixture(NOW - SNAPSHOT_MAX_AGE_MS - 1) })]) {
      const storage = storageFixture(); storage.values.set('anan:ephemeris:v1:https://example.com/api/ephemeris', value);
      const sync = new EphemerisSync('https://example.com', 6, { now: () => NOW, storage }); expect(sync.snapshot).toBeNull(); expect(storage.removeItem).toHaveBeenCalledTimes(1);
    }
    const storage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('blocked'); } };
    const sync = new EphemerisSync('https://example.com', 6, { fetch: async () => response(NOW), now: () => NOW, storage }); await sync.tick(); expect(sync.state).toBe('synced');
  });
  it('retains an offline cached comparison for 24h, then expires it without fetching', async () => {
    let now = NOW; let online = true; const fetch = vi.fn(async () => response(now));
    const sync = new EphemerisSync('https://example.com', 24, { fetch, now: () => now, online: () => online, random: () => 0, storage: null });
    await sync.tick(); online = false; now += 23 * HOUR; await sync.tick(); expect(sync.snapshot).not.toBeNull(); expect(sync.status.label).toBe('Cached');
    now += HOUR + 1; await sync.tick(); expect(sync.snapshot).toBeNull(); expect(sync.status.label).toBe('Local prediction'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects partial data and wrong epochs without replacing last good snapshot', async () => {
    let now = NOW; let invalid = false;
    const fetch = vi.fn(async () => invalid ? response(NOW) : response(now));
    const sync = new EphemerisSync('https://example.com', 1, { fetch, now: () => now, storage: null });
    await sync.tick(); const previous = sync.snapshot; now += HOUR; invalid = true; await sync.tick(); expect(sync.snapshot).toBe(previous); expect(sync.status.detail).toContain('epoch');
  });
  it('aborts pending work on dispose and ignores late responses', async () => {
    let complete!: (value: Response) => void;
    const fetch = vi.fn((_url: string | URL | Request, _init?: RequestInit) => new Promise<Response>((resolve) => { complete = resolve; }));
    const sync = new EphemerisSync('https://example.com', 6, { fetch, now: () => NOW, storage: null });
    const pending = sync.tick(); sync.dispose(); complete(response(NOW)); await pending; await sync.tick();
    expect(sync.snapshot).toBeNull(); expect((fetch.mock.calls[0]![1]?.signal as AbortSignal).aborted).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('aborts a hanging body at the 90s complete-operation timeout', async () => {
    vi.useFakeTimers({ now: NOW });
    const cancel = vi.fn();
    const fetch = vi.fn(async () => new Response(new ReadableStream({ pull() {}, cancel }), { headers: { 'Content-Type': 'application/json' } }));
    const sync = new EphemerisSync('https://example.com', 6, { fetch, now: Date.now, random: () => 0, storage: null });
    const pending = sync.tick(); await vi.advanceTimersByTimeAsync(90_000); await pending;
    expect(cancel).toHaveBeenCalledTimes(1); expect(sync.state).toBe('failed'); expect(sync.status.pending).toBe(false);
  });
  it('cancels a late hanging body when the request was already disposed', async () => {
    let complete!: (value: Response) => void;
    const cancel = vi.fn();
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; }));
    const sync = new EphemerisSync('https://example.com', 6, { fetch, now: () => NOW, storage: null });
    const pending = sync.tick(); sync.dispose();
    complete(new Response(new ReadableStream({ pull() {}, cancel }), { headers: { 'Content-Type': 'application/json' } }));
    await pending; expect(cancel).toHaveBeenCalledTimes(1); expect(sync.snapshot).toBeNull();
  });
  it('fails closed on oversized responses', async () => {
    const fetch = vi.fn(async () => new Response(' '.repeat(33 * 1024), { headers: { 'Content-Type': 'application/json' } }));
    const sync = new EphemerisSync('https://example.com', 6, { fetch, now: () => NOW, storage: null }); await sync.tick(); expect(sync.state).toBe('failed'); expect(sync.snapshot).toBeNull();
  });
  it('reports a known offline connection immediately without waiting for the refresh interval', async () => {
    let online = true; const fetch = vi.fn(async () => response(NOW));
    const sync = new EphemerisSync('https://example.com', 6, { fetch, now: () => NOW, online: () => online, storage: null });
    await sync.tick(); expect(sync.status.label).toBe('Live/Sync');
    online = false;
    expect(sync.status.label).toBe('Cached'); expect(sync.state).toBe('cached'); expect(sync.status.detail).toContain('Offline');
    expect(sync.snapshot).not.toBeNull(); expect(fetch).toHaveBeenCalledTimes(1);
    online = true; expect(sync.status.detail).not.toContain('Offline');
  });
  it('expires the visible reference after a long paused period with no scheduler ticks', async () => {
    let now = NOW; const fetch = vi.fn(async () => response(now)); const storage = storageFixture();
    const sync = new EphemerisSync('https://example.com', 24, { fetch, now: () => now, storage });
    await sync.tick(); now += SNAPSHOT_MAX_AGE_MS + 1;
    expect(sync.snapshot).toBeNull(); expect(sync.status.label).toBe('Local prediction'); expect(sync.state).toBe('local');
    expect(storage.removeItem).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('retains an explicit stale fallback but retries after source cooldown rather than a full 24h success interval', async () => {
    let now = NOW; let stale = true;
    const fetch = vi.fn(async () => {
      if (!stale) return response(now);
      const snapshot = { ...snapshotFixture(now), retrievedAt: new Date(now - 7 * HOUR).toISOString() };
      return new Response(JSON.stringify(snapshot), { headers: { 'Content-Type': 'application/json', 'X-Horizons-Cache': 'STALE', 'Retry-After': '3600' } });
    });
    const sync = new EphemerisSync('https://example.com', 24, { fetch, now: () => now, random: () => 0, storage: null });
    await sync.tick(); expect(sync.status.label).toBe('Cached'); expect(sync.status.detail).toContain('Stale');
    expect(sync.status.nextAttemptAt).toBe(new Date(NOW + HOUR).toISOString());
    now += HOUR - 1; await sync.tick(); expect(fetch).toHaveBeenCalledTimes(1);
    now++; stale = false; await sync.tick(); expect(fetch).toHaveBeenCalledTimes(2); expect(sync.status.label).toBe('Live/Sync');
  });
  it('handles HTTP errors even when cancelling their body never resolves', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const fetch = vi.fn(async () => new Response(new ReadableStream({ pull() {}, cancel }), { status: 429, headers: { 'Retry-After': '3600' } }));
    const sync = new EphemerisSync('https://example.com', 6, { fetch, now: () => NOW, storage: null });
    await sync.tick(); expect(sync.state).toBe('failed'); expect(sync.status.pending).toBe(false);
    expect(sync.status.nextAttemptAt).toBe(new Date(NOW + HOUR).toISOString()); expect(cancel).toHaveBeenCalledTimes(1);
  });
});
