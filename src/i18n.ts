import type { PlanetName } from './astronomy/planetEphemeris';
import type { LanguageSetting } from './settings/Settings';

export type Language = 'en' | 'zh-CN' | 'zh-TW';
export type CelestialBodyName = PlanetName | 'Sun' | 'Moon';
export interface LanguagePreferences {
  readonly languages?: readonly string[];
  readonly language?: string;
}

function browserPreferences(): LanguagePreferences | null {
  try { return typeof navigator === 'undefined' ? null : navigator; }
  catch { return null; }
}

function supportedLanguage(value: unknown): Language | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  let parts: string[];
  try { parts = Intl.getCanonicalLocales(value.trim().replace(/_/g, '-'))[0]!.toLowerCase().split('-'); }
  catch { return null; }
  if (parts[0] === 'en') return 'en';
  if (parts[0] !== 'zh') return null;
  // An explicit script takes precedence over the region (e.g. zh-Hans-TW).
  if (parts.includes('hans')) return 'zh-CN';
  if (parts.includes('hant')) return 'zh-TW';
  return parts.some(part => part === 'tw' || part === 'hk' || part === 'mo') ? 'zh-TW' : 'zh-CN';
}

/** Use browser/CEF-exposed preferred languages; unavailable or unsupported => English. */
export function resolveLanguage(setting: LanguageSetting, source: LanguagePreferences | null = browserPreferences()): Language {
  if (setting !== 'auto') return setting;
  const candidates: unknown[] = [];
  // Some embedded hosts restrict navigator getters; one failure must not prevent startup.
  try { if (Array.isArray(source?.languages)) candidates.push(...source.languages); } catch { /* Try the primary language. */ }
  try { candidates.push(source?.language); } catch { /* Fall back to English. */ }
  for (const candidate of candidates) {
    const language = supportedLanguage(candidate);
    if (language) return language;
  }
  return 'en';
}

const BODY_LABELS = {
  en: { Sun: 'Sun', Mercury: 'Mercury', Venus: 'Venus', Earth: 'Earth', Mars: 'Mars', Jupiter: 'Jupiter', Saturn: 'Saturn', Uranus: 'Uranus', Neptune: 'Neptune', Moon: 'Moon' },
  'zh-CN': { Sun: '太阳', Mercury: '水星', Venus: '金星', Earth: '地球', Mars: '火星', Jupiter: '木星', Saturn: '土星', Uranus: '天王星', Neptune: '海王星', Moon: '月球' },
  'zh-TW': { Sun: '太陽', Mercury: '水星', Venus: '金星', Earth: '地球', Mars: '火星', Jupiter: '木星', Saturn: '土星', Uranus: '天王星', Neptune: '海王星', Moon: '月球' },
} as const satisfies Record<Language, Record<CelestialBodyName, string>>;

/** Presentation names are separate from stable ephemeris IDs and never bilingual. */
export function bodyLabel(body: CelestialBodyName, language: Language): string { return BODY_LABELS[language][body]; }
