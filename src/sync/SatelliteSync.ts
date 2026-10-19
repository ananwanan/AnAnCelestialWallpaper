import { HOUR_MS, MAX_OMM_BYTES, SATELLITE_CACHE_MAX_AGE_MS, SATELLITE_MIN_REFRESH_MS, validateSatelliteDataset } from '../satellites/omm';
import type { SatelliteDataset, SatelliteGroup } from '../satellites/types';

interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; }
export interface SatelliteSyncDependencies {
  fetch?: typeof fetch; now?: () => number; random?: () => number; storage?: Storage | null; online?: () => boolean;
}
interface GroupState { dataset: SatelliteDataset | null; attemptedAt: number | null; nextRetryAt: number; failures: number; blocked: boolean; }
export interface SatelliteSyncStatus {
  readonly label: 'Disabled' | 'Live/Sync' | 'Cached' | 'Local prediction' | 'Unavailable';
  readonly detail: string; readonly pending: boolean; readonly nextAttemptAt: string | null; readonly lastAttemptAt: string | null;
}
export const SATELLITE_REQUEST_TIMEOUT_MS = 20_000;
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error('Satellite request aborted.'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
export function satelliteRetryAfter(value: string | null, now: number): number {
  if (!value) return 0;
  const ms = /^\d+$/.test(value.trim()) ? Number(value.trim()) * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) && ms > 0 ? Math.min(30 * 24 * HOUR_MS, ms) : 0;
}
export async function readSatelliteJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.headers.get('Content-Type')?.toLowerCase().includes('application/json') || !response.body || Number(response.headers.get('Content-Length')) > MAX_OMM_BYTES) {
    void response.body?.cancel().catch(() => undefined); throw new Error('Invalid satellite response format or size.');
  }
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  let text = '', size = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      const { value, done } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_OMM_BYTES) throw new Error('Satellite response exceeds size limit.');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    if (signal.aborted) throw new Error('Satellite request aborted.');
    return JSON.parse(text);
  } catch (error) { void reader.cancel().catch(() => undefined); throw error; }
  finally { signal.removeEventListener('abort', abort); try { reader.releaseLock(); } catch { /* A broken transport may retain its pending read after cancellation. */ } }
}
function browserStorage(): Storage | null { try { return globalThis.localStorage ?? null; } catch { return null; } }
const empty = (): GroupState => ({ dataset: null, attemptedAt: null, nextRetryAt: 0, failures: 0, blocked: false });

/** Opt-in, endpoint-scoped GP state. Persist the reservation before every network attempt. */
export class SatelliteSync {
  private readonly endpoint: string | null;
  private readonly dependencies: Required<Omit<SatelliteSyncDependencies, 'storage'>> & { storage: Storage | null };
  private readonly groups: Record<SatelliteGroup, GroupState> = { stations: empty(), gps: empty() };
  private enabled = false;
  private suspended = false;
  private disposed = false;
  private group: SatelliteGroup | 'starlink' = 'stations';
  private intervalHours: 1 | 6 | 24;
  private controller: AbortController | null = null;
  private detail = 'Satellite tracking is disabled.';
  private lastLiveGroup: SatelliteGroup | null = null;

