import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLANET_NAMES } from '../src/astronomy/planetEphemeris';
import { bodyLabel, resolveLanguage, type Language, type LanguagePreferences } from '../src/i18n';
import { SolarScene } from '../src/render/SolarScene';

afterEach(() => vi.unstubAllGlobals());

describe('system language and explicit language selection', () => {
  it.each([
    ['en-US', 'en'], ['en-GB', 'en'], ['zh', 'zh-CN'], ['zh-CN', 'zh-CN'], ['zh-SG', 'zh-CN'],
    ['zh-Hans', 'zh-CN'], ['zh-Hans-TW', 'zh-CN'], ['zh-TW', 'zh-TW'], ['zh-HK', 'zh-TW'],
    ['zh-MO', 'zh-TW'], ['zh-Hant', 'zh-TW'], ['zh-Hant-CN', 'zh-TW'], ['ZH_tw', 'zh-TW'],
  ] as const)('resolves system preference %s to %s', (language, expected) => {
    expect(resolveLanguage('auto', { language })).toBe(expected);
  });

  it('honors ordered supported preferences, then uses a primary-language fallback', () => {
    expect(resolveLanguage('auto', { languages: ['fr-FR', 'zh-Hant', 'en'], language: 'zh-CN' })).toBe('zh-TW');
    expect(resolveLanguage('auto', { languages: ['en-US', 'zh-CN'], language: 'zh-TW' })).toBe('en');
    expect(resolveLanguage('auto', { languages: [], language: 'zh-CN' })).toBe('zh-CN');
    expect(resolveLanguage('auto', { languages: ['de'], language: 'zh-TW' })).toBe('zh-TW');
  });

  it('falls back to English for unavailable, malformed or unsupported system preferences', () => {
    for (const source of [null, {}, { languages: [] }, { language: '' }, { language: 'fr-FR' }, { language: 'bad locale!' },
      { languages: [null, 12, '', 'invalid_locale'], language: null }, { languages: 'zh-TW' }]) {
      expect(resolveLanguage('auto', source as LanguagePreferences | null)).toBe('en');
    }
    const unavailable = Object.defineProperties({}, {
      languages: { get: () => { throw new Error('unavailable'); } },
      language: { get: () => { throw new Error('unavailable'); } },
    });
    expect(resolveLanguage('auto', unavailable)).toBe('en');
    expect(resolveLanguage('auto', { get languages(): string[] { throw new Error('unavailable'); }, language: 'zh-CN' })).toBe('zh-CN');
  });

  it('uses browser/CEF preferences by default and keeps explicit selections independent', () => {
    vi.stubGlobal('navigator', { languages: ['zh-HK'], language: 'en-US' });
    expect(resolveLanguage('auto')).toBe('zh-TW');
    for (const language of ['en', 'zh-CN', 'zh-TW'] as const) expect(resolveLanguage(language)).toBe(language);
    vi.stubGlobal('navigator', undefined);
    expect(resolveLanguage('auto')).toBe('en');
  });
});

describe('single-language celestial names', () => {
  const bodies = ['Sun', ...PLANET_NAMES, 'Moon'] as const;
  it('keeps stable astronomical IDs and translates every displayed body exactly once', () => {
    for (const language of ['en', 'zh-CN', 'zh-TW'] as const) {
      const labels = bodies.map(body => bodyLabel(body, language));
      expect(new Set(labels).size).toBe(10);
      for (const label of labels) {
        expect(label).not.toContain('·');
        expect(label).toMatch(language === 'en' ? /^[A-Za-z]+$/ : /^[\u3400-\u9fff]+$/);
      }
    }
    expect(bodyLabel('Sun', 'zh-CN')).toBe('太阳');
    expect(bodyLabel('Sun', 'zh-TW')).toBe('太陽');
    expect(bodyLabel('Earth', 'en')).toBe('Earth');
    expect(bodyLabel('Moon', 'zh-TW')).toBe('月球');
  });

  it('updates existing renderer label nodes without touching camera, meshes or time', () => {
    const labels = new Map(PLANET_NAMES.map(name => [name, { label: { textContent: name } }]));
    const scene = {
      disposed: false, language: 'en' as Language, sunLabel: { textContent: 'Sun' }, moonLabel: { textContent: 'Moon' },
      bodies: labels, lastLabelAt: 123, camera: {}, scene: {}, settings: { simulationUtc: '2026-10-21T00:00:00.000Z' },
    };
    const preserved = { camera: scene.camera, scene: scene.scene, settings: scene.settings, earth: labels.get('Earth')!.label };
    for (const language of ['zh-CN', 'zh-TW', 'en'] as const) {
      SolarScene.prototype.setLanguage.call(scene as unknown as SolarScene, language);
      expect(scene.sunLabel.textContent).toBe(bodyLabel('Sun', language));
      expect(scene.moonLabel.textContent).toBe(bodyLabel('Moon', language));
      expect(labels.get('Earth')!.label.textContent).toBe(bodyLabel('Earth', language));
      expect(scene.camera).toBe(preserved.camera);
      expect(scene.scene).toBe(preserved.scene);
      expect(scene.settings).toBe(preserved.settings);
      expect(labels.get('Earth')!.label).toBe(preserved.earth);
      expect(scene.lastLabelAt).toBe(-Infinity);
    }
  });
});
