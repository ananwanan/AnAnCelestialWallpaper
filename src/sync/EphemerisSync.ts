import { SNAPSHOT_FRESH_MS, SNAPSHOT_MAX_AGE_MS, validateEphemerisSnapshot, type EphemerisSnapshot } from '../astronomy/ephemerisSnapshot';
export type { EphemerisSnapshot } from '../astronomy/ephemerisSnapshot';

type IntervalHours = 1 | 6 | 24;
type CacheStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface EphemerisSyncDependencies {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly storage?: CacheStorage | null;
  readonly online?: () => boolean;
}
export interface EphemerisSyncStatus {
  readonly label: 'Local prediction' | 'Live/Sync' | 'Cached';
  readonly detail: string;
  readonly pending: boolean;
  readonly lastAttemptAt: string | null;
  readonly nextAttemptAt: string | null;
  readonly cacheAgeMs: number | null;
}
const HOUR = 3_600_000;
const CACHE_VERSION = 1;
const MAX_BODY_BYTES = 32 * 1024;
const REQUEST_TIMEOUT_MS = 90_000;

function retryAfter(value: string | null, now: number): number {
  if (!value) return 0;
  const milliseconds = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(milliseconds) ? Math.min(24 * 24 * HOUR, Math.max(0, milliseconds)) : 0;
}
async function readBounded(response: Response, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) { void response.body?.cancel().catch(() => undefined); throw new Error('Ephemeris request aborted.'); }
  if (!response.headers.get('Content-Type')?.toLowerCase().includes('application/json')) { void response.body?.cancel().catch(() => undefined); throw new Error('Provider did not return JSON.'); }
  if (Number(response.headers.get('Content-Length')) > MAX_BODY_BYTES || !response.body) { void response.body?.cancel().catch(() => undefined); throw new Error('Invalid provider response size.'); }
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel('Ephemeris request aborted').catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) throw new Error('Provider response exceeds size limit.');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) { void reader.cancel('Invalid provider body').catch(() => undefined); throw error; }
  finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
  if (signal.aborted) throw new Error('Ephemeris request aborted.');
  return JSON.parse(text);
}
function browserStorage(): CacheStorage | null { try { return globalThis.localStorage ?? null; } catch { return null; } }

/** Wall-clock scheduled remote comparison. Time-warped rendering never changes API time. */
export class EphemerisSync {
  private readonly endpoint: string | null;
  private readonly cacheKey: string | null;
  private readonly dependencies: Required<Omit<EphemerisSyncDependencies, 'storage'>> & { storage: CacheStorage | null };
  private intervalHours: IntervalHours;
  private lastSuccessMs: number | null = null;
  private lastAttemptMs: number | null = null;
  private nextRetryMs = 0;
  private failures = 0;
  private controller: AbortController | null = null;
  private disposed = false;
  private detail = 'Local ephemeris; remote provider is not configured.';
  private currentSnapshot: EphemerisSnapshot | null = null;
  private currentState: 'local' | 'syncing' | 'synced' | 'cached' | 'failed' | 'offline' = 'local';