  constructor(baseUrl: string | undefined, intervalHours: 1 | 6 | 24 = 6, dependencies: SatelliteSyncDependencies = {}) {
    this.intervalHours = intervalHours;
    this.dependencies = { fetch: dependencies.fetch ?? globalThis.fetch.bind(globalThis), now: dependencies.now ?? Date.now,
      random: dependencies.random ?? Math.random, storage: dependencies.storage === undefined ? browserStorage() : dependencies.storage,
      online: dependencies.online ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false) };
    let endpoint: string | null = null;
    if (baseUrl?.trim()) {
      try {
        const url = new URL(baseUrl.trim());
        if (url.username || url.password || url.search || url.hash || url.pathname !== '/' && url.pathname !== ''
          || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error();
        endpoint = `${url.origin}/api/satellites`;
      } catch { this.detail = 'Invalid satellite service base URL.'; }
    }
    this.endpoint = endpoint;
    for (const group of ['stations', 'gps'] as const) this.restore(group);
  }
  get dataset(): SatelliteDataset | null {
    if (!this.enabled || this.group === 'starlink') return null;
    const state = this.groups[this.group];
    if (state.dataset) {
      if (this.dependencies.now() - Date.parse(state.dataset.retrievedAt) > SATELLITE_CACHE_MAX_AGE_MS) { state.dataset = null; this.persist(this.group); }
    }
    return state.dataset;
  }
  get state(): 'disabled' | 'syncing' | 'synced' | 'cached' | 'unavailable' {
    if (!this.enabled) return 'disabled';
    if (this.controller) return 'syncing';
    const label = this.status.label;
    return label === 'Live/Sync' ? 'synced' : label === 'Cached' ? 'cached' : 'unavailable';
  }
  get status(): SatelliteSyncStatus {
    const dataset = this.dataset;
    const state = this.group === 'starlink' ? null : this.groups[this.group];
    let label: SatelliteSyncStatus['label'] = 'Unavailable';
    let detail = this.detail;
    if (!this.enabled) { label = 'Disabled'; detail = 'Satellite tracking is disabled; no satellite requests or propagation.'; }
    else if (this.group === 'starlink') { label = 'Unavailable'; detail = 'Starlink remains planned for the performance-gated M5 milestone.'; }
    else if (!this.endpoint) { label = 'Unavailable'; detail = 'No satellite GP service is configured; no invented satellite positions are shown.'; }
    else if (state?.blocked) { label = dataset ? 'Cached' : 'Unavailable'; detail = 'CelesTrak returned a policy error. Source requests stopped; repository owner must investigate before resetting the server gate.'; }
    else if (dataset) {
      label = this.lastLiveGroup === this.group && this.dependencies.online() && this.dependencies.now() - Date.parse(dataset.retrievedAt) < SATELLITE_MIN_REFRESH_MS ? 'Live/Sync' : 'Cached';
      if (!this.dependencies.online()) detail = 'Offline; cached orbital elements support local SGP4 predictions within their epoch window.';
    } else if (!this.dependencies.online()) { label = 'Unavailable'; detail = 'Offline and no usable orbital elements are cached.'; }
    return { label, detail, pending: this.controller !== null,
      lastAttemptAt: state?.attemptedAt === null || !state ? null : new Date(state.attemptedAt).toISOString(),
      nextAttemptAt: !this.enabled || this.suspended || !this.endpoint || !state || state.blocked || this.disposed ? null
        : new Date(Math.max(this.dependencies.now(), state.nextRetryAt, state.attemptedAt === null ? 0 : state.attemptedAt + this.cadence())).toISOString() };
  }
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.abort();
    else this.detail = this.dataset ? 'Using cached CelesTrak orbital elements for local SGP4 predictions; the persisted source refresh cooldown is retained.'
      : 'Satellite tracking enabled; waiting for scoped orbital elements or the persisted source refresh cooldown.';
  }
  setSuspended(suspended: boolean): void { this.suspended = suspended; if (suspended) this.abort(); }
  setGroup(group: SatelliteGroup | 'starlink'): void {
    if (!['stations', 'gps', 'starlink'].includes(group) || group === this.group) return;
    this.abort(); this.group = group;
    this.detail = 'Selected dataset changed; cached elements and the independent source refresh cooldown are retained.';
  }
  setIntervalHours(hours: 1 | 6 | 24): void { if (![1, 6, 24].includes(hours)) throw new Error('Invalid GP refresh interval.'); this.intervalHours = hours; }
  async tick(): Promise<void> {
    if (!this.enabled || this.suspended || this.disposed || !this.endpoint || this.controller || this.group === 'starlink') return;
    const group = this.group, state = this.groups[group], now = this.dependencies.now();
    if (state.blocked || now < state.nextRetryAt || state.attemptedAt !== null && now < state.attemptedAt + this.cadence()) return;
    if (!this.dependencies.online()) { this.detail = 'Offline; cached elements remain usable within the prediction window.'; return; }
    state.attemptedAt = now;
    state.nextRetryAt = now + SATELLITE_MIN_REFRESH_MS;
    this.persist(group); // Aborts, reloads, toggles, failures and group changes cannot bypass the minimum.
    const controller = new AbortController(); this.controller = controller;
    const timer = setTimeout(() => controller.abort('Satellite request timed out.'), SATELLITE_REQUEST_TIMEOUT_MS);
    let cooldown = 0;
    this.detail = `Requesting scoped ${group} orbital elements; positions will be predicted locally.`;
    try {
      const response = await abortable(this.dependencies.fetch(`${this.endpoint}?group=${group}`, { signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error' }), controller.signal);
      cooldown = satelliteRetryAfter(response.headers.get('Retry-After'), this.dependencies.now());
      // The shared service identifies an upstream policy halt separately from its own temporary errors.
      state.blocked = response.headers.get('X-Satellite-Blocked') === 'true';
      if (response.status !== 200) { void response.body?.cancel().catch(() => undefined); throw new Error(`Satellite service HTTP ${response.status}.`); }
      const dataset = validateSatelliteDataset(await readSatelliteJson(response, controller.signal), this.dependencies.now(), group);
      if (controller.signal.aborted || !this.enabled || this.disposed || this.suspended || this.group !== group) return;
      state.dataset = dataset;
      state.failures = 0;
      state.nextRetryAt = Math.max(state.nextRetryAt, this.dependencies.now() + cooldown);
      const cached = response.headers.get('X-Satellite-Cache') !== 'MISS';
      this.lastLiveGroup = cached ? null : group;
      this.detail = `${cached ? 'Cached' : 'Live/Sync'} CelesTrak orbital elements; all displayed positions and trajectory arcs are local SGP4 predictions. TEME conversion approximates UT1=UTC and omits polar motion.`;
      this.persist(group);
    } catch (error) {
      if (!controller.signal.aborted || this.enabled && !this.disposed && !this.suspended && this.group === group) {
        state.failures = Math.min(10, state.failures + 1);
        const backoff = Math.min(24 * HOUR_MS, SATELLITE_MIN_REFRESH_MS * 2 ** (state.failures - 1));
        state.nextRetryAt = Math.max(state.nextRetryAt, this.dependencies.now() + cooldown,
          this.dependencies.now() + Math.min(24 * HOUR_MS, backoff * (1 + Math.max(0, Math.min(1, this.dependencies.random())) * 0.2)));
        this.detail = `${error instanceof Error ? error.message : 'Satellite source unavailable.'} Last valid orbital elements are retained when usable.`;
      }
      this.persist(group);
    } finally { clearTimeout(timer); controller.abort('Satellite operation finished.'); if (this.controller === controller) this.controller = null; }
  }
  dispose(): void { this.disposed = true; this.abort(); }
  private abort(): void { this.controller?.abort('Satellite layer disabled, suspended or changed.'); this.controller = null; }
  private cadence(): number { return Math.max(2, this.intervalHours) * HOUR_MS; }
  private key(group: SatelliteGroup): string { return `anan:satellites:v1:${this.endpoint}:${group}`; }
  private persist(group: SatelliteGroup): void {
    if (!this.endpoint) return;
    try { this.dependencies.storage?.setItem(this.key(group), JSON.stringify({ schemaVersion: 1, endpoint: this.endpoint, ...this.groups[group] })); }
    catch { /* Storage restrictions cannot stop local rendering; shared server still enforces provider cadence. */ }
  }
  private restore(group: SatelliteGroup): void {
    if (!this.endpoint) return;
    try {
      const text = this.dependencies.storage?.getItem(this.key(group));
      if (!text) return;
      if (text.length > MAX_OMM_BYTES) throw new Error();
      const stored = JSON.parse(text) as Record<string, unknown>;
      const now = this.dependencies.now();
      if (stored.schemaVersion !== 1 || stored.endpoint !== this.endpoint || typeof stored.blocked !== 'boolean'
        || typeof stored.failures !== 'number' || !Number.isInteger(stored.failures) || stored.failures < 0 || stored.failures > 10
        || stored.attemptedAt !== null && (typeof stored.attemptedAt !== 'number' || !Number.isFinite(stored.attemptedAt) || stored.attemptedAt < 0 || stored.attemptedAt > now + 60_000)
        || typeof stored.nextRetryAt !== 'number' || !Number.isFinite(stored.nextRetryAt) || stored.nextRetryAt < 0 || stored.nextRetryAt > now + 31 * 24 * HOUR_MS) throw new Error();
      let dataset: SatelliteDataset | null = null;
      try { if (stored.dataset !== null) dataset = validateSatelliteDataset(stored.dataset, now, group); } catch { /* Preserve cooldown despite an expired/corrupt payload. */ }
      this.groups[group] = { dataset, attemptedAt: stored.attemptedAt as number | null, nextRetryAt: stored.nextRetryAt, failures: stored.failures, blocked: stored.blocked };
    } catch {
      // Corrupt allowance fails closed for two hours rather than fabricating a new first request.
      this.groups[group].attemptedAt = this.dependencies.now(); this.groups[group].nextRetryAt = this.dependencies.now() + SATELLITE_MIN_REFRESH_MS;
      this.persist(group);
    }
  }
}
