import { createSatelliteDataset, HOUR_MS, SATELLITE_MIN_REFRESH_MS, validateSatelliteDataset } from '../../../src/satellites/omm';
import type { SatelliteDataset, SatelliteGroup } from '../../../src/satellites/types';
import { boundedText, errorResponse, PolicyError, retryAfterMs } from './policy';

const UPSTREAM = 'https://celestrak.org/NORAD/elements/gp.php';
const TIMEOUT_MS = 15_000;
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error('CelesTrak request timed out.'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
interface SatelliteEnv { UPSTREAM_USER_AGENT: string; }
interface GateState { version: 1; next: Record<SatelliteGroup, number>; failures: Record<SatelliteGroup, number>; blocked: string | null; }
export function satelliteGroup(url: URL): SatelliteGroup {
  const keys = [...url.searchParams.keys()];
  const group = url.searchParams.get('group');
  if (keys.length !== 1 || keys[0] !== 'group' || group !== 'stations' && group !== 'gps') throw new PolicyError('Only group=stations or group=gps is supported.', 400);
  return group;
}
/** One durable worldwide gate. Only two dataset keys; no user-controlled upstream URLs. */
export class SatellitesGate implements DurableObject {
  private state: GateState = { version: 1, next: { stations: 0, gps: 0 }, failures: { stations: 0, gps: 0 }, blocked: null };
  private active: { group: SatelliteGroup; promise: Promise<Response>; waiters: number } | null = null;
  constructor(private readonly ctx: DurableObjectState, private readonly env: SatelliteEnv) {
    ctx.blockConcurrencyWhile(async () => {
      const state = await ctx.storage.get<GateState>('satellite-gate');
      if (state === undefined) return;
      const now = Date.now();
      if (state.version === 1 && (state.blocked === null || typeof state.blocked === 'string' && state.blocked.length <= 256)
        && ['stations', 'gps'].every(g => { const group = g as SatelliteGroup; return Number.isFinite(state.next?.[group]) && state.next[group] >= 0 && state.next[group] <= now + 31 * 24 * HOUR_MS
          && Number.isInteger(state.failures?.[group]) && state.failures[group] >= 0 && state.failures[group] <= 10; })) this.state = state;
      else this.state.blocked = 'Invalid persisted provider gate; owner investigation required.';
    });
  }
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET' || request.body !== null) return errorResponse('Only bodyless GET is supported.', 405);
    let group: SatelliteGroup;
    try { group = satelliteGroup(new URL(request.url)); } catch (error) { return errorResponse(error instanceof Error ? error.message : 'Invalid group.', 400); }
    if (this.active) {
      if (this.active.group !== group || this.active.waiters >= 32) return errorResponse('Shared satellite request is in progress.', 429, 15_000);
      this.active.waiters++;
      return (await this.active.promise).clone();
    }
    const promise = this.operation(group);
    const active = { group, promise, waiters: 0 }; this.active = active;
    try { return (await promise).clone(); } finally { if (this.active === active) this.active = null; }
  }
  private async operation(group: SatelliteGroup): Promise<Response> {
    const now = Date.now();
    let dataset: SatelliteDataset | null = null;
    try { const stored = await this.ctx.storage.get(`dataset:${group}`); if (stored) dataset = validateSatelliteDataset(stored, now, group); }
    catch { /* Bad or expired data is never served. The separate allowance remains intact. */ }
    const respond = (data: SatelliteDataset, cache: 'HIT' | 'MISS' | 'STALE', retry = 0) => {
      const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'X-Satellite-Source': UPSTREAM, 'X-Satellite-Cache': cache, 'X-Satellite-Retrieved-At': data.retrievedAt,
        'Age': String(Math.max(0, Math.floor((Date.now() - Date.parse(data.retrievedAt)) / 1000))) });
      if (this.state.blocked) headers.set('X-Satellite-Blocked', 'true');
      if (retry > 0) headers.set('Retry-After', String(Math.max(1, Math.ceil(retry / 1000))));
      if (cache === 'STALE') headers.set('Warning', '110 satellite-proxy "Orbital elements are cached; source refresh unavailable"');
      return new Response(JSON.stringify(data), { headers });
    };
    const unavailable = (message: string, status: number, retry: number) => {
      if (dataset) return respond(dataset, 'STALE', retry);
      const response = errorResponse(message, status, retry);
      if (this.state.blocked) response.headers.set('X-Satellite-Blocked', 'true');
      return response;
    };
    if (this.state.blocked) return unavailable(this.state.blocked, 503, Math.max(0, this.state.next[group] - now));
    if (dataset && now - Date.parse(dataset.retrievedAt) < SATELLITE_MIN_REFRESH_MS) return respond(dataset, 'HIT', Math.max(0, this.state.next[group] - now));
    if (now < this.state.next[group]) return unavailable('CelesTrak dataset minimum refresh or failure cooldown is active.', 429, this.state.next[group] - now);
    this.state.next[group] = now + SATELLITE_MIN_REFRESH_MS;
    await this.ctx.storage.put('satellite-gate', structuredClone(this.state)); // Reserve BEFORE yielding to upstream.
    const controller = new AbortController(), timer = setTimeout(() => controller.abort('CelesTrak timed out.'), TIMEOUT_MS);
    let retry = 0;
    try {
      if (!this.env.UPSTREAM_USER_AGENT || this.env.UPSTREAM_USER_AGENT.length > 256 || /[\r\n]/.test(this.env.UPSTREAM_USER_AGENT)) throw new Error('Invalid upstream identification.');
      const query = group === 'stations' ? 'STATIONS' : 'GPS-OPS';
      const upstream = await abortable(fetch(`${UPSTREAM}?GROUP=${query}&FORMAT=JSON`, { method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: { 'Accept': 'application/json', 'User-Agent': this.env.UPSTREAM_USER_AGENT } }), controller.signal);
      retry = retryAfterMs(upstream.headers.get('Retry-After'), Date.now());
      if (upstream.status !== 200) {
        void upstream.body?.cancel().catch(() => undefined);
        this.state.blocked = `CelesTrak HTTP ${upstream.status}; source requests halted under its usage policy. Owner investigation is required.`;
        throw new Error(this.state.blocked);
      }
      if (!upstream.headers.get('Content-Type')?.toLowerCase().includes('application/json')) { void upstream.body?.cancel().catch(() => undefined); throw new Error('CelesTrak did not return JSON.'); }
      const data = createSatelliteDataset(JSON.parse(await abortable(boundedText(upstream, controller.signal), controller.signal)), group, Date.now());
      await this.ctx.storage.put(`dataset:${group}`, data);
      this.state.failures[group] = 0;
      this.state.next[group] = Math.max(this.state.next[group], Date.now() + retry);
      await this.ctx.storage.put('satellite-gate', structuredClone(this.state));
      return respond(data, 'MISS', Math.max(0, this.state.next[group] - Date.now()));
    } catch (error) {
      this.state.failures[group] = Math.min(10, this.state.failures[group] + 1);
      const backoff = Math.min(24 * HOUR_MS, SATELLITE_MIN_REFRESH_MS * 2 ** (this.state.failures[group] - 1));
      const delay = Math.max(retry, Math.min(24 * HOUR_MS, backoff * (1 + Math.random() * 0.2)));
      this.state.next[group] = Math.max(this.state.next[group], Date.now() + delay);
      await this.ctx.storage.put('satellite-gate', structuredClone(this.state));
      console.warn('CelesTrak request failed', error instanceof Error ? error.message : 'unknown error');
      return unavailable(this.state.blocked ?? 'CelesTrak temporarily unavailable; cached elements are retained when usable.', 503, this.state.next[group] - Date.now());
    } finally { clearTimeout(timer); controller.abort('CelesTrak operation finished.'); }
  }
}