  constructor(baseUrl: string | undefined, intervalHours: IntervalHours = 6, dependencies: EphemerisSyncDependencies = {}) {
    this.intervalHours = intervalHours;
    this.dependencies = { fetch: dependencies.fetch ?? globalThis.fetch.bind(globalThis), now: dependencies.now ?? Date.now,
      random: dependencies.random ?? Math.random, storage: dependencies.storage === undefined ? browserStorage() : dependencies.storage,
      online: dependencies.online ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false) };
    let endpoint: string | null = null;
    if (baseUrl?.trim()) {
      try {
        const url = new URL(baseUrl.trim());
        if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error();
        endpoint = `${url.href.replace(/\/$/, '')}/api/ephemeris`;
        this.detail = 'Local ephemeris; waiting for the configured remote comparison.';
      } catch { this.currentState = 'failed'; this.detail = 'Invalid ephemeris service URL; local ephemeris continues.'; }
    }
    this.endpoint = endpoint;
    this.cacheKey = endpoint ? `anan:ephemeris:v${CACHE_VERSION}:${endpoint}` : null;
    this.restoreCache();
  }

  /** Reads remain truthful after a long host pause, even before the next tick. */
  get snapshot(): EphemerisSnapshot | null { this.expireCache(this.dependencies.now()); return this.currentSnapshot; }
  get state(): 'local' | 'syncing' | 'synced' | 'cached' | 'failed' | 'offline' {
    this.expireCache(this.dependencies.now());
    if (this.endpoint && !this.dependencies.online() && this.currentState !== 'syncing') return this.currentSnapshot ? 'cached' : 'offline';
    return this.currentState;
  }

  get status(): EphemerisSyncStatus {
    const now = this.dependencies.now();
    this.expireCache(now);
    const cacheAgeMs = this.currentSnapshot ? Math.max(0, now - Date.parse(this.currentSnapshot.retrievedAt)) : null;
    const offline = this.endpoint !== null && !this.dependencies.online();
    return { label: this.state === 'synced' ? 'Live/Sync' : this.currentSnapshot ? 'Cached' : 'Local prediction',
      detail: offline ? this.currentSnapshot ? 'Offline; the last valid Horizons comparison is cached. Local ephemeris continues.' : 'Offline; local ephemeris continues without a remote comparison.' : this.detail,
      pending: this.controller !== null, cacheAgeMs,
      lastAttemptAt: this.lastAttemptMs === null ? null : new Date(this.lastAttemptMs).toISOString(),
      nextAttemptAt: !this.endpoint || this.disposed ? null : new Date(Math.max(this.nextRetryMs, this.lastSuccessMs === null ? now : this.lastSuccessMs + this.intervalHours * HOUR)).toISOString() };
  }

  setIntervalHours(hours: IntervalHours): void {
    if (![1, 6, 24].includes(hours)) throw new Error('Sync interval must be 1, 6, or 24 hours.');
    this.intervalHours = hours;
  }

  /** `at` is retained for app compatibility; only injected real wall-clock UTC is requested. */
  async tick(_at: Date = new Date()): Promise<void> {
    if (this.disposed) return;
    const now = this.dependencies.now();
    this.expireCache(now);
    if (!this.endpoint || this.controller || now < this.nextRetryMs
        || (this.lastSuccessMs !== null && now - this.lastSuccessMs < this.intervalHours * HOUR)) return;
    this.lastAttemptMs = now;
    if (!this.dependencies.online()) { this.failed(now, 'Offline; using local ephemeris and the last valid comparison.', 60_000); return; }
    const controller = new AbortController();
    this.controller = controller;
    this.currentState = 'syncing';
    this.detail = 'Requesting one shared Horizons comparison; local ephemeris continues.';
    const timer = setTimeout(() => controller.abort('Ephemeris request timed out'), REQUEST_TIMEOUT_MS);
    let providerDelay = 0;
    try {
      const requestedEpoch = new Date(now).toISOString();
      const response = await this.dependencies.fetch(`${this.endpoint}?at=${encodeURIComponent(requestedEpoch)}`, { signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
      providerDelay = retryAfter(response.headers.get('Retry-After'), this.dependencies.now());
      if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new Error(`Provider HTTP ${response.status}.`); }
      const snapshot = validateEphemerisSnapshot(await readBounded(response, controller.signal), this.dependencies.now());
      if (Date.parse(snapshot.epoch) !== now) throw new Error('Provider comparison epoch does not match the requested UTC time.');
      if (this.disposed || controller.signal.aborted) return;
      this.currentSnapshot = snapshot;
      const completedAt = this.dependencies.now();
      const sourceAgeMs = completedAt - Date.parse(snapshot.retrievedAt);
      if (response.headers.get('X-Horizons-Cache') === 'STALE' || sourceAgeMs >= SNAPSHOT_FRESH_MS) {
        // A 200 fallback carries useful comparison data, but its source refresh failed.
        this.failed(completedAt, 'Stale cached Horizons comparison; source refresh is deferred until the retry cooldown. Local ephemeris continues.', providerDelay);
        this.persistCache();
        return;
      }
      this.lastSuccessMs = completedAt;
      this.failures = 0;
      this.nextRetryMs = this.lastSuccessMs + providerDelay;
      const cached = response.headers.get('X-Horizons-Cache') !== 'MISS';
      this.currentState = cached ? 'cached' : 'synced';
      this.detail = cached ? 'Cached Horizons comparison at the stated UTC epoch; local ephemeris drives the scene.' : 'Live/Sync: Horizons comparison only; local ephemeris drives the scene.';
      this.persistCache();
    } catch (error) {
      if (!this.disposed) this.failed(this.dependencies.now(), `${error instanceof Error ? error.message : 'Remote comparison unavailable'} Local ephemeris continues.`, providerDelay);
    } finally {
      controller.abort('Ephemeris operation finished');
      clearTimeout(timer);
      if (this.controller === controller) this.controller = null;
    }
  }

  dispose(): void { this.disposed = true; this.controller?.abort('Ephemeris sync disposed'); this.controller = null; }

  private failed(now: number, detail: string, providerDelay: number): void {
    this.failures = Math.min(10, this.failures + 1);
    const exponential = Math.min(6 * HOUR, 60_000 * 2 ** (this.failures - 1));
    const jitter = Math.min(6 * HOUR, exponential * (1 + Math.max(0, Math.min(1, this.dependencies.random())) * 0.2));
    this.nextRetryMs = now + Math.max(providerDelay, jitter);
    this.expireCache(now);
    this.currentState = this.currentSnapshot ? 'cached' : this.dependencies.online() ? 'failed' : 'offline';
    this.detail = detail;
  }

  private expireCache(now: number): void {
    if (this.currentSnapshot && now - Date.parse(this.currentSnapshot.retrievedAt) > SNAPSHOT_MAX_AGE_MS) {
      this.currentSnapshot = null;
      this.currentState = 'local';
      this.detail = 'Cached comparison expired after 24 hours; local ephemeris continues.';
      try { if (this.cacheKey) this.dependencies.storage?.removeItem(this.cacheKey); } catch { /* Storage may be disabled by the wallpaper host. */ }
    } else if (this.currentSnapshot && this.currentState === 'synced' && now - Date.parse(this.currentSnapshot.retrievedAt) >= SNAPSHOT_FRESH_MS) {
      this.currentState = 'cached'; this.detail = 'Cached comparison; source retrieval is older than 6 hours. Local ephemeris continues.';
    }
  }

  private restoreCache(): void {
    if (!this.cacheKey || !this.dependencies.storage) return;
    try {
      const text = this.dependencies.storage.getItem(this.cacheKey);
      if (!text) return;
      if (text.length > MAX_BODY_BYTES) throw new Error();
      const cache = JSON.parse(text) as { schemaVersion?: unknown; endpoint?: unknown; snapshot?: unknown };
      if (cache.schemaVersion !== CACHE_VERSION || cache.endpoint !== this.endpoint) throw new Error();
      this.currentSnapshot = validateEphemerisSnapshot(cache.snapshot, this.dependencies.now());
      this.currentState = 'cached'; this.detail = 'Cached Horizons comparison; startup will still request current UTC once.';
    } catch { try { this.dependencies.storage.removeItem(this.cacheKey); } catch { /* Optional persistence. */ } }
  }

  private persistCache(): void {
    if (!this.cacheKey || !this.currentSnapshot) return;
    try { this.dependencies.storage?.setItem(this.cacheKey, JSON.stringify({ schemaVersion: CACHE_VERSION, endpoint: this.endpoint, snapshot: this.currentSnapshot })); } catch { /* Quota/security failure must not stop local rendering. */ }
  }
}
