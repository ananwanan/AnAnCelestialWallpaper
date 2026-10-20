import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import { satelliteGroup, SatellitesGate } from '../src/satellites';
import { createSatelliteDataset, DAY_MS, HOUR_MS } from '../../../src/satellites/omm';
import { SYNTHETIC_GPS_OMM, SYNTHETIC_STATION_OMM } from '../../../tests/fixtures/satelliteReference';
import { SatelliteSync } from '../../../src/sync/SatelliteSync';

const NOW = Date.parse('2026-10-19T01:00:00Z');
function createGate(initial: Record<string, unknown> = {}) {
  const records = new Map(Object.entries(initial)); let ready: Promise<unknown> = Promise.resolve();
  const ctx = { storage: {
    get: vi.fn(async (key: string) => structuredClone(records.get(key))),
    put: vi.fn(async (key: string, value: unknown) => { records.set(key, structuredClone(value)); }),
  }, blockConcurrencyWhile: (callback: () => Promise<unknown>) => { ready = callback(); } };
  const env = { UPSTREAM_USER_AGENT: 'AnAnCelestialWallpaper/0.1.0 (+https://github.com/ananwanan/AnAnCelestialWallpaper)' };
  const gate = new SatellitesGate(ctx as unknown as DurableObjectState, env);
  return { gate, records, ready: () => ready, storage: ctx.storage };
}
const request = (group = 'stations') => new Request(`https://satellites.internal/api/satellites?group=${group}`);
const ok = (group = 'stations') => new Response(JSON.stringify([group === 'gps' ? SYNTHETIC_GPS_OMM : SYNTHETIC_STATION_OMM]), { headers: { 'Content-Type': 'application/json' } });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('shared CelesTrak source gate', () => {
  it('normalizes scoped allowlisted URLs once, with global 2h cache and durable reservations', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const fetch = vi.fn(async () => ok()); vi.stubGlobal('fetch', fetch);
    const { gate, records, ready, storage } = createGate(); await ready();
    const first = await gate.fetch(request()); expect(first.status).toBe(200); expect(first.headers.get('X-Satellite-Cache')).toBe('MISS');
    expect((await first.json()).records[0].NORAD_CAT_ID).toBe(25544);
    expect(fetch.mock.calls[0]![0]).toBe('https://celestrak.org/NORAD/elements/gp.php?GROUP=STATIONS&FORMAT=JSON');
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: 'manual', headers: { 'User-Agent': expect.stringContaining('AnAnCelestialWallpaper') } });
    const reserve = storage.put.mock.calls.find(([key]) => key === 'satellite-gate')![1] as { next: { stations: number } };
    expect(reserve.next.stations).toBe(NOW + 2 * HOUR_MS);
    expect((await gate.fetch(request())).headers.get('X-Satellite-Cache')).toBe('HIT');
    const restored = createGate(Object.fromEntries(records)); await restored.ready();
    expect((await restored.gate.fetch(request())).status).toBe(200); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('allows only stations and GPS-OPS, no open proxy parameters or unexpected methods', async () => {
    expect(satelliteGroup(new URL('https://x/api/satellites?group=gps'))).toBe('gps');
    for (const params of ['group=active', 'group=starlink', 'group=stations&url=https://evil.example', 'group=gps&group=gps', '']) expect(() => satelliteGroup(new URL(`https://x/api/satellites?${params}`))).toThrow();
    const { gate, ready } = createGate(); await ready();
    expect((await gate.fetch(new Request('https://x/api/satellites?group=stations', { method: 'POST' }))).status).toBe(405);
  });
  it('reports durable cooldowns without a source fetch, reservation or state mutation', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const state = { version: 1, next: { stations: NOW + HOUR_MS, gps: NOW + 2 * HOUR_MS }, failures: { stations: 1, gps: 2 }, blocked: null };
    const { gate, ready, records, storage } = createGate({ 'satellite-gate': state }); await ready();
    const status = () => gate.fetch(new Request('https://satellites.internal/api/satellites/status'));
    for (let i = 0; i < 2; i++) {
      const response = await status(); expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toMatchObject({ minimumRefreshSeconds: 7200, blocked: null, activeGroup: null,
        datasets: [{ group: 'stations', retryAfterSeconds: 3600, cachedRecords: 0, lastAttempt: null }, { group: 'gps', retryAfterSeconds: 7200, cachedRecords: 0 }] });
    }
    expect(records.get('satellite-gate')).toEqual(state); expect(storage.put).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect((await gate.fetch(new Request('https://satellites.internal/api/satellites/status?reset=true'))).status).toBe(400);
  });
  it.each([
    ['transport', () => Promise.reject(new Error('Connection refused.')), null],
    ['validation', async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } }), 200],
    ['http', async () => new Response('blocked', { status: 403 }), 403],
  ] as const)('persists bounded %s diagnostics without clearing reservations on restart', async (outcome, upstream, upstreamStatus) => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW); vi.stubGlobal('fetch', vi.fn(upstream));
    const { gate, ready, records } = createGate(); await ready();
    expect((await gate.fetch(request())).status).toBe(503);
    const restored = createGate(Object.fromEntries(records)); await restored.ready();
    const response = await restored.gate.fetch(new Request('https://satellites.internal/api/satellites/status'));
    expect((await response.json()).datasets[0]).toMatchObject({ failureCount: 1, retryAfterSeconds: expect.any(Number),
      lastAttempt: { startedAt: new Date(NOW).toISOString(), completedAt: new Date(NOW).toISOString(), outcome, upstreamStatus, message: expect.any(String) } });
    expect((records.get('satellite-gate') as { next: { stations: number } }).next.stations).toBeGreaterThanOrEqual(NOW + 2 * HOUR_MS);
  });
  it('does not turn a successful acquisition into failure when optional diagnostics cannot persist', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW); vi.stubGlobal('fetch', vi.fn(async () => ok()));
    const { gate, ready, storage, records } = createGate(); await ready();
    const put = storage.put.getMockImplementation()!;
    storage.put.mockImplementation(async (key, value) => { if (key.startsWith('diagnostic:')) throw new Error('TEST ONLY diagnostic storage failure'); await put(key, value); });
    const response = await gate.fetch(request()); expect(response.status).toBe(200); expect(response.headers.get('X-Satellite-Cache')).toBe('MISS');
    expect((records.get('satellite-gate') as { failures: { stations: number } }).failures.stations).toBe(0);
  });
  it('coalesces identical callers with bounded waiters and rejects a different group while pending', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    let complete!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(resolve => { complete = resolve; })); vi.stubGlobal('fetch', fetch);
    const { gate, ready } = createGate(); await ready(); const first = gate.fetch(request());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const waiters = Array.from({ length: 32 }, () => gate.fetch(request()));
    expect((await gate.fetch(request())).status).toBe(429); expect((await gate.fetch(request('gps'))).status).toBe(429);
    complete(ok()); const all = await Promise.all([first, ...waiters]); expect(all.every(r => r.status === 200)).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([301, 403, 429, 503])('halts all source querying after upstream HTTP %i, surviving restart', async status => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const fetch = vi.fn(async () => new Response('policy error', { status, headers: { 'Retry-After': '14400' } })); vi.stubGlobal('fetch', fetch);
    const { gate, ready, records } = createGate(); await ready();
    const response = await gate.fetch(request()); expect(response.status).toBe(503); expect(response.headers.get('X-Satellite-Blocked')).toBe('true');
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(14400);
    const restored = createGate(Object.fromEntries(records)); await restored.ready();
    expect((await restored.gate.fetch(request('gps'))).headers.get('X-Satellite-Blocked')).toBe('true'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps last valid elements cached while halting after provider policy errors', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const dataset = createSatelliteDataset([SYNTHETIC_STATION_OMM], 'stations', NOW - 3 * HOUR_MS);
    const fetch = vi.fn(async () => new Response('blocked', { status: 403 })); vi.stubGlobal('fetch', fetch);
    const { gate, ready } = createGate({ 'dataset:stations': dataset }); await ready();
    const response = await gate.fetch(request()); expect(response.status).toBe(200); expect(response.headers.get('X-Satellite-Cache')).toBe('STALE');
    expect(response.headers.get('X-Satellite-Blocked')).toBe('true'); expect(await response.json()).toEqual(dataset);
    await gate.fetch(request()); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds hanging transport to 15s and persists a >=2h transport failure cooldown', async () => {
    vi.useFakeTimers({ now: NOW });
    const fetch = vi.fn(() => new Promise<Response>(() => undefined)); vi.stubGlobal('fetch', fetch);
    const { gate, ready, records } = createGate(); await ready(); const pending = gate.fetch(request());
    await vi.advanceTimersByTimeAsync(15_000); const response = await pending;
    expect(response.status).toBe(503); expect(response.headers.get('X-Satellite-Blocked')).toBeNull(); expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(7200);
    const restored = createGate(Object.fromEntries(records)); await restored.ready();
    expect((await restored.gate.fetch(request())).status).toBe(429); expect(fetch).toHaveBeenCalledTimes(1);
    expect(records.get('diagnostic:stations')).toMatchObject({ outcome: 'timeout', upstreamStatus: null, durationMs: 15_000 });
  });
  it('rejects invalid/expired/unsupported source data without overwriting good cache', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const dataset = createSatelliteDataset([SYNTHETIC_STATION_OMM], 'stations', NOW - 3 * HOUR_MS);
    const fetch = vi.fn(async () => new Response(JSON.stringify([{ ...SYNTHETIC_STATION_OMM, REF_FRAME: 'ICRF' }]), { headers: { 'Content-Type': 'application/json' } })); vi.stubGlobal('fetch', fetch);
    const { gate, ready, records } = createGate({ 'dataset:stations': dataset }); await ready();
    const response = await gate.fetch(request()); expect(response.headers.get('X-Satellite-Cache')).toBe('STALE'); expect(records.get('dataset:stations')).toEqual(dataset);
    const expired = createGate({ 'dataset:stations': { ...dataset, retrievedAt: new Date(NOW - 8 * DAY_MS).toISOString() }, 'satellite-gate': { version: 99 } }); await expired.ready();
    expect((await expired.gate.fetch(request())).status).toBe(503); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects oversized source bodies before they can replace cached elements', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const dataset = createSatelliteDataset([SYNTHETIC_STATION_OMM], 'stations', NOW - 3 * HOUR_MS);
    const fetch = vi.fn(async () => new Response('x'.repeat(100 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } })); vi.stubGlobal('fetch', fetch);
    const { gate, ready, records } = createGate({ 'dataset:stations': dataset }); await ready();
    const response = await gate.fetch(request()); expect(response.headers.get('X-Satellite-Cache')).toBe('STALE');
    expect(records.get('dataset:stations')).toEqual(dataset); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds a hanging response body to the same overall timeout', async () => {
    vi.useFakeTimers({ now: NOW });
    const fetch = vi.fn(async () => new Response(new ReadableStream({ pull: () => new Promise(() => undefined), cancel: () => new Promise(() => undefined) }), { headers: { 'Content-Type': 'application/json' } })); vi.stubGlobal('fetch', fetch);
    const { gate, ready } = createGate(); await ready(); const pending = gate.fetch(request());
    await vi.advanceTimersByTimeAsync(15_000); expect((await pending).status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('exposes only normalized route with configured CORS and no user-controlled upstream', async () => {
    const fetch = vi.fn(async () => new Response('{}', { headers: { 'X-Satellite-Blocked': 'true' } }));
    const env = { ALLOWED_ORIGINS: 'null,http://127.0.0.1:4173', SATELLITES_GATE: { idFromName: () => 'satellite-singleton', get: () => ({ fetch }) } } as unknown as Env;
    const response = await worker.fetch(new Request('https://worker.example/api/satellites?group=gps', { headers: { Origin: 'null' } }), env);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('null'); expect(response.headers.get('Access-Control-Expose-Headers')).toContain('X-Satellite-Blocked');
    expect(String(fetch.mock.calls[0]?.[0].url)).toBe('https://satellites.internal/api/satellites?group=gps');
    expect((await worker.fetch(new Request('https://worker.example/api/satellites?group=active'), env)).status).toBe(400);
    expect((await worker.fetch(new Request('https://worker.example/api/satellites?group=gps', { headers: { Origin: 'https://evil.example' } }), env)).status).toBe(403);
    await worker.fetch(new Request('https://worker.example/api/satellites/status'), env);
    expect(String(fetch.mock.lastCall?.[0].url)).toBe('https://satellites.internal/api/satellites/status');
    expect((await worker.fetch(new Request('https://worker.example/api/satellites/status?reset=true'), env)).status).toBe(400);
    expect((await worker.fetch(new Request('https://worker.example/api/satellites/status', { headers: { Origin: 'https://evil.example' } }), env)).status).toBe(403);
  });
  it('keeps the wallpaper client contract compatible alongside read-only diagnostics', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const upstream = vi.fn(async () => ok()); vi.stubGlobal('fetch', upstream);
    const { gate, ready } = createGate(); await ready();
    const env = { ALLOWED_ORIGINS: 'null', SATELLITES_GATE: { idFromName: () => 'satellite-singleton', get: () => gate } } as unknown as Env;
    const diagnostics = () => worker.fetch(new Request('https://worker.example/api/satellites/status', { headers: { Origin: 'null' } }), env);
    expect((await (await diagnostics()).json()).datasets[0].cachedRecords).toBe(0); expect(upstream).not.toHaveBeenCalled();
    const records = new Map<string, string>();
    const sync = new SatelliteSync('https://worker.example', 1, {
      now: () => NOW, online: () => true, random: () => 0,
      storage: { getItem: key => records.get(key) ?? null, setItem: (key, value) => { records.set(key, value); }, removeItem: key => { records.delete(key); } },
      fetch: ((input: string | URL | Request, init?: RequestInit) => worker.fetch(new Request(input, init), env)) as typeof fetch,
    });
    sync.setEnabled(true); await sync.tick(); expect(sync.status.label).toBe('Live/Sync'); expect(sync.dataset?.records[0]?.NORAD_CAT_ID).toBe(25544);
    expect((await (await diagnostics()).json()).datasets[0]).toMatchObject({ cachedRecords: 1, lastAttempt: { outcome: 'success' } });
    await sync.tick(); expect(upstream).toHaveBeenCalledTimes(1);
  });
});
