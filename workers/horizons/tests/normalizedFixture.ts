import earth from './fixtures/jpl-earth-2026-10-19.json';
import { BODY_COMMANDS, type EphemerisBodyId } from '../../../src/astronomy/ephemerisSnapshot';

/** Synthetic metadata transport fixture; other bodies deliberately reuse Earth values. */
export function syntheticBody(id: EphemerisBodyId): string {
  return JSON.stringify({ ...earth, result: earth.result.replace('Target body name: Earth (399)', `Target body name: ${id} (${BODY_COMMANDS[id]})`) });
}
export const REAL_EARTH_BODY = JSON.stringify(earth);
