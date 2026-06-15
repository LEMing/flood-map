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

function isLang(v: string | null): v is Lang {
  return !!v && LANGUAGES.some((l) => l.code === v);
}

function detectInitial(): Lang {
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (isLang(fromUrl)) return fromUrl;
  const saved = localStorage.getItem('lang');
  if (isLang(saved)) return saved;
  const browser = navigator.language.slice(0, 2).toLowerCase();
  return isLang(browser) ? browser : 'en';
}

let current: Lang = detectInitial();

export function getLanguage(): Lang {
  return current;
}

export function setLanguage(lang: Lang): void {
  current = lang;
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
