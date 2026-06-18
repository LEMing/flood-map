import { en } from './locales/en';

export type Lang =
  | 'en' | 'ru' | 'uk' | 'tr' | 'de' | 'es' | 'fr' | 'zh'
  | 'ja' | 'ko' | 'hi' | 'id' | 'th' | 'vi'
  | 'pt' | 'ar' | 'it' | 'pl' | 'nl' | 'el' | 'bn' | 'fa'
  | 'ur' | 'ms' | 'ta' | 'ro' | 'sw' | 'cs' | 'sv' | 'he'
  | 'kk' | 'uz' | 'az' | 'hy' | 'ka' | 'be' | 'ky' | 'tg' | 'tk'
  | 'am' | 'ha' | 'yo' | 'ig' | 'zu' | 'af' | 'so'
  | 'pa' | 'mr' | 'te' | 'gu' | 'kn' | 'ml' | 'or' | 'yue' | 'wuu'
  | 'jv' | 'su' | 'ps' | 'tl' | 'my';

type Catalog = Record<string, string>;

// Every non-English catalog is lazy: Vite code-splits each locale into its own
// chunk, so the initial bundle ships only English (~5 KB) rather than all 60
// catalogs (~1.4 MB). loadLanguage() pulls the active one in before first paint;
// until it resolves, t() falls back to English.
const LOADERS: Record<string, () => Promise<unknown>> = {};
for (const [path, loader] of Object.entries(import.meta.glob('./locales/*.ts'))) {
  const code = path.replace('./locales/', '').replace('.ts', '');
  if (code !== 'en') LOADERS[code] = loader;
}

const loaded: Partial<Record<Lang, Catalog>> = { en };

/** Pull a locale's catalog into the cache (no-op if already loaded or unknown). */
export async function loadLanguage(lang: Lang): Promise<void> {
  if (loaded[lang] || !LOADERS[lang]) return;
  const mod = (await LOADERS[lang]()) as Record<string, Catalog>;
  loaded[lang] = Object.values(mod)[0]; // each file has one named catalog export
}

export interface LanguageDef {
  code: Lang;
  label: string; // endonym (native name) shown in the picker
  english: string; // English name, so search matches "german", "greek", …
  rtl?: boolean;
}

