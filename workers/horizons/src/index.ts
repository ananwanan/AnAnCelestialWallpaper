import {
  CACHE_SCHEMA_VERSION, CACHE_TTL_MS, MAX_CACHE_ENTRIES, MAX_COALESCED_REQUESTS,
  MAX_REQUESTS_PER_HOUR, MAX_RESPONSE_BYTES, MIN_UPSTREAM_SPACING_MS, STALE_TTL_MS,
  UPSTREAM_TIMEOUT_MS, UPSTREAM_URL, PolicyError, boundedText, canonicalQuery,
  errorResponse, retryAfterMs, validatePayload,
} from './policy';
import { EPHEMERIS_IDS, validateEphemerisSnapshot } from '../../../src/astronomy/ephemerisSnapshot';
import { bodyQuery, dayStart, normalizedEpoch, normalizedSnapshot, parseHorizonsSeries, type BatchResult, type HorizonsSample } from './ephemeris';
import { satelliteGroup } from './satellites';
export { SatellitesGate } from './satellites';

export interface Env {
  HORIZONS_GATE: DurableObjectNamespace;
  SATELLITES_GATE: DurableObjectNamespace;
  ALLOWED_ORIGINS: string;
  UPSTREAM_USER_AGENT: string;
}

interface CacheEntry {
  schemaVersion: number;
  body: string;
  retrievedAt: number;
}
interface GateState {
  schemaVersion: number;
  hourStart: number;
  requests: number;
  nextAllowedAt: number;
  failures: number;
}
const HOUR_MS = 3_600_000;

function cachedResponse(entry: CacheEntry, status: 'HIT' | 'MISS' | 'STALE', now: number, retryMs = 0): Response {
  const age = Math.max(0, now - entry.retrievedAt);
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Horizons-Cache': status,
    'X-Horizons-Retrieved-At': new Date(entry.retrievedAt).toISOString(),
    'X-Horizons-Source': UPSTREAM_URL,
    'Age': String(Math.floor(age / 1000)),
    'Cache-Control': status === 'STALE' ? 'no-store' : `public, max-age=${CACHE_TTL_MS / 1000}`,
  });
  if (status === 'STALE') headers.set('Warning', '110 horizons-proxy "Response is stale"');
  if (retryMs > 0) headers.set('Retry-After', String(Math.max(1, Math.ceil(retryMs / 1000))));
  return new Response(entry.body, { headers });
}

