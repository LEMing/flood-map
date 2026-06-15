// Guardrail: every locale must mirror the English source catalog exactly.
// This is what was missing when new UI strings (pour, atmosphere, geology…)
// shipped to en/ru but never reached the other locales. The key-set check
// fails CI the moment a key is added to en without being added everywhere;
// the completeness check catches whole blocks left as English placeholders.

import { describe, it, expect } from 'vitest';
import { en } from './locales/en';

// Values that are legitimately identical to English in many languages
// (acronyms / symbols). Anything else counts toward translation drift.
const IDENTICAL_OK = new Set(['stats.fps']);

// Tolerance for genuine cognates (e.g. "water" in Dutch/Afrikaans, "vertical"
// in Romance languages). Wholesale untranslated blocks are far above this.
const MAX_COGNATES = 15;

type Catalog = Record<string, string>;

const modules = import.meta.glob<Record<string, Catalog>>('./locales/*.ts', { eager: true });
const locales: Array<{ code: string; catalog: Catalog }> = Object.entries(modules)
  .map(([path, mod]) => ({
    code: path.replace('./locales/', '').replace('.ts', ''),
    catalog: Object.values(mod)[0],
  }))
  .filter(({ code }) => code !== 'en');

const enKeys = Object.keys(en).sort();

describe('i18n locale parity', () => {
  it('has more than one locale to check', () => {
    expect(locales.length).toBeGreaterThan(1);
  });

  describe.each(locales)('$code', ({ catalog }) => {
    it('has exactly the English key set (no missing or extra keys)', () => {
      const keys = Object.keys(catalog).sort();
      const missing = enKeys.filter((k) => !(k in catalog));
      const extra = keys.filter((k) => !(k in en));
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    });

    it('is actually translated (not an English placeholder block)', () => {
      const stillEnglish = enKeys.filter(
        (k) => !IDENTICAL_OK.has(k) && catalog[k] === en[k],
      );
      expect(stillEnglish.length).toBeLessThanOrEqual(MAX_COGNATES);
    });
  });
});
