import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import provenance from '../public/textures/provenance.json';
import { PLANET_VISUALS } from '../src/render/visualModel';

it('ships every referenced local texture with traceable license and intact image bytes', () => {
  const used = new Set([...Object.values(PLANET_VISUALS).map(value => value.texture), '2k_sun.jpg', '2k_moon.jpg', '2k_saturn_ring_alpha.png']);
  expect(new Set(provenance.map(record => record.file))).toEqual(used);
  for (const record of provenance) {
    const bytes = readFileSync(new URL(`../public/textures/${record.file}`, import.meta.url));
    expect(bytes.byteLength).toBe(record.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(record.sha256);
    expect(record.author).toBe('Solar System Scope / INOVE');
    expect(record.license).toBe('https://creativecommons.org/licenses/by/4.0/');
    expect(record.source).toBe(`https://www.solarsystemscope.com/textures/download/${record.file}`);
    expect(record.width).toBe(2048);
    expect(bytes.subarray(0, 2).toString('hex')).toBe(record.file.endsWith('.png') ? '8950' : 'ffd8');
  }
});
