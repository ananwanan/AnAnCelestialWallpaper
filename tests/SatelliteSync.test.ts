import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSatelliteDataset, DAY_MS, HOUR_MS, MAX_OMM_BYTES } from '../src/satellites/omm';
import { readSatelliteJson, SATELLITE_REQUEST_TIMEOUT_MS, SatelliteSync } from '../src/sync/SatelliteSync';
import { SYNTHETIC_GPS_OMM, SYNTHETIC_STATION_OMM } from './fixtures/satelliteReference';

const NOW = Date.parse('2026-10-19T01:00:00Z');
const BASE = 'https://satellites.example';
function fixture() {
  let now = NOW, online = true;
  const records = new Map<string, string>();
  const storage = { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => { records.set(key, value); }, removeItem: (key: string) => { records.delete(key); } };
  const fetch = vi.fn(async (url: string | URL | Request) => {
    const group = String(url).includes('group=gps') ? 'gps' : 'stations';
    return new Response(JSON.stringify(createSatelliteDataset([group === 'gps' ? SYNTHETIC_GPS_OMM : SYNTHETIC_STATION_OMM], group, now)), { headers: { 'Content-Type': 'application/json', 'X-Satellite-Cache': 'MISS' } });
  });
  const deps = { fetch: fetch as typeof globalThis.fetch, now: () => now, online: () => online, random: () => 0, storage };
  return { deps, fetch, records, advance: (ms: number) => { now += ms; }, offline: () => { online = false; }, now: () => now };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('opt-in satellite sync', () => {
  it('defaults off with no fetch and permits one lazy first fetch after enabled', async () => {
    const f = fixture(), sync = new SatelliteSync(BASE, 1, f.deps);
    await sync.tick(); expect(f.fetch).not.toHaveBeenCalled(); expect(sync.dataset).toBeNull();
    sync.setEnabled(true); await sync.tick(); await sync.tick();
    expect(f.fetch).toHaveBeenCalledTimes(1); expect(sync.status.label).toBe('Live/Sync');
    expect(f.fetch.mock.calls[0]?.[0]).toBe(`${BASE}/api/satellites?group=stations`);
    const dataset = sync.dataset; expect(sync.dataset).toBe(dataset); expect(sync.dataset?.records[0]).toBe(dataset?.records[0]);
    sync.setEnabled(false); await sync.tick(); expect(sync.dataset).toBeNull(); expect(sync.status.pending).toBe(false);
  });
  it('enforces at least 2h with 1h selection across reloads and rapid toggles', async () => {
    const f = fixture(), sync = new SatelliteSync(BASE, 1, f.deps); sync.setEnabled(true); await sync.tick();
    f.advance(HOUR_MS); sync.setEnabled(false); sync.setEnabled(true); await sync.tick();
    const reloaded = new SatelliteSync(BASE, 1, f.deps); reloaded.setEnabled(true); await reloaded.tick();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(reloaded.status.label).toBe('Cached'); expect(reloaded.status.detail).toContain('cached CelesTrak');
    f.advance(HOUR_MS); await reloaded.tick(); expect(f.fetch).toHaveBeenCalledTimes(2);
  });
  it('uses independent dataset reservations and preserves them across group switches', async () => {
    const f = fixture(), sync = new SatelliteSync(BASE, 1, f.deps); sync.setEnabled(true); await sync.tick();
    sync.setGroup('gps'); await sync.tick(); expect(sync.dataset?.group).toBe('gps');
    sync.setGroup('stations'); await sync.tick(); expect(f.fetch).toHaveBeenCalledTimes(2);
    sync.setGroup('starlink'); await sync.tick(); expect(f.fetch).toHaveBeenCalledTimes(2); expect(sync.status.detail).toContain('M5');
  });
  it('honors 6/24h settings, with changing to 1h still constrained to 2h', async () => {
    const f = fixture(), sync = new SatelliteSync(BASE, 24, f.deps); sync.setEnabled(true); await sync.tick();
    f.advance(6 * HOUR_MS); await sync.tick(); expect(f.fetch).toHaveBeenCalledTimes(1);
    sync.setIntervalHours(6); await sync.tick(); expect(f.fetch).toHaveBeenCalledTimes(2);
    sync.setIntervalHours(1); f.advance(HOUR_MS); await sync.tick(); expect(f.fetch).toHaveBeenCalledTimes(2);
  });
  it('persists failed attempts, caps backoff, and honors Retry-After above minimum', async () => {
    const f = fixture(); f.fetch.mockImplementation(async () => new Response('busy', { status: 503, headers: { 'Retry-After': '18000' } }));
    const sync = new SatelliteSync(BASE, 1, f.deps); sync.setEnabled(true); await sync.tick();
    expect(sync.dataset).toBeNull();
    expect(sync.status.label).toBe('Unavailable');
    expect(sync.status.detail).toContain('HTTP 503');
    expect(sync.status.nextAttemptAt).toBe(new Date(NOW + 5 * HOUR_MS).toISOString());
    const reload = new SatelliteSync(BASE, 1, f.deps); reload.setEnabled(true); f.advance(2 * HOUR_MS); await reload.tick(); expect(f.fetch).toHaveBeenCalledTimes(1);
    f.advance(3 * HOUR_MS); await reload.tick(); expect(f.fetch).toHaveBeenCalledTimes(2);
  });
  it('retains last good elements on failures and expires cache without losing cooldown', async () => {
    const f = fixture(), sync = new SatelliteSync(BASE, 1, f.deps); sync.setEnabled(true); await sync.tick(); const dataset = sync.dataset;
    f.fetch.mockRejectedValue(new Error('network down')); f.advance(2 * HOUR_MS); await sync.tick();
    expect(sync.dataset).toBe(dataset); f.offline(); expect(sync.status.label).toBe('Cached'); expect(sync.status.detail).toContain('Offline');
    f.advance(8 * DAY_MS); expect(sync.dataset).toBeNull(); expect(sync.status.label).toBe('Unavailable');
  });
  it('persists an upstream policy halt and cannot bypass it with disable/reload', async () => {
    const f = fixture(); f.fetch.mockImplementation(async () => new Response('blocked', { status: 503, headers: { 'X-Satellite-Blocked': 'true', 'Retry-After': '7200' } }));
    const sync = new SatelliteSync(BASE, 1, f.deps); sync.setEnabled(true); await sync.tick();
    f.advance(24 * HOUR_MS); const reload = new SatelliteSync(BASE, 1, f.deps); reload.setEnabled(true); await reload.tick();
    expect(f.fetch).toHaveBeenCalledTimes(1); expect(reload.status.nextAttemptAt).toBeNull(); expect(reload.status.detail).toContain('investigate');
  });
  it('cancels an ignored-signal fetch promptly when disabled and retains its reservation', async () => {
    const f = fixture(); let signal: AbortSignal | undefined;
    f.fetch.mockImplementation((_url, init?: RequestInit) => { signal = init?.signal ?? undefined; return new Promise<Response>(() => undefined); });
    const sync = new SatelliteSync(BASE, 1, f.deps); sync.setEnabled(true); const pending = sync.tick();
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(1)); sync.setEnabled(false); await pending;
    expect(signal?.aborted).toBe(true); expect(sync.status.pending).toBe(false);
    sync.setEnabled(true); await sync.tick(); expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('times out a transport that ignores AbortSignal without an unbounded pending task', async () => {
    vi.useFakeTimers({ now: NOW });
    const f = fixture(); f.fetch.mockImplementation(() => new Promise<Response>(() => undefined));
    const sync = new SatelliteSync(BASE, 1, f.deps); sync.setEnabled(true); const pending = sync.tick();
    await vi.advanceTimersByTimeAsync(SATELLITE_REQUEST_TIMEOUT_MS); await pending;
    expect(sync.status.pending).toBe(false); expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('suspension aborts work and resume retains data and minimum source cadence', async () => {
    const f = fixture(), sync = new SatelliteSync(BASE, 1, f.deps); sync.setEnabled(true); await sync.tick(); const dataset = sync.dataset;
    sync.setSuspended(true); f.advance(3 * HOUR_MS); await sync.tick(); expect(f.fetch).toHaveBeenCalledTimes(1); expect(sync.dataset).toBe(dataset);
    sync.setSuspended(false); await sync.tick(); expect(f.fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects corrupt/versioned caches fail-closed and never invents a configured API', async () => {
    const f = fixture(); f.records.set(`anan:satellites:v1:${BASE}/api/satellites:stations`, '{"schemaVersion":99}');
    const sync = new SatelliteSync(BASE, 1, f.deps); sync.setEnabled(true); await sync.tick(); expect(f.fetch).not.toHaveBeenCalled();
    f.advance(2 * HOUR_MS); await sync.tick(); expect(f.fetch).toHaveBeenCalledTimes(1);
    const absent = new SatelliteSync(undefined, 1, f.deps); absent.setEnabled(true); await absent.tick(); expect(absent.status.label).toBe('Unavailable');
    expect(absent.status.detail).toContain('No satellite GP service');
  });
  it('bounds response bytes and fails closed for HTML or a hanging body', async () => {
    const signal = new AbortController();
    await expect(readSatelliteJson(new Response('html', { headers: { 'Content-Type': 'text/html' } }), signal.signal)).rejects.toThrow('format');
    await expect(readSatelliteJson(new Response('x'.repeat(MAX_OMM_BYTES + 1), { headers: { 'Content-Type': 'application/json' } }), signal.signal)).rejects.toThrow('size');
    const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => undefined) });
    const hanging = readSatelliteJson(new Response(stream, { headers: { 'Content-Type': 'application/json' } }), signal.signal);
    signal.abort(); await expect(hanging).rejects.toThrow('aborted');
  });
});