export const LANGUAGES: LanguageDef[] = [
  { code: 'en', label: 'English', english: 'English' },
  { code: 'ru', label: 'Русский', english: 'Russian' },
  { code: 'uk', label: 'Українська', english: 'Ukrainian' },
  { code: 'tr', label: 'Türkçe', english: 'Turkish' },
  { code: 'de', label: 'Deutsch', english: 'German' },
  { code: 'es', label: 'Español', english: 'Spanish' },
  { code: 'fr', label: 'Français', english: 'French' },
  { code: 'zh', label: '中文', english: 'Chinese' },
  { code: 'ja', label: '日本語', english: 'Japanese' },
  { code: 'ko', label: '한국어', english: 'Korean' },
  { code: 'hi', label: 'हिन्दी', english: 'Hindi' },
  { code: 'id', label: 'Bahasa Indonesia', english: 'Indonesian' },
  { code: 'th', label: 'ไทย', english: 'Thai' },
  { code: 'vi', label: 'Tiếng Việt', english: 'Vietnamese' },
  { code: 'pt', label: 'Português', english: 'Portuguese' },
  { code: 'ar', label: 'العربية', english: 'Arabic', rtl: true },
  { code: 'it', label: 'Italiano', english: 'Italian' },
  { code: 'pl', label: 'Polski', english: 'Polish' },
  { code: 'nl', label: 'Nederlands', english: 'Dutch' },
  { code: 'el', label: 'Ελληνικά', english: 'Greek' },
  { code: 'bn', label: 'বাংলা', english: 'Bengali' },
  { code: 'fa', label: 'فارسی', english: 'Persian', rtl: true },
  { code: 'ur', label: 'اردو', english: 'Urdu', rtl: true },
  { code: 'ms', label: 'Bahasa Melayu', english: 'Malay' },
  { code: 'ta', label: 'தமிழ்', english: 'Tamil' },
  { code: 'ro', label: 'Română', english: 'Romanian' },
  { code: 'sw', label: 'Kiswahili', english: 'Swahili' },
  { code: 'cs', label: 'Čeština', english: 'Czech' },
  { code: 'sv', label: 'Svenska', english: 'Swedish' },
  { code: 'he', label: 'עברית', english: 'Hebrew', rtl: true },
  { code: 'kk', label: 'Қазақша', english: 'Kazakh' },
  { code: 'uz', label: 'Oʻzbekcha', english: 'Uzbek' },
  { code: 'az', label: 'Azərbaycan', english: 'Azerbaijani' },
  { code: 'hy', label: 'Հայերեն', english: 'Armenian' },
  { code: 'ka', label: 'ქართული', english: 'Georgian' },
  { code: 'be', label: 'Беларуская', english: 'Belarusian' },
  { code: 'ky', label: 'Кыргызча', english: 'Kyrgyz' },
  { code: 'tg', label: 'Тоҷикӣ', english: 'Tajik' },
  { code: 'tk', label: 'Türkmençe', english: 'Turkmen' },
  { code: 'am', label: 'አማርኛ', english: 'Amharic' },
  { code: 'ha', label: 'Hausa', english: 'Hausa' },
  { code: 'yo', label: 'Yorùbá', english: 'Yoruba' },
  { code: 'ig', label: 'Igbo', english: 'Igbo' },
  { code: 'zu', label: 'isiZulu', english: 'Zulu' },
  { code: 'af', label: 'Afrikaans', english: 'Afrikaans' },
  { code: 'so', label: 'Soomaali', english: 'Somali' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ', english: 'Punjabi' },
  { code: 'mr', label: 'मराठी', english: 'Marathi' },
  { code: 'te', label: 'తెలుగు', english: 'Telugu' },
  { code: 'gu', label: 'ગુજરાતી', english: 'Gujarati' },
  { code: 'kn', label: 'ಕನ್ನಡ', english: 'Kannada' },
  { code: 'ml', label: 'മലയാളം', english: 'Malayalam' },
  { code: 'or', label: 'ଓଡ଼ିଆ', english: 'Odia' },
  { code: 'yue', label: '粵語', english: 'Cantonese' },
  { code: 'wuu', label: '吳語', english: 'Wu Chinese' },
  { code: 'jv', label: 'Basa Jawa', english: 'Javanese' },
  { code: 'su', label: 'Basa Sunda', english: 'Sundanese' },
  { code: 'ps', label: 'پښتو', english: 'Pashto', rtl: true },
  { code: 'tl', label: 'Tagalog', english: 'Tagalog' },
  { code: 'my', label: 'မြန်မာ', english: 'Burmese' },
];

// Country (ISO 3166-1 alpha-2) → the supported language most people there read.
// Used as a fallback when the IP provider doesn't return an explicit language
// list, so the UI can localize by region.
const COUNTRY_LANG: Partial<Record<string, Lang>> = {
  RU: 'ru',
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
  MM: 'my',
  PH: 'tl',
  PT: 'pt', BR: 'pt', AO: 'pt', MZ: 'pt',
  SA: 'ar', AE: 'ar', EG: 'ar', DZ: 'ar', IQ: 'ar', MA: 'ar', JO: 'ar',
  KW: 'ar', QA: 'ar', LB: 'ar', LY: 'ar', TN: 'ar', OM: 'ar', BH: 'ar',
  IT: 'it', SM: 'it', VA: 'it',
  PL: 'pl',
  NL: 'nl',
  GR: 'el', CY: 'el',
  BD: 'bn',
  IR: 'fa', AF: 'fa',
  PK: 'ur',
  MY: 'ms', BN: 'ms',
  LK: 'ta',
  RO: 'ro', MD: 'ro',
  KE: 'sw', TZ: 'sw', UG: 'sw',
  CZ: 'cs',
  SE: 'sv',
  IL: 'he',
  KZ: 'kk',
  UZ: 'uz',
  AZ: 'az',
  AM: 'hy',
  GE: 'ka',
  BY: 'be',
  KG: 'ky',
  TJ: 'tg',
  TM: 'tk',
  ET: 'am',
  NE: 'ha',
  NG: 'ha',
  ZA: 'af',
  SO: 'so',
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
  // No DOM (e.g. a Web Worker imports the catalog transitively): nothing to
  // localize there, so don't touch window/localStorage — just default to English.
  if (typeof window === 'undefined') return 'en';
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (isLang(fromUrl)) return fromUrl;
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('lang');
  } catch {
    /* private mode */
  }
  if (isLang(saved)) return saved;
  return firstSupported(navigator.languages ?? [navigator.language]) ?? 'en';
}

let current: Lang = detectInitial();

export function getLanguage(): Lang {
  return current;
}

/** Whether the given (or current) language is written right-to-left. */
export function isRTL(lang: Lang = current): boolean {
  return !!LANGUAGES.find((l) => l.code === lang)?.rtl;
}

/** Reflect the active language onto <html lang/dir> (so RTL mirrors the page). */
export function applyDocumentLang(): void {
  if (typeof document === 'undefined') return; // no-op off the main thread (worker)
  document.documentElement.lang = current;
  document.documentElement.dir = isRTL() ? 'rtl' : 'ltr';
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
  let s = loaded[current]?.[key] ?? en[key] ?? key;
  if (params) {
    for (const k of Object.keys(params)) s = s.replaceAll(`{${k}}`, String(params[k]));
  }
  return s;
}
