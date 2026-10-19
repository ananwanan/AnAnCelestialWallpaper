import { describe, expect, it } from 'vitest';
import { MAX_RESPONSE_BYTES, UPSTREAM_URL, boundedText, canonicalQuery, retryAfterMs, validatePayload } from '../src/policy';
import { VALID_BODY } from './fixture';

describe('restricted canonical Horizons query', () => {
  const now = Date.UTC(2026, 9, 19, 12);
  const query = (value = '') => canonicalQuery(new URL(`${UPSTREAM_URL}?${value}`), now);
  it('uses a shared daily window, exact frame/units, geometric states and UT', () => {
    const parameters = new URLSearchParams(query());
    expect(parameters.get('COMMAND')).toBe("'399'");
    expect(parameters.get('START_TIME')).toBe("'2026-10-19 00:00:00'");
    expect(parameters.get('STOP_TIME')).toBe("'2026-10-20 00:00:00'");
    expect(parameters.get('REF_PLANE')).toBe("'FRAME'");
    expect(parameters.get('CENTER')).toBe("'500@10'");
    expect(parameters.get('OUT_UNITS')).toBe("'AU-D'");
    expect(parameters.get('TIME_TYPE')).toBe("'UT'");
    expect(parameters.get('VEC_CORR')).toBe("'NONE'");
  });
  it('coalesces equivalent quoted/case/order/time/step forms to one cache key', () => {
    expect(query("command='399'&STEP_SIZE='60 min'&START_TIME=2026-10-19T00:00Z&STOP_TIME=2026-10-20T00:00:00Z&REF_SYSTEM=icrf"))
      .toBe(query('STOP_TIME=2026-10-20&COMMAND=399&START_TIME=2026-10-19&STEP_SIZE=1h'));
  });
  it('supports all ten configured bodies and the 169-sample boundary', () => {
    for (const id of ['10', '199', '299', '399', '499', '599', '699', '799', '899', '301']) expect(query(`COMMAND=${id}`)).toContain(`COMMAND=%27${id}%27`);
    expect(query('START_TIME=2026-10-19&STOP_TIME=2026-10-26&STEP_SIZE=1h')).toContain('STEP_SIZE=%271+h%27');
  });
  it.each([
    'url=https://example.com', 'COMMAND=399&command=499', 'COMMAND=399%3B', 'COMMAND=TLE', 'COMMAND=99942',
    'format=text', 'CENTER=500@399', 'REF_PLANE=ECLIPTIC', 'REF_SYSTEM=B1950', 'EPHEM_TYPE=SPK',
    'OUT_UNITS=KM-S', 'VEC_CORR=LT', 'TIME_TYPE=TDB', 'MAKE_EPHEM=NO', 'TLIST=2461332.5',
    'START_TIME=2026-10-19', 'START_TIME=2026-02-30&STOP_TIME=2026-03-02',
    'START_TIME=2026-10-19&STOP_TIME=2026-10-19', 'START_TIME=2026-10-19&STOP_TIME=2026-10-27',
    'START_TIME=1961-12-31&STOP_TIME=1962-01-01', 'START_TIME=2101-01-01&STOP_TIME=2101-01-02',
    'STEP_SIZE=1', 'STEP_SIZE=1min', 'STEP_SIZE=90min', 'STEP_SIZE=0h', 'STEP_SIZE=8d',
    'COMMAND=%27%27399%27%27', 'COMMAND=399%0A',
  ])('rejects unsafe/ambiguous request %s', (value) => expect(() => query(value)).toThrow());
  it('caps URL length before parsing', () => expect(() => query(`COMMAND=${'1'.repeat(2100)}`)).toThrow('2048'));
});

describe('upstream payload validation and bounds', () => {
  it('accepts the raw Horizons v1.2 table-2 CSV wrapper verified on the deployed endpoint', () => expect(() => validatePayload(VALID_BODY)).not.toThrow());
  it('fails closed on the documented but unverified v1.3 signature', () => {
    expect(() => validatePayload(VALID_BODY.replace('"1.2"', '"1.3"'))).toThrow('signature');
  });
  it.each([
    '{}', 'not json', VALID_BODY.replace('"1.2"', '"1.4"'), VALID_BODY.replace('NASA/JPL Horizons API', 'other'),
    VALID_BODY.replace('$$SOE', 'missing'), VALID_BODY.replace('$$EOE', '$$EOE$$EOE'),
    VALID_BODY.replace('2461332.5,', ','), VALID_BODY.replace('2461332.5,', ' ,'),
    VALID_BODY.replace('1.0E+00', 'NaN'), VALID_BODY.replace('1.0E+00', '1e999'),
    JSON.stringify({ ...JSON.parse(VALID_BODY), error: 'Unavailable' }),
  ])('rejects malformed wrapper/vector content %#', (value) => expect(() => validatePayload(value)).toThrow());
  it('caps declared and streamed response sizes', async () => {
    await expect(boundedText(new Response('short', { headers: { 'Content-Length': String(MAX_RESPONSE_BYTES + 1) } }))).rejects.toThrow('size');
    await expect(boundedText(new Response('x'.repeat(MAX_RESPONSE_BYTES + 1)))).rejects.toThrow('size');
    await expect(boundedText(new Response(VALID_BODY))).resolves.toBe(VALID_BODY);
  });
  it('honors seconds and HTTP dates without negative/NaN cooldowns', () => {
    const now = Date.UTC(2026, 9, 19);
    expect(retryAfterMs('120', now)).toBe(120_000);
    expect(retryAfterMs('Mon, 19 Oct 2026 00:02:00 GMT', now)).toBe(120_000);
    expect(retryAfterMs('invalid', now)).toBe(0);
    expect(retryAfterMs('Sun, 18 Oct 2026 00:00:00 GMT', now)).toBe(0);
  });
});
