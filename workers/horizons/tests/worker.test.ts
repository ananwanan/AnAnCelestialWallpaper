import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { HorizonsGate, type Env } from '../src/index';
import { CACHE_SCHEMA_VERSION, CACHE_TTL_MS, MAX_REQUESTS_PER_HOUR, STALE_TTL_MS, UPSTREAM_TIMEOUT_MS, canonicalQuery } from '../src/policy';
import { VALID_BODY } from './fixture';

function createGate(initial: Record<string, unknown> = {}) {
  const records = new Map(Object.entries(initial));
  let ready: Promise<unknown> = Promise.resolve();
  const storage = {
    get: vi.fn(async (key: string) => structuredClone(records.get(key))),
    put: vi.fn(async (key: string, value: unknown) => { records.set(key, structuredClone(value)); }),
    delete: vi.fn(async (keys: string[]) => { keys.forEach((key) => records.delete(key)); }),
    list: vi.fn(async ({ prefix, limit }: { prefix: string; limit: number }) => new Map([...records].filter(([key]) => key.startsWith(prefix)).slice(0, limit).map(([key, value]) => [key, structuredClone(value)]))),
  };
  const ctx = { storage, blockConcurrencyWhile: (callback: () => Promise<unknown>) => { ready = callback(); } };
  const env = { UPSTREAM_USER_AGENT: 'AnAnCelestialWallpaper/0.1.0 (+https://github.com/ananwanan/AnAnCelestialWallpaper)' } as Env;
  const gate = new HorizonsGate(ctx as unknown as DurableObjectState, env);
  return { gate, records, storage, ready: () => ready };
}
const day = 'START_TIME=2026-10-19&STOP_TIME=2026-10-20';
const request = (extra = '') => new Request(`https://worker.example/api/horizons.api?${day}&${extra}`);
const upstreamOk = () => new Response(VALID_BODY, { headers: { 'Content-Type': 'application/json' } });
async function keyFor(request: Request) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalQuery(new URL(request.url))));
  return `cache:${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')}`;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('singleton Horizons gate', () => {
  it('validates once upstream, caches globally and uses a fixed URL without redirects', async () => {
    const now = Date.UTC(2026, 9, 19);
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const fetch = vi.fn(async () => upstreamOk()); vi.stubGlobal('fetch', fetch);
    const { gate, ready } = createGate(); await ready();
    const first = await gate.fetch(request());
    const second = await gate.fetch(request('COMMAND=399'));
    expect(first.headers.get('X-Horizons-Cache')).toBe('MISS');
    expect(second.headers.get('X-Horizons-Cache')).toBe('HIT');
    expect(await first.text()).toBe(VALID_BODY);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toMatch(/^https:\/\/ssd\.jpl\.nasa\.gov\/api\/horizons\.api\?/);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: 'manual', headers: { 'User-Agent': expect.stringContaining('AnAnCelestialWallpaper/0.1.0') } });
  });
  it('coalesces identical in-flight queries and rejects distinct queries instead of queueing', async () => {
    let complete!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; })); vi.stubGlobal('fetch', fetch);
    const { gate, ready } = createGate(); await ready();
    const first = gate.fetch(request());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const same = gate.fetch(request('COMMAND=399'));
    const distinct = await gate.fetch(request('COMMAND=499'));
    expect(distinct.status).toBe(429); expect(distinct.headers.get('Retry-After')).toBe('5');
    complete(upstreamOk());
    for (const response of await Promise.all([first, same])) expect(await response.text()).toBe(VALID_BODY);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('persists an in-flight timeout reservation and enforces spacing after success', async () => {
    const now = Date.UTC(2026, 9, 19); vi.spyOn(Date, 'now').mockReturnValue(now);
    const fetch = vi.fn(async () => upstreamOk()); vi.stubGlobal('fetch', fetch);
    const { gate, ready, storage } = createGate(); await ready();
    await gate.fetch(request());
    const reservations = storage.put.mock.calls.filter(([key]) => key === 'gate').map(([, value]) => value as { nextAllowedAt: number });
    expect(reservations[0]!.nextAllowedAt).toBe(now + UPSTREAM_TIMEOUT_MS + 2_000);
    expect((await gate.fetch(request('COMMAND=499'))).status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('aborts a hanging upstream request at 15 seconds and backs off without retrying', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 19) });
    let signal: AbortSignal | undefined;
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = init.signal!;
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })); vi.stubGlobal('fetch', fetch);
    const { gate, ready } = createGate(); await ready();
    const pending = gate.fetch(request());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS);
    const response = await pending;
    expect(signal?.aborted).toBe(true);
    expect(response.status).toBe(502);
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(60);
    expect((await gate.fetch(request())).status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('caps identical in-flight waiters instead of retaining unbounded promises', async () => {
    let complete!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; })); vi.stubGlobal('fetch', fetch);
    const { gate, ready, storage } = createGate(); await ready();
    const first = gate.fetch(request());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const waiters = Array.from({ length: 32 }, () => gate.fetch(request()));
    await vi.waitFor(() => expect(storage.get).toHaveBeenCalledTimes(34));
    expect((await gate.fetch(request())).status).toBe(429);
    complete(upstreamOk());
    const responses = await Promise.all([first, ...waiters]);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('gives provider 403 a global one-hour cooldown even without Retry-After', async () => {
    const now = Date.UTC(2026, 9, 19); vi.spyOn(Date, 'now').mockReturnValue(now);
    const fetch = vi.fn(async () => new Response('blocked', { status: 403 })); vi.stubGlobal('fetch', fetch);
    const { gate, ready } = createGate(); await ready();
    const response = await gate.fetch(request());
    expect(response.status).toBe(502);
    expect(response.headers.get('Retry-After')).toBe('3600');
    expect((await gate.fetch(request('COMMAND=499'))).status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('persists Retry-After and returns last good data with explicit stale headers', async () => {
    const now = Date.UTC(2026, 9, 19); vi.spyOn(Date, 'now').mockReturnValue(now);
    const key = await keyFor(request());
    const { gate, ready, records } = createGate({ [key]: { schemaVersion: CACHE_SCHEMA_VERSION, body: VALID_BODY, retrievedAt: now - CACHE_TTL_MS - 1 } }); await ready();
    const fetch = vi.fn(async () => new Response('blocked', { status: 429, headers: { 'Retry-After': '7200' } })); vi.stubGlobal('fetch', fetch);
    const response = await gate.fetch(request());
    expect(response.headers.get('X-Horizons-Cache')).toBe('STALE');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Retry-After')).toBe('7200');
    expect(response.headers.get('Warning')).toContain('stale');
    expect((records.get('gate') as { nextAllowedAt: number }).nextAllowedAt).toBe(now + 7_200_000);
    const restarted = createGate(Object.fromEntries(records)); await restarted.ready();
    expect((await restarted.gate.fetch(request('COMMAND=499'))).status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid upstream success rather than caching it and backs off without retries', async () => {
    const fetch = vi.fn(async () => new Response('{"error":"bad"}', { headers: { 'Content-Type': 'application/json' } })); vi.stubGlobal('fetch', fetch);
    const { gate, records, ready } = createGate(); await ready();
    const response = await gate.fetch(request());
    expect(response.status).toBe(502); expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(60);
    expect((await gate.fetch(request())).status).toBe(429);
    expect([...records.keys()].filter((key) => key.startsWith('cache:'))).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects expired/corrupt caches and preserves the hourly budget across restarts', async () => {
    const now = Date.UTC(2026, 9, 19); vi.spyOn(Date, 'now').mockReturnValue(now);
    const fetch = vi.fn(async () => upstreamOk()); vi.stubGlobal('fetch', fetch);
    const key = await keyFor(request());
    for (const entry of [{ schemaVersion: CACHE_SCHEMA_VERSION, body: VALID_BODY, retrievedAt: now - STALE_TTL_MS }, { schemaVersion: CACHE_SCHEMA_VERSION, body: 'broken', retrievedAt: now - 1 }]) {
      const { gate, ready } = createGate({ [key]: entry, gate: { schemaVersion: CACHE_SCHEMA_VERSION, hourStart: now, requests: MAX_REQUESTS_PER_HOUR, nextAllowedAt: 0, failures: 0 } }); await ready();
      expect((await gate.fetch(request())).status).toBe(429);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('fails closed on corrupt persisted allowance rather than granting fresh requests', async () => {
    const fetch = vi.fn(async () => upstreamOk()); vi.stubGlobal('fetch', fetch);
    const { gate, ready } = createGate({ gate: { schemaVersion: CACHE_SCHEMA_VERSION, hourStart: 0, requests: -100, nextAllowedAt: 0, failures: -1 } }); await ready();
    expect((await gate.fetch(request())).status).toBe(429); expect(fetch).not.toHaveBeenCalled();
  });
  it('caps cache storage at 128 entries and expires old cache keys', async () => {
    const now = Date.UTC(2026, 9, 19); vi.spyOn(Date, 'now').mockReturnValue(now);
    const fetch = vi.fn(async () => upstreamOk()); vi.stubGlobal('fetch', fetch);
    const initial: Record<string, unknown> = {};
    for (let index = 0; index < 128; index++) initial[`cache:${index}`] = { schemaVersion: CACHE_SCHEMA_VERSION, body: VALID_BODY, retrievedAt: now - index - 1 };
    const { gate, records, ready } = createGate(initial); await ready();
    await gate.fetch(request());
    expect([...records.keys()].filter((key) => key.startsWith('cache:'))).toHaveLength(128);
    expect(records.has('cache:127')).toBe(false);
  });
  it('does not double-subtract cached age from the HTTP freshness lifetime', async () => {
    const now = Date.UTC(2026, 9, 19); vi.spyOn(Date, 'now').mockReturnValue(now);
    const key = await keyFor(request());
    const { gate, ready } = createGate({ [key]: { schemaVersion: CACHE_SCHEMA_VERSION, body: VALID_BODY, retrievedAt: now - 3 * 3_600_000 } }); await ready();
    const response = await gate.fetch(request());
    expect(response.headers.get('Age')).toBe('10800');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=21600');
  });
});

describe('public routing and CORS', () => {
  function env() {
    const fetch = vi.fn(async () => new Response(VALID_BODY));
    const get = vi.fn(() => ({ fetch }));
    return { fetch, get, bindings: { ALLOWED_ORIGINS: 'null,http://localhost:5173', HORIZONS_GATE: { get, idFromName: vi.fn(() => 'singleton') } } as unknown as Env };
  }
  it('answers health and preflight without contacting the gate', async () => {
    const { bindings, get } = env();
    expect((await worker.fetch(new Request('https://worker.example/health'), bindings)).status).toBe(200);
    const response = await worker.fetch(new Request('https://worker.example/api/horizons.api', { method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Method': 'GET' } }), bindings);
    expect(response.status).toBe(204); expect(response.headers.get('Access-Control-Allow-Origin')).toBe('null'); expect(get).not.toHaveBeenCalled();
  });
  it('allows configured origins without credentials or wildcard, and permits CLI no-Origin requests', async () => {
    const { bindings, fetch } = env();
    const response = await worker.fetch(new Request('https://worker.example/api/horizons.api', { headers: { Origin: 'http://localhost:5173' } }), bindings);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(response.headers.has('Access-Control-Allow-Credentials')).toBe(false);
    expect((await worker.fetch(new Request('https://worker.example/api/horizons.api'), bindings)).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects unknown origins, arbitrary URL proxies, request bodies and methods before forwarding', async () => {
    const { bindings, get } = env();
    const cases = [
      [new Request('https://worker.example/api/horizons.api', { headers: { Origin: 'https://evil.example' } }), 403],
      [new Request('https://worker.example/api/horizons.api?url=https://evil.example'), 400],
      [new Request('https://worker.example/api/horizons.api?COMMAND=399&COMMAND=499'), 400],
      [new Request('https://worker.example/api/horizons.api', { method: 'POST', body: '{}' }), 405],
      [new Request('https://worker.example/api/horizons.api', { headers: { 'Content-Length': '5' } }), 400],
      [new Request('https://worker.example/arbitrary/path'), 404],
    ] as const;
    for (const [request, status] of cases) expect((await worker.fetch(request, bindings)).status).toBe(status);
    expect(get).not.toHaveBeenCalled();
  });
});
