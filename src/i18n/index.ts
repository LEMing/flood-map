import { en } from './locales/en';
import { ru } from './locales/ru';
import { uk } from './locales/uk';
import { tr } from './locales/tr';
import { de } from './locales/de';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { zh } from './locales/zh';
import { ja } from './locales/ja';
import { ko } from './locales/ko';
import { hi } from './locales/hi';
import { id } from './locales/id';
import { th } from './locales/th';
import { vi } from './locales/vi';

export type Lang =
  | 'en' | 'ru' | 'uk' | 'tr' | 'de' | 'es' | 'fr' | 'zh'
  | 'ja' | 'ko' | 'hi' | 'id' | 'th' | 'vi';

const LOCALES: Record<Lang, Record<string, string>> = {
  en, ru, uk, tr, de, es, fr, zh, ja, ko, hi, id, th, vi,
};

export const LANGUAGES: Array<{ code: Lang; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' },
  { code: 'uk', label: 'Українська' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'th', label: 'ไทย' },
  { code: 'vi', label: 'Tiếng Việt' },
];

// Country (ISO 3166-1 alpha-2) → the supported language most people there read.
// Used as a fallback when the IP provider doesn't return an explicit language
// list, so the UI can localize by region.
const COUNTRY_LANG: Partial<Record<string, Lang>> = {
  RU: 'ru', BY: 'ru', KZ: 'ru', KG: 'ru',
  UA: 'uk',
  TR: 'tr',
  DE: 'de', AT: 'de', CH: 'de', LI: 'de',
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es', VE: 'es',
  EC: 'es', GT: 'es', CU: 'es', BO: 'es', DO: 'es', HN: 'es', PY: 'es',
  SV: 'es', NI: 'es', CR: 'es', PA: 'es', UY: 'es',
  FR: 'fr', BE: 'fr', LU: 'fr', MC: 'fr',
  CN: 'zh', TW: 'zh', HK: 'zh', MO: 'zh', SG: 'zh',
  JP: 'ja',
  KR: 'ko',
  IN: 'hi',
  ID: 'id',
  TH: 'th',
  VN: 'vi',
};

function isLang(v: string | null): v is Lang {
  return !!v && LANGUAGES.some((l) => l.code === v);
}

function firstSupported(prefs: Iterable<string>): Lang | null {
  for (const p of prefs) {
    const code = p.slice(0, 2).toLowerCase();
    if (isLang(code)) return code;
  }
  return null;
}

function detectInitial(): Lang {
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (isLang(fromUrl)) return fromUrl;
  const saved = localStorage.getItem('lang');
  if (isLang(saved)) return saved;
  return firstSupported(navigator.languages ?? [navigator.language]) ?? 'en';
}

let current: Lang = detectInitial();

export function getLanguage(): Lang {
  return current;
}

/** True when the user pinned the language via URL or a prior explicit choice. */
export function hasExplicitLanguage(): boolean {
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (isLang(fromUrl)) return true;
  try {
    return isLang(localStorage.getItem('lang'));
  } catch {
    return false;
  }
}

/**
 * Smartest default language given the browser locale and (optional) IP geo.
 * Priority: an explicit non-English browser locale (the user set it on purpose)
 * → the IP country's language → the browser's English → English. A bare English
 * browser is treated as "unset", so visitors in a non-English country still get
 * a localized UI; an explicit non-English browser locale always wins.
 */
export function resolveSmartLanguage(
  ip: { countryCode?: string; languages?: string[] } | null,
): Lang {
  const navMatch = firstSupported(navigator.languages ?? [navigator.language]);
  if (navMatch && navMatch !== 'en') return navMatch;
  if (ip) {
    const byLanguages = firstSupported(ip.languages ?? []);
    if (byLanguages) return byLanguages;
    const byCountry = ip.countryCode ? COUNTRY_LANG[ip.countryCode] : undefined;
    if (byCountry) return byCountry;
  }
  return navMatch ?? 'en';
}

export function setLanguage(lang: Lang, persist = true): void {
  current = lang;
  if (!persist) return;
  try {
    localStorage.setItem('lang', lang);
  } catch {
    /* private mode */
  }
}

/** Translate a key, substituting {placeholders}. Falls back to English, then the key. */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = LOCALES[current][key] ?? en[key] ?? key;
  if (params) {
    for (const k of Object.keys(params)) s = s.replaceAll(`{${k}}`, String(params[k]));
  }
  return s;
}
