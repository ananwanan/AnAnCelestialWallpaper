import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createSatelliteDataset } from '../../../src/satellites/omm';
import { SYNTHETIC_GPS_OMM, SYNTHETIC_STATION_OMM } from '../../../tests/fixtures/satelliteReference';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('../../../scripts/check-satellites-service.mjs', import.meta.url));
async function smoke(options: { fetch?: boolean; cooldown?: number; blocked?: string; fail?: boolean; invalid?: boolean; transport?: boolean } = {}) {
  const routes: string[] = [];
  const status = { minimumRefreshSeconds: 7200, blocked: options.blocked ?? null, activeGroup: null,
    datasets: ['stations', 'gps'].map(group => ({ group, retryAfterSeconds: options.cooldown ?? 0, nextAllowedAt: new Date(Date.now() + (options.cooldown ?? 0) * 1000).toISOString() })) };
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    routes.push(request.url!); response.setHeader('Access-Control-Allow-Origin', 'null'); response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/satellites/status') return response.end(JSON.stringify(status));
    if (options.transport) return request.socket.destroy();
    if (options.fail) { response.statusCode = 503; response.setHeader('Retry-After', '14400'); return response.end(JSON.stringify({ error: 'TEST ONLY source failure' })); }
    if (options.invalid) { response.statusCode = 503; response.setHeader('Retry-After', '15000'); return response.end('TEST ONLY invalid JSON'); }
    const group = request.url?.endsWith('group=gps') ? 'gps' : 'stations';
    const record = { ...(group === 'gps' ? SYNTHETIC_GPS_OMM : SYNTHETIC_STATION_OMM), EPOCH: new Date().toISOString() };
    const dataset = createSatelliteDataset([record], group, Date.now());
    response.setHeader('X-Satellite-Cache', 'MISS'); response.setHeader('X-Satellite-Retrieved-At', dataset.retrievedAt);
    response.end(JSON.stringify(dataset));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const result = await exec(process.execPath, [script, `http://127.0.0.1:${port}`, ...(options.fetch ? ['--fetch'] : [])], { timeout: 10_000 }).catch(error => ({ stdout: error.stdout as string, code: error.code as number }));
    return { report: JSON.parse(result.stdout), routes, code: 'code' in result ? result.code : 0 };
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
describe('source smoke policy using an explicitly synthetic local service', () => {
  it('defaults to read-only diagnostics without any source route', async () => {
    const result = await smoke(); expect(result.routes).toEqual(['/api/satellites/status', '/api/satellites/status']);
    expect(result.report.attempts).toEqual([]); expect(result.code).toBe(0);
  });
  it('does not attempt a dataset in persisted cooldown even with --fetch', async () => {
    const result = await smoke({ fetch: true, cooldown: 60 }); expect(result.routes).toHaveLength(2);
    expect(result.report.attempts).toHaveLength(2); expect(result.report.attempts.every((attempt: { skipped: string }) => attempt.skipped)).toBe(true);
  });
  it('keeps a provider halt intact without requesting either source group', async () => {
    const result = await smoke({ fetch: true, blocked: 'TEST ONLY provider halt' }); expect(result.routes).toHaveLength(2); expect(result.report.attempts).toEqual([]);
  });
  it('serially checks allowed groups and records real-time SGP4 predictions', async () => {
    const result = await smoke({ fetch: true }); expect(result.routes).toEqual(['/api/satellites/status', '/api/satellites?group=stations', '/api/satellites?group=gps', '/api/satellites/status']);
    expect(result.report.attempts.map((attempt: { identities: { noradId: number }[] }) => attempt.identities[0]!.noradId)).toEqual([25544, SYNTHETIC_GPS_OMM.NORAD_CAT_ID]);
    expect(result.report.attempts[0].predictions[0]).toMatchObject({ referenceFrame: 'TEME', quality: 'approximate prediction', altitudeKm: expect.any(Number), movementAfter60sKm: expect.any(Number) });
    expect(result.code).toBe(0);
  });
  it('stops after the first HTTP failure, retaining evidence and Retry-After', async () => {
    const result = await smoke({ fetch: true, fail: true }); expect(result.routes).not.toContain('/api/satellites?group=gps');
    expect(result.report.attempts[0], JSON.stringify(result.report)).toMatchObject({ status: 503, retryAfter: '14400' }); expect(result.code).toBe(1);
  });
  it('preserves an invalid response diagnostic and does not try the next group', async () => {
    const result = await smoke({ fetch: true, invalid: true }); expect(result.routes).not.toContain('/api/satellites?group=gps');
    expect(result.report.attempts[0], JSON.stringify(result.report)).toMatchObject({ status: 503, retryAfter: '15000', sha256: expect.stringMatching(/^[a-f0-9]{64}$/), responseExcerpt: 'TEST ONLY invalid JSON' });
    expect(result.report.error).toContain('JSON'); expect(result.code).toBe(1);
  });
  it('retains a transport failure attempt and does not request the next group', async () => {
    const result = await smoke({ fetch: true, transport: true }); expect(result.routes).not.toContain('/api/satellites?group=gps');
    expect(result.report.attempts[0], JSON.stringify(result.report)).toMatchObject({ group: 'stations', status: null, completedAt: expect.any(String), error: expect.any(String) });
    expect(result.code).toBe(1);
  });
});
