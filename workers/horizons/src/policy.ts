export const UPSTREAM_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const STALE_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_RESPONSE_BYTES = 100 * 1024;
export const MAX_CACHE_ENTRIES = 128;
export const UPSTREAM_TIMEOUT_MS = 15_000;
export const MIN_UPSTREAM_SPACING_MS = 2_000;
export const MAX_REQUESTS_PER_HOUR = 60;
export const MAX_COALESCED_REQUESTS = 32;
export const CACHE_SCHEMA_VERSION = 1;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const BODY_IDS = new Set(['10', '199', '299', '399', '499', '599', '699', '799', '899', '301']);
const FIXED = {
  format: 'json',
  OBJ_DATA: 'NO',
  MAKE_EPHEM: 'YES',
  EPHEM_TYPE: 'VECTORS',
  CENTER: '500@10',
  REF_PLANE: 'FRAME',
  REF_SYSTEM: 'ICRF',
  OUT_UNITS: 'AU-D',
  VEC_CORR: 'NONE',
  VEC_TABLE: '2',
  CSV_FORMAT: 'YES',
  TIME_TYPE: 'UT',
  CAL_TYPE: 'GREGORIAN',
  VEC_LABELS: 'NO',
  TIME_DIGITS: 'SECONDS',
} as const;
const KEY_NAMES = new Map([
  ...Object.keys(FIXED).map((key) => [key.toUpperCase(), key] as const),
  ...['COMMAND', 'START_TIME', 'STOP_TIME', 'STEP_SIZE'].map((key) => [key, key] as const),
]);

export class PolicyError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function unquote(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new PolicyError('Invalid parameter value.');
  let result = value.trim();
  if (result.startsWith("'") && result.endsWith("'")) result = result.slice(1, -1);
  if (!result || result.length > 80 || /['"\r\n\0]/.test(result)) {
    throw new PolicyError('Invalid parameter value.');
  }
  return result;
}

function parseUtc(value: string): number {
  // A bare Horizons calendar time is explicitly UT; no locale-dependent parsing.
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::(\d{2}))?Z?)?$/.exec(value);
  if (!match) throw new PolicyError('Use UTC YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ.');
  const normalized = `${match[1]}T${match[2] ?? '00:00'}:${match[3] ?? '00'}Z`;
  const time = Date.parse(normalized);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 19) !== normalized.slice(0, 19)
      || time < Date.UTC(1962, 0, 1) || time >= Date.UTC(2101, 0, 1)) {
    throw new PolicyError('Invalid UTC date; supported years are 1962 through 2100.');
  }
  return time;
}

function formatUtc(time: number): string { return new Date(time).toISOString().slice(0, 19).replace('T', ' '); }

export function canonicalQuery(url: URL, now = Date.now()): string {
  if (url.href.length > 2048) throw new PolicyError('URL exceeds 2048 characters.', 414);
  const values = new Map<string, string>();
  for (const [rawKey, rawValue] of url.searchParams) {
    const key = KEY_NAMES.get(rawKey.toUpperCase());
    if (!key || values.has(key)) throw new PolicyError('Unknown or duplicate query parameter.');
    values.set(key, unquote(rawValue));
  }
  for (const [key, required] of Object.entries(FIXED)) {
    const supplied = values.get(key);
    if (supplied !== undefined && supplied.toUpperCase() !== required.toUpperCase()) {
      throw new PolicyError(`${key} must be ${required}.`);
    }
    values.set(key, required);
  }
  const body = values.get('COMMAND') ?? '399';
  if (!BODY_IDS.has(body)) throw new PolicyError('COMMAND must be a supported Sun, planet, or Moon body ID.');
  values.set('COMMAND', body);
  const hasStart = values.has('START_TIME');
  if (hasStart !== values.has('STOP_TIME')) throw new PolicyError('Provide START_TIME and STOP_TIME together.');
  const today = new Date(now).toISOString().slice(0, 10);
  const start = parseUtc(values.get('START_TIME') ?? today);
  const stop = hasStart ? parseUtc(values.get('STOP_TIME')!) : start + DAY_MS;
  if (stop <= start || stop - start > 7 * DAY_MS) throw new PolicyError('Time window must be positive and at most 7 days.');
  const step = /^(\d{1,5})\s*(h|hours?|d|days?|m|min|minutes?)$/i.exec(values.get('STEP_SIZE') ?? '1 h');
  if (!step) throw new PolicyError('STEP_SIZE must be an integer number of hours, days, or minutes.');
  const unit = step[2]!.toLowerCase()[0];
  const interval = Number(step[1]) * (unit === 'd' ? DAY_MS : unit === 'h' ? HOUR_MS : 60_000);
  if (interval < HOUR_MS || interval > 7 * DAY_MS || interval % HOUR_MS !== 0 || Math.floor((stop - start) / interval) + 1 > 169) {
    throw new PolicyError('STEP_SIZE must be whole hours, at least 1 hour, at most 7 days; maximum 169 samples.');
  }
  values.set('START_TIME', formatUtc(start));
  values.set('STOP_TIME', formatUtc(stop));
  values.set('STEP_SIZE', `${interval / HOUR_MS} h`);
  const parameters = new URLSearchParams();
  for (const [key, value] of [...values].sort(([a], [b]) => a.localeCompare(b))) {
    parameters.set(key, key === 'format' ? value : `'${value}'`);
  }
  return parameters.toString();
}

