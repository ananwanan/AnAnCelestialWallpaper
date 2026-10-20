import { describe, expect, it } from 'vitest';
import { UI_MESSAGES, providerDetail, provenanceLabel, uiMessage, type UiMessageKey } from '../src/app/uiMessages';

describe('UI translations', () => {
  it('has non-empty text and matching substitution fields for every supported language', () => {
    const placeholders = (text: string) => text.match(/\{\w+\}/g)?.sort() ?? [];
    for (const language of ['en', 'zh-CN', 'zh-TW'] as const) {
      expect(Object.keys(UI_MESSAGES[language]).sort()).toEqual(Object.keys(UI_MESSAGES.en).sort());
      for (const key of Object.keys(UI_MESSAGES.en) as UiMessageKey[]) {
        expect(UI_MESSAGES[language][key].trim(), `${language}.${key}`).not.toBe('');
        expect(placeholders(UI_MESSAGES[language][key]), `${language}.${key}`).toEqual(placeholders(UI_MESSAGES.en[key]));
      }
    }
  });

  it('substitutes satellite metadata without dropping raw diagnostic text', () => {
    expect(uiMessage('en', 'rejectedSatellite', { id: 25544, reason: 'Epoch outside supported window.' }))
      .toBe('Prediction refused for NORAD 25544: Epoch outside supported window.');
    expect(uiMessage('zh-TW', 'referenceEpoch', { epoch: '2026-10-21', retrievedAt: '2026-10-21T00:00:00Z' }))
      .toContain('來源資料取得：2026-10-21T00:00:00Z');
  });

  it('translates ordinary provider success and disabled states while retaining prediction limits', () => {
    const disabled = 'Satellite tracking is disabled; no satellite requests or propagation.';
    expect(providerDetail('zh-CN', disabled)).toBe('卫星追踪已关闭；不会请求或推算卫星。');
    for (const prefix of ['Cached', 'Live/Sync']) {
      const success = `${prefix} CelesTrak orbital elements; all displayed positions and trajectory arcs are local SGP4 predictions. TEME conversion approximates UT1=UTC and omits polar motion.`;
      expect(providerDetail('en', success)).toBe(success);
      expect(providerDetail('zh-CN', success)).toContain('本地 SGP4 预测');
      expect(providerDetail('zh-TW', success)).toContain('忽略極移');
    }
    expect(provenanceLabel('zh-CN', 'Local prediction')).toBe('本地预测');
    expect(provenanceLabel('en', 'Live/Sync')).toBe('Live/Sync');
  });

  it('preserves unrecognized upstream errors as diagnostics', () => {
    const diagnostic = 'Satellite service HTTP 503. Last valid orbital elements are retained when usable.';
    expect(providerDetail('zh-CN', diagnostic)).toBe(diagnostic);
    expect(providerDetail('zh-TW', diagnostic)).toBe(diagnostic);
  });
});
