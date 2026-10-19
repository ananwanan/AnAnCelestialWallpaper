// Live deployment smoke test. Only one bounded Earth query reaches JPL; all calls are sequential.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:8787');
assert(!base.username && !base.password && ['http:', 'https:'].includes(base.protocol), 'Use a public base URL without credentials.');
const day = new Date().toISOString().slice(0, 10);
const nextDay = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const query = new URLSearchParams({ COMMAND: '399', START_TIME: day, STOP_TIME: nextDay, STEP_SIZE: '1 h' });
const route = `/api/horizons.api?${query}`;

async function get(path, init) {
  return fetch(new URL(path, base), { ...init, signal: AbortSignal.timeout(90_000) });
}

const health = await get('/health');
assert.equal(health.status, 200, 'Worker health must respond.');
assert.equal((await health.json()).normalizedEphemeris, true, 'Normalized comparison service must be available.');
const first = await get(route);
const payload = await first.json();
assert.equal(first.status, 200, JSON.stringify(payload));
assert.equal(payload.signature?.source, 'NASA/JPL Horizons API');
assert.equal(payload.signature?.version, '1.2');
assert(payload.result?.includes('$$SOE') && payload.result.includes('$$EOE'), 'Expected a Horizons vector table.');
assert(['MISS', 'HIT'].includes(first.headers.get('X-Horizons-Cache')), 'Expected fresh source or cached data.');
const second = await get(route, { headers: { Origin: 'null' } });
assert.equal(second.status, 200);
assert.equal(second.headers.get('X-Horizons-Cache'), 'HIT', 'Second query must use the shared cache.');
assert.equal(second.headers.get('Access-Control-Allow-Origin'), 'null');
assert.deepEqual(await second.json(), payload);

const normalizedEpoch = `${day}T00:00:00.000Z`;
const normalizedRoute = `/api/ephemeris?at=${encodeURIComponent(normalizedEpoch)}`;
const normalizedResponse = await get(normalizedRoute, { headers: { Origin: 'null' } });
const snapshot = await normalizedResponse.json();
assert.equal(normalizedResponse.status, 200, JSON.stringify(snapshot));
assert.equal(snapshot.schemaVersion, 1);
assert.equal(snapshot.epoch, normalizedEpoch);
assert.equal(snapshot.referenceFrame, 'ICRF');
assert.equal(snapshot.origin, 'Sun');
assert.equal(snapshot.units, 'AU, AU/day');
assert.equal(snapshot.quality, 'comparison');
assert.equal(snapshot.interpolation, 'cubic-hermite-hourly');
assert.deepEqual(snapshot.states.map(state => state.id).sort(), ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Moon'].sort());
assert(snapshot.states.every(state => state.epoch === normalizedEpoch && [state.positionAU, state.velocityAUPerDay].every(v => ['x', 'y', 'z'].every(axis => Number.isFinite(v[axis])))));
assert.equal(normalizedResponse.headers.get('Access-Control-Allow-Origin'), 'null');
const repeatedResponse = await get(normalizedRoute);
assert.equal(repeatedResponse.status, 200);
assert.equal(repeatedResponse.headers.get('X-Horizons-Cache'), 'HIT');
assert.deepEqual(await repeatedResponse.json(), snapshot);
if (process.argv[3] === '--record') {
  const target = process.argv[4]; assert(target, 'Provide a fixture file after --record.');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(snapshot, null, 2) + '\n');
  await writeFile(target.replace(/\.json$/, '.source.json'), JSON.stringify({ url: new URL(normalizedRoute, base).href, recordedAt: new Date().toISOString(), source: snapshot.source, apiVersion: snapshot.apiVersion, retrievedAt: snapshot.retrievedAt, purpose: 'Live JPL reference vectors at an exact hourly sample; local comparison only.' }, null, 2) + '\n');
}

for (const [path, init, status] of [
  ['/api/horizons.api?url=https://example.com', undefined, 400],
  ['/api/horizons.api?COMMAND=399&COMMAND=499', undefined, 400],
  ['/api/horizons.api?COMMAND=TLE', undefined, 400],
  ['/api/horizons.api?OUT_UNITS=KM-S', undefined, 400],
  ['/api/horizons.api', { headers: { Origin: 'https://unlisted.example' } }, 403],
  ['/api/horizons.api', { method: 'POST', body: '{}' }, 405],
  ['/api/ephemeris', undefined, 400],
  ['/api/ephemeris?at=2026-10-19T00:00:00Z&url=https://example.com', undefined, 400],
]) {
  const response = await get(path, init);
  assert.equal(response.status, status, `Unexpected status for ${path}`);
  await response.arrayBuffer();
}

console.log(JSON.stringify({
  base: base.origin, checkedAt: new Date().toISOString(), query: Object.fromEntries(query),
  signature: payload.signature, firstCache: first.headers.get('X-Horizons-Cache'),
  secondCache: second.headers.get('X-Horizons-Cache'),
  retrievedAt: second.headers.get('X-Horizons-Retrieved-At'),
  normalizedCache: normalizedResponse.headers.get('X-Horizons-Cache'), bodyCount: snapshot.states.length,
  normalizedRetrievedAt: snapshot.retrievedAt,
  checks: ['health', 'real Horizons vectors', 'nine-body normalized snapshot', 'shared cache HIT', 'local-file CORS', 'invalid query/origin/method rejection'],
}, null, 2));
