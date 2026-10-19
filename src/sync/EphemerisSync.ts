/** Initial infrastructure: optionally fetch a typed startup snapshot; no per-frame API calls. */
export interface EphemerisSnapshot {
  schemaVersion: number;
  source: string;
  retrievedAt: string;
  referenceFrame: string;
  origin: string;
  states: unknown[];
}

export class EphemerisSync {
  private lastSuccessMs = 0;
  private lastAttemptMs = 0;
  private intervalHours: 1 | 6 | 24;
  private pending = false;
  private failures = 0;
  snapshot: EphemerisSnapshot | null = null;
  state: 'offline' | 'local' | 'synced' | 'failed' = 'local';

  constructor(private readonly baseUrl: string | undefined, intervalHours: 1 | 6 | 24 = 6) {
    this.intervalHours = intervalHours;
    if (!baseUrl) this.state = 'offline';
  }

  setIntervalHours(hours: 1 | 6 | 24): void { this.intervalHours = hours; }

  async tick(at: Date): Promise<void> {
    if (!this.baseUrl || this.pending) return;
    const now = Date.now();
    const retryDelay = Math.min(6 * 3600_000, 60_000 * 2 ** Math.min(8, this.failures));
    if (now - this.lastAttemptMs < retryDelay) return;
    if (this.lastSuccessMs && now - this.lastSuccessMs < this.intervalHours * 3600_000) return;
    this.lastAttemptMs = now;
    this.pending = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const base = this.baseUrl.replace(/\/$/, '');
      const response = await fetch(`${base}/api/ephemeris?at=${encodeURIComponent(at.toISOString())}`, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload: unknown = await response.json();
      if (!validSnapshot(payload)) throw new Error('Invalid ephemeris snapshot schema');
      this.snapshot = payload;
      this.lastSuccessMs = now;
      this.failures = 0;
      // Snapshot is for data verification until time-window interpolation is implemented.
      this.state = 'synced';
    } catch (error) {
      this.state = 'failed';
      this.failures = Math.min(8, this.failures + 1);
      console.warn('Ephemeris sync unavailable; local ephemeris continues.', error);
    } finally {
      clearTimeout(timer);
      this.pending = false;
    }
  }
}

function validSnapshot(v: unknown): v is EphemerisSnapshot {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<EphemerisSnapshot>;
  return s.schemaVersion === 1 && typeof s.source === 'string' && typeof s.retrievedAt === 'string' &&
    !Number.isNaN(Date.parse(s.retrievedAt)) && s.referenceFrame === 'EQJ/J2000' && s.origin === 'Sun' && Array.isArray(s.states);
}