function withCors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  headers.set('Vary', 'Origin');
  headers.set('Access-Control-Expose-Headers', 'X-Horizons-Cache, X-Horizons-Retrieved-At, X-Horizons-Source, X-Satellite-Cache, X-Satellite-Retrieved-At, X-Satellite-Source, X-Satellite-Blocked, Age, Retry-After, Warning');
  if (origin !== null) headers.set('Access-Control-Allow-Origin', origin);
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const allowed = new Set(env.ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean));
    if (origin !== null && !allowed.has(origin)) return errorResponse('Origin is not allowed.', 403);
    const finish = (response: Response) => withCors(response, origin);
    try {
      const url = new URL(request.url);
      if (!['/api/horizons.api', '/api/ephemeris', '/api/satellites', '/api/satellites/status', '/health'].includes(url.pathname)) return finish(errorResponse('Not found.', 404));
      if (request.method === 'OPTIONS') {
        const method = request.headers.get('Access-Control-Request-Method');
        if (method !== 'GET' || request.headers.get('Access-Control-Request-Headers')) {
          return finish(errorResponse('Only simple GET requests are supported.', 403));
        }
        return finish(new Response(null, { status: 204, headers: { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' } }));
      }
      if (request.method !== 'GET') {
        const response = errorResponse('Only GET is supported.', 405);
        response.headers.set('Allow', 'GET, OPTIONS');
        return finish(response);
      }
      if (request.body !== null || Number(request.headers.get('Content-Length')) > 0) return finish(errorResponse('Request bodies are not supported.', 400));
      if (url.pathname === '/api/satellites' || url.pathname === '/api/satellites/status') {
        if (url.pathname === '/api/satellites/status' && url.search) throw new PolicyError('Satellite status does not accept query parameters.');
        const group = url.pathname === '/api/satellites' ? satelliteGroup(url) : null;
        const gate = env.SATELLITES_GATE.get(env.SATELLITES_GATE.idFromName('celestrak-global-v1'));
        return finish(await gate.fetch(new Request(`https://satellites.internal${group ? `/api/satellites?group=${group}` : '/api/satellites/status'}`)));
      }
      if (url.pathname === '/health') {
        return finish(new Response(JSON.stringify({ status: 'ok', service: 'AnAnCelestialWallpaper Horizons proxy', upstream: UPSTREAM_URL, apiVersion: '1.2', endpoint: '/api/horizons.api', normalizedEphemeris: true, normalizedEndpoint: '/api/ephemeris?at=<UTC ISO>', comparisonOnly: true }), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }));
      }
      const at = url.pathname === '/api/ephemeris' ? normalizedEpoch(url) : null;
      const query = at === null ? canonicalQuery(url) : null;
      // All callers, all Cloudflare locations share ONE gate, not one object per URL/IP.
      const gate = env.HORIZONS_GATE.get(env.HORIZONS_GATE.idFromName('horizons-global-v1'));
      if (url.pathname === '/api/ephemeris') {
        return finish(await gate.fetch(new Request(`https://horizons.internal/api/ephemeris?at=${encodeURIComponent(new Date(at!).toISOString())}`)));
      }
      return finish(await gate.fetch(new Request(`https://horizons.internal/api/horizons.api?${query}`)));
    } catch (error) {
      if (error instanceof PolicyError) return finish(errorResponse(error.message, error.status));
      console.error('Horizons proxy unavailable', error instanceof Error ? error.message : 'unknown error');
      return finish(errorResponse('Proxy temporarily unavailable.', 503, 60_000));
    }
  },
} satisfies ExportedHandler<Env>;

/** SQLite-backed singleton; KV API stores the bounded cache and rate state. */
export class HorizonsGate implements DurableObject {
  private gate: GateState = { schemaVersion: CACHE_SCHEMA_VERSION, hourStart: 0, requests: 0, nextAllowedAt: 0, failures: 0 };
  private active: { key: string; promise: Promise<Response>; waiters: number } | null = null;
  private batchActive: { key: number; promise: Promise<BatchResult | Response>; waiters: number } | null = null;

  constructor(private readonly ctx: DurableObjectState, private readonly env: Env) {
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<GateState>('gate');
      const now = Date.now();
      if (stored?.schemaVersion === CACHE_SCHEMA_VERSION && Number.isFinite(stored.nextAllowedAt) && stored.nextAllowedAt >= 0
          && stored.nextAllowedAt <= now + 24 * 24 * HOUR_MS + HOUR_MS
          && Number.isFinite(stored.hourStart) && stored.hourStart >= 0 && stored.hourStart <= now
          && Number.isInteger(stored.requests) && stored.requests >= 0 && stored.requests <= MAX_REQUESTS_PER_HOUR
          && Number.isInteger(stored.failures) && stored.failures >= 0 && stored.failures <= 8) this.gate = stored;
      else if (stored !== undefined) {
        // Corrupt persisted allowance fails closed instead of resetting an abuse budget.
        this.gate = { schemaVersion: CACHE_SCHEMA_VERSION, hourStart: now, requests: MAX_REQUESTS_PER_HOUR, nextAllowedAt: now + HOUR_MS, failures: 0 };
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET') return errorResponse('Only GET is supported.', 405);
    if (new URL(request.url).pathname === '/api/ephemeris') return this.fetchNormalized(new URL(request.url));
    const query = canonicalQuery(new URL(request.url));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(query));
    const key = `cache:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    const now = Date.now();
    const stored = await this.ctx.storage.get<CacheEntry>(key);
    let cached = stored?.schemaVersion === CACHE_SCHEMA_VERSION && typeof stored.body === 'string' && stored.body.length <= MAX_RESPONSE_BYTES
      && Number.isFinite(stored.retrievedAt) && stored.retrievedAt <= now && now - stored.retrievedAt < STALE_TTL_MS ? stored : undefined;
    if (cached) { try { validatePayload(cached.body); } catch { cached = undefined; } }
    if (cached && now - cached.retrievedAt < CACHE_TTL_MS) return cachedResponse(cached, 'HIT', now);
    const unavailable = (reason: string, status: number, retry: number) => cached
      ? cachedResponse(cached, 'STALE', now, retry) : errorResponse(reason, status, retry);
    if (this.batchActive) return unavailable('A shared multi-body Horizons query is in progress. Retry later.', 429, 20_000);
    if (this.active) {
      if (this.active.key === key && this.active.waiters < MAX_COALESCED_REQUESTS) {
        this.active.waiters++;
        return (await this.active.promise).clone();
      }
      return unavailable('Another Horizons query is in progress. Retry later.', 429, 5_000);
    }
    if (now < this.gate.nextAllowedAt) return unavailable('Horizons request cooldown is active.', 429, this.gate.nextAllowedAt - now);
    if (now - this.gate.hourStart >= HOUR_MS) { this.gate.hourStart = now; this.gate.requests = 0; }
    if (this.gate.requests >= MAX_REQUESTS_PER_HOUR) return unavailable('Hourly upstream request budget exhausted.', 429, this.gate.hourStart + HOUR_MS - now);

    // Assign before yielding so no second cache miss can start another upstream request.
    const operation = this.fetchUpstream(query, key, cached, now);
    const active = { key, promise: operation, waiters: 0 };
    this.active = active;
    try { return (await operation).clone(); }
    finally { if (this.active === active) this.active = null; }
  }

  private async fetchUpstream(query: string, key: string, cached: CacheEntry | undefined, startedAt: number, validate?: (body: string) => void): Promise<Response> {
    this.gate.requests++;
    // The durable reservation survives object restarts; failed requests consume budget too.
    this.gate.nextAllowedAt = startedAt + UPSTREAM_TIMEOUT_MS + MIN_UPSTREAM_SPACING_MS;
    await this.ctx.storage.put('gate', { ...this.gate });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('Horizons timeout'), UPSTREAM_TIMEOUT_MS);
    let providerCooldown = 0;
    try {
      const userAgent = this.env.UPSTREAM_USER_AGENT;
      if (!userAgent || userAgent.length > 256 || /[\r\n]/.test(userAgent)) throw new Error('Invalid upstream User-Agent configuration.');
      const response = await fetch(`${UPSTREAM_URL}?${query}`, {
        method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: { 'Accept': 'application/json', 'User-Agent': userAgent },
      });
      providerCooldown = retryAfterMs(response.headers.get('Retry-After'), Date.now());
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 403 || response.status === 429) providerCooldown = Math.max(providerCooldown, HOUR_MS);
        throw new Error(`Horizons returned HTTP ${response.status}.`);
      }
      if (!response.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
        await response.body?.cancel(); throw new Error('Horizons returned an unexpected content type.');
      }
      const body = await boundedText(response, controller.signal);
      validatePayload(body);
      validate?.(body);
      const now = Date.now();
      const entry: CacheEntry = { schemaVersion: CACHE_SCHEMA_VERSION, body, retrievedAt: now };
      await this.pruneCache(key, now);
      await this.ctx.storage.put(key, entry);
      this.gate.failures = 0;
      this.gate.nextAllowedAt = Math.max(startedAt + MIN_UPSTREAM_SPACING_MS, now + providerCooldown);
      await this.ctx.storage.put('gate', { ...this.gate });
      return cachedResponse(entry, 'MISS', now);
    } catch (error) {
      const now = Date.now();
      this.gate.failures = Math.min(8, this.gate.failures + 1);
      const backoff = Math.min(HOUR_MS, 60_000 * 2 ** (this.gate.failures - 1));
      const delay = Math.max(providerCooldown, Math.floor(backoff * (1 + Math.random() * 0.2)));
      this.gate.nextAllowedAt = now + delay;
      await this.ctx.storage.put('gate', { ...this.gate });
      console.warn('Horizons upstream request failed', error instanceof Error ? error.message : 'unknown error');
      return cached && now - cached.retrievedAt < STALE_TTL_MS
        ? cachedResponse(cached, 'STALE', now, delay)
        : errorResponse('Horizons is temporarily unavailable; retry after the indicated cooldown.', 502, delay);
    } finally { controller.abort('Horizons operation finished'); clearTimeout(timeout); }
  }

  private async fetchNormalized(url: URL): Promise<Response> {
    const at = normalizedEpoch(url);
    const start = dayStart(at);
    const respond = (result: BatchResult | Response): Response => {
      if (result instanceof Response) return result.clone();
      const snapshot = validateEphemerisSnapshot(normalizedSnapshot(result, at));
      const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'X-Horizons-Cache': result.cache, 'X-Horizons-Retrieved-At': snapshot.retrievedAt, 'X-Horizons-Source': UPSTREAM_URL,
        'Age': String(Math.max(0, Math.floor((Date.now() - Date.parse(snapshot.retrievedAt)) / 1000))) });
      if (result.retryMs > 0) headers.set('Retry-After', String(Math.max(1, Math.ceil(result.retryMs / 1000))));
      if (result.cache === 'STALE') headers.set('Warning', '110 horizons-proxy "Response is stale"');
      return new Response(JSON.stringify(snapshot), { headers });
    };
    if (this.batchActive) {
      if (this.batchActive.key !== start || this.batchActive.waiters >= MAX_COALESCED_REQUESTS) return errorResponse('Another shared Horizons batch is in progress.', 429, 20_000);
      this.batchActive.waiters++;
      return respond(await this.batchActive.promise);
    }
    if (this.active) return errorResponse('A Horizons source request is in progress.', 429, 5_000);
    const operation = this.buildBatch(start);
    const active = { key: start, promise: operation, waiters: 0 };
    this.batchActive = active;
    try { return respond(await operation); }
    finally { if (this.batchActive === active) this.batchActive = null; }
  }

  private async buildBatch(start: number): Promise<BatchResult | Response> {
    const prepared = await Promise.all(EPHEMERIS_IDS.map(async (id) => {
      const query = bodyQuery(id, start);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(query));
      const key = `cache:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
      const cached = await this.ctx.storage.get<CacheEntry>(key);
      let samples: readonly HorizonsSample[] | null = null;
      if (cached?.schemaVersion === CACHE_SCHEMA_VERSION && typeof cached.body === 'string' && cached.body.length <= MAX_RESPONSE_BYTES
          && Number.isFinite(cached.retrievedAt) && cached.retrievedAt <= Date.now() && Date.now() - cached.retrievedAt < STALE_TTL_MS) {
        try { samples = parseHorizonsSeries(cached.body, id, start); } catch { /* A raw response may be valid but unsuitable for normalized ICRF/UT data. */ }
      }
      return { id, query, key, cached: samples ? cached : undefined, samples };
    }));
    const sources = prepared.filter((entry) => entry.samples).map((entry) => ({ id: entry.id, samples: entry.samples!, retrievedAt: entry.cached!.retrievedAt }));
    const staleFallback = (message: string, status: number, retryMs: number): BatchResult | Response => sources.length === EPHEMERIS_IDS.length
      ? { entries: sources, cache: 'STALE', retryMs } : errorResponse(message, status, retryMs);
    let now = Date.now();
    const missing = prepared.filter((entry) => !entry.cached || now - entry.cached.retrievedAt >= CACHE_TTL_MS);
    if (missing.length === 0) return { entries: sources, cache: 'HIT', retryMs: 0 };
    if (now - this.gate.hourStart >= HOUR_MS) { this.gate.hourStart = now; this.gate.requests = 0; }
    if (this.gate.requests + missing.length > MAX_REQUESTS_PER_HOUR) return staleFallback('Insufficient shared upstream budget for a complete nine-body snapshot.', 429, this.gate.hourStart + HOUR_MS - now);
    const deadline = now + 75_000;
    const completed = new Map(sources.map((entry) => [entry.id, entry]));
    for (const entry of missing) {
      now = Date.now();
      const wait = this.gate.nextAllowedAt - now;
      if (wait > MIN_UPSTREAM_SPACING_MS || this.gate.failures > 0 && wait > 0) return staleFallback('Horizons provider cooldown is active.', 429, Math.max(1_000, wait));
      if (now + Math.max(0, wait) + UPSTREAM_TIMEOUT_MS > deadline) return staleFallback('Shared Horizons batch time limit reached.', 503, 60_000);
      if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
      let parsed: readonly HorizonsSample[] | null = null;
      const response = await this.fetchUpstream(entry.query, entry.key, entry.cached, Date.now(), (body) => { parsed = parseHorizonsSeries(body, entry.id, start); });
      if (!response.ok) return response;
      if (response.headers.get('X-Horizons-Cache') === 'STALE') {
        await response.body?.cancel();
        return staleFallback('Horizons is unavailable and no complete cached body set exists.', 502, Math.max(60_000, this.gate.nextAllowedAt - Date.now()));
      }
      await response.body?.cancel();
      if (!parsed) return errorResponse('Invalid Horizons batch data.', 502, 60_000);
      completed.set(entry.id, { id: entry.id, samples: parsed, retrievedAt: Date.parse(response.headers.get('X-Horizons-Retrieved-At')!) });
    }
    return { entries: EPHEMERIS_IDS.map((id) => completed.get(id)!), cache: 'MISS', retryMs: 0 };
  }

  private async pruneCache(keepKey: string, now: number): Promise<void> {
    const entries = await this.ctx.storage.list<CacheEntry>({ prefix: 'cache:', limit: MAX_CACHE_ENTRIES + 1 });
    const expired: string[] = [];
    const survivors: [string, CacheEntry][] = [];
    for (const [key, entry] of entries) {
      if (entry.schemaVersion !== CACHE_SCHEMA_VERSION || !Number.isFinite(entry.retrievedAt) || now - entry.retrievedAt >= STALE_TTL_MS) expired.push(key);
      else if (key !== keepKey) survivors.push([key, entry]);
    }
    survivors.sort((a, b) => a[1].retrievedAt - b[1].retrievedAt);
    while (survivors.length >= MAX_CACHE_ENTRIES) expired.push(survivors.shift()![0]);
    if (expired.length) await this.ctx.storage.delete(expired);
  }
}
