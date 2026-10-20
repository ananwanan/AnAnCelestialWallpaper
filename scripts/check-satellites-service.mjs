// Read-only by default. --fetch permits one sequential, gate-approved attempt per requested group.
// No direct CelesTrak calls, automatic retries, storage resets, fallback proxies or cooldown bypasses.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { eciToGeodetic, gstime, json2satrec, propagate } from 'satellite.js';

const args = process.argv.slice(2);
const base = new URL(args.shift() ?? 'https://horizons.ananwanan.cc');
assert(!base.username && !base.password && ['https:', 'http:'].includes(base.protocol), 'Use a public service base without credentials.');
const fetchSources = args.includes('--fetch');
const groupArg = args.find(arg => arg.startsWith('--groups='))?.slice('--groups='.length) ?? 'stations,gps';
const groups = [...new Set(groupArg.split(','))];
assert(groups.length && groups.every(group => ['stations', 'gps'].includes(group)), 'Only stations and gps are supported.');
const outputArg = args.find(arg => arg.startsWith('--output='))?.slice('--output='.length);
assert(args.every(arg => arg === '--fetch' || arg.startsWith('--groups=') || arg.startsWith('--output=')), 'Unknown option.');
const report = { checkedAt: new Date().toISOString(), base: base.origin, fetchSources, statusBefore: null, attempts: [], statusAfter: null };
const get = async path => {
  const response = await fetch(new URL(path, base), { headers: { Origin: 'null' }, signal: AbortSignal.timeout(20_000) });
  const text = await response.text();
  return { response, text };
};
const readStatus = async () => {
  const result = await get('/api/satellites/status');
  assert.equal(result.response.status, 200, `Read-only diagnostics unavailable: ${result.text}`);
  assert.equal(result.response.headers.get('Access-Control-Allow-Origin'), 'null');
  const status = JSON.parse(result.text);
  assert.equal(status.minimumRefreshSeconds, 7200);
  return status;
};
const prediction = record => {
  const at = new Date(report.checkedAt), ageDays = (at.getTime() - Date.parse(record.EPOCH)) / 86_400_000;
  if (Math.abs(ageDays) > (record.MEAN_MOTION < 3 ? 14 : 7)) return { noradId: record.NORAD_CAT_ID, refused: 'Element epoch is outside the supported prediction window.', ageDays };
  const satrec = json2satrec(record), state = propagate(satrec, at), later = propagate(satrec, new Date(at.getTime() + 60_000));
  assert(state && later && [state.position, later.position].every(vector => ['x', 'y', 'z'].every(axis => Number.isFinite(vector[axis]))), 'SGP4 must produce finite TEME positions.');
  const altitudeKm = eciToGeodetic(state.position, gstime(at)).height;
  assert(altitudeKm >= 80 && altitudeKm <= 95_000, 'Satellite altitude must be physically plausible.');
  const movementAfter60sKm = Math.hypot(...['x', 'y', 'z'].map(axis => later.position[axis] - state.position[axis]));
  assert(movementAfter60sKm > 0.001, 'SGP4 must propagate to the requested simulation time.');
  return { noradId: record.NORAD_CAT_ID, epoch: at.toISOString(), quality: 'approximate prediction',
    referenceFrame: 'TEME', origin: 'Earth', units: 'km', position: state.position, altitudeKm, ageDays, movementAfter60sKm };
};
try {
  report.statusBefore = await readStatus();
  if (fetchSources && !report.statusBefore.blocked && !report.statusBefore.activeGroup) {
    for (const group of groups) {
      const status = report.statusBefore.datasets.find(dataset => dataset.group === group);
      assert(status, 'Status must enumerate the requested group.');
      if (status.retryAfterSeconds > 0) {
        report.attempts.push({ group, skipped: 'Persisted cooldown is active.', nextAllowedAt: status.nextAllowedAt });
        continue;
      }
      const startedAt = new Date().toISOString();
      const attempt = { group, startedAt, completedAt: null, status: null };
      report.attempts.push(attempt);
      let result;
      try { result = await get(`/api/satellites?group=${group}`); }
      catch (error) { attempt.completedAt = new Date().toISOString(); attempt.error = error instanceof Error ? error.message : String(error); throw error; }
      const { response, text } = result;
      Object.assign(attempt, { completedAt: new Date().toISOString(), status: response.status,
        cache: response.headers.get('X-Satellite-Cache'), blocked: response.headers.get('X-Satellite-Blocked'),
        retryAfter: response.headers.get('Retry-After'), source: response.headers.get('X-Satellite-Source'),
        retrievedAt: response.headers.get('X-Satellite-Retrieved-At'), sha256: createHash('sha256').update(text).digest('hex') });
      let payload;
      try { payload = JSON.parse(text); attempt.payload = payload; }
      catch (error) { attempt.responseExcerpt = text.slice(0, 1024); throw error; }
      if (response.status !== 200 || attempt.blocked === 'true') break; // Human investigation before any further source work.
      assert.equal(payload.source, 'CelesTrak-GP'); assert.equal(payload.referenceFrame, 'TEME');
      assert.equal(payload.origin, 'Earth'); assert.equal(payload.quality, 'orbital elements'); assert.equal(payload.group, group);
      assert(Array.isArray(payload.records) && payload.records.length > 0);
      assert(payload.records.every(record => Number.isInteger(record.NORAD_CAT_ID) && Number.isFinite(Date.parse(record.EPOCH))));
      assert.equal(attempt.retrievedAt, payload.retrievedAt);
      attempt.identities = payload.records.map(record => ({ name: record.OBJECT_NAME, noradId: record.NORAD_CAT_ID, epoch: record.EPOCH }));
      attempt.predictions = payload.records.map(prediction);
      if (attempt.cache === 'STALE') break;
    }
  }
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  // A post-attempt read never creates another source operation, even after a failed response.
  if (report.statusBefore) {
    try { report.statusAfter = await readStatus(); }
    catch (error) { report.statusError = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
  }
}
const serialized = JSON.stringify(report, null, 2) + '\n';
if (outputArg) {
  const directory = resolve(outputArg); await mkdir(directory, { recursive: true });
  const name = `satellites-service-${report.checkedAt.replace(/[:.]/g, '-')}.json`;
  await writeFile(resolve(directory, name), serialized);
  console.log(`Evidence: ${resolve(directory, name)}`);
}
console.log(serialized);
if (report.attempts.some(attempt => attempt.status && attempt.status !== 200)) process.exitCode = 1;
