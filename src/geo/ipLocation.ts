// Coarse IP geolocation (free, no API key) used only at startup to pick a
// sensible default map center and UI language when the URL doesn't pin them.
// Two key-less HTTPS+CORS providers are tried in order so a single outage or
// rate-limit doesn't disable the feature. The result is best-effort: any
// failure returns null and the caller falls back to the built-in default.

export interface IpLocation {
  lat: number;
  lon: number;
  city?: string;
  region?: string;
  countryCode?: string; // ISO 3166-1 alpha-2, uppercase
  languages: string[]; // ISO 639-1 codes, best-effort, ordered by prevalence
}

function parseLanguages(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  // ipapi.co returns e.g. "ru" or "uk,ru" or "en-US,es" — keep the base codes.
  return raw
    .split(',')
    .map((l) => l.trim().slice(0, 2).toLowerCase())
    .filter(Boolean);
}

async function fromIpapi(signal?: AbortSignal): Promise<IpLocation | null> {
  const res = await fetch('https://ipapi.co/json/', { signal });
  if (!res.ok) return null;
  const d = await res.json();
  if (d.error || typeof d.latitude !== 'number') return null;
  return {
    lat: d.latitude,
    lon: d.longitude,
    city: d.city || undefined,
    region: d.region || undefined,
    countryCode: (d.country_code || d.country || '').toUpperCase() || undefined,
    languages: parseLanguages(d.languages),
  };
}

async function fromIpwho(signal?: AbortSignal): Promise<IpLocation | null> {
  const res = await fetch('https://ipwho.is/', { signal });
  if (!res.ok) return null;
  const d = await res.json();
  if (!d.success || typeof d.latitude !== 'number') return null;
  return {
    lat: d.latitude,
    lon: d.longitude,
    city: d.city || undefined,
    region: d.region || undefined,
    countryCode: (d.country_code || '').toUpperCase() || undefined,
    languages: [], // ipwho.is omits languages; the country→language map fills in
  };
}

const PROVIDERS = [fromIpapi, fromIpwho];

export async function detectIpLocation(signal?: AbortSignal): Promise<IpLocation | null> {
  for (const provider of PROVIDERS) {
    try {
      const result = await provider(signal);
      if (result) return result;
    } catch {
      // network/CORS/parse failure → try the next provider
    }
  }
  return null;
}