export function validatePayload(text: string): void {
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new Error('Upstream did not return JSON.'); }
  if (!body || typeof body !== 'object') throw new Error('Invalid Horizons response.');
  const value = body as { error?: unknown; signature?: { source?: unknown; version?: unknown }; result?: unknown };
  if ('error' in value || value.signature?.version !== '1.2' || value.signature.source !== 'NASA/JPL Horizons API'
      || typeof value.result !== 'string') throw new Error('Unrecognized Horizons API signature or error.');
  const sections = value.result.split('$$SOE');
  if (sections.length !== 2 || sections[1]!.split('$$EOE').length !== 2) throw new Error('Invalid ephemeris delimiters.');
  const records = sections[1]!.split('$$EOE')[0]!.trim().split(/\r?\n/);
  if (!records.length || records.length > 169) throw new Error('Invalid ephemeris sample count.');
  // Table 2 CSV has Julian date, calendar date, and six position/velocity numbers.
  for (const record of records) {
    const columns = record.split(',').map((value) => value.trim());
    if (columns.at(-1) === '') columns.pop();
    if (columns.length !== 8 || !/^\d+(?:\.\d+)?$/.test(columns[0] ?? '') || !Number.isFinite(Number(columns[0])) || Number(columns[0]) <= 0 || !columns[1]
        || columns.slice(2).some((value) => !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value)))) {
      throw new Error('Invalid vector table.');
    }
  }
}

export function retryAfterMs(value: string | null, now: number): number {
  if (!value) return 0;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - now;
  // Persist a bounded cooldown even if a provider sends a malformed or enormous value.
  return Number.isFinite(seconds) ? Math.min(24 * DAY_MS, Math.max(0, seconds)) : 0;
}

export function errorResponse(message: string, status: number, retryMs = 0): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  if (retryMs > 0) headers.set('Retry-After', String(Math.max(1, Math.ceil(retryMs / 1000))));
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

export async function boundedText(response: Response, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) { void response.body?.cancel().catch(() => undefined); throw new Error('Horizons request aborted.'); }
  const declared = Number(response.headers.get('Content-Length'));
  if (declared > MAX_RESPONSE_BYTES) { void response.body?.cancel().catch(() => undefined); throw new Error('Upstream response exceeds size limit.'); }
  if (!response.body) throw new Error('Empty upstream response.');
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel('Horizons request aborted').catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error('Upstream response exceeds size limit.');
      chunks.push(value);
    }
  } catch (error) { void reader.cancel('Invalid Horizons body').catch(() => undefined); throw error; }
  finally { signal?.removeEventListener('abort', abort); reader.releaseLock(); }
  if (signal?.aborted) throw new Error('Horizons request aborted.');
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
}
