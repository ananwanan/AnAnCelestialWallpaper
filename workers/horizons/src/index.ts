import {
  CACHE_SCHEMA_VERSION, CACHE_TTL_MS, MAX_CACHE_ENTRIES, MAX_COALESCED_REQUESTS,
  MAX_REQUESTS_PER_HOUR, MAX_RESPONSE_BYTES, MIN_UPSTREAM_SPACING_MS, STALE_TTL_MS,
  UPSTREAM_TIMEOUT_MS, UPSTREAM_URL, PolicyError, boundedText, canonicalQuery,
  errorResponse, retryAfterMs, validatePayload,
} from './policy';

export interface Env {
  HORIZONS_GATE: DurableObjectNamespace;
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
  headers.set('Access-Control-Expose-Headers', 'X-Horizons-Cache, X-Horizons-Retrieved-At, X-Horizons-Source, Age, Retry-After, Warning');
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
      if (url.pathname !== '/api/horizons.api' && url.pathname !== '/health') return finish(errorResponse('Not found.', 404));
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
      if (url.pathname === '/health') {
        return finish(new Response(JSON.stringify({ status: 'ok', service: 'AnAnCelestialWallpaper Horizons proxy', upstream: UPSTREAM_URL, apiVersion: '1.2', endpoint: '/api/horizons.api', normalizedEphemeris: false }), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }));
      }
      const query = canonicalQuery(url);
      // All callers, all Cloudflare locations share ONE gate, not one object per URL/IP.
      const gate = env.HORIZONS_GATE.get(env.HORIZONS_GATE.idFromName('horizons-global-v1'));
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

  private async fetchUpstream(query: string, key: string, cached: CacheEntry | undefined, startedAt: number): Promise<Response> {
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
      const body = await boundedText(response);
      validatePayload(body);
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
    } finally { clearTimeout(timeout); }
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
