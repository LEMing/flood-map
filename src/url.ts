// Shareable URL state: ?lat=..&lon=..&km=..&grid=..&lang=..&demo=.. — kept in
// sync with the loaded view so a URL can be copied/pasted to reopen it exactly.

export interface UrlState {
  lat?: number;
  lon?: number;
  km?: number;
  grid?: number;
  lang?: string;
  demo?: boolean;
}

export function readUrlState(): UrlState {
  const p = new URLSearchParams(window.location.search);
  const num = (k: string): number | undefined => {
    const v = p.get(k);
    if (v === null) return undefined;
    const n = parseFloat(v);
    return isFinite(n) ? n : undefined;
  };
  const demoRaw = p.get('demo');
  return {
    lat: num('lat'), lon: num('lon'), km: num('km'), grid: num('grid'),
    lang: p.get('lang') ?? undefined,
    demo: demoRaw === null ? undefined : demoRaw === '1' || demoRaw === 'true',
  };
}

/** Merge the given fields into the URL query without reloading the page. */
export function writeUrlState(patch: UrlState): void {
  const p = new URLSearchParams(window.location.search);
  const set = (k: string, v: string | number | undefined) => {
    if (v === undefined || v === '') p.delete(k);
    else p.set(k, String(v));
  };
  if ('lat' in patch) set('lat', patch.lat?.toFixed(5));
  if ('lon' in patch) set('lon', patch.lon?.toFixed(5));
  if ('km' in patch) set('km', patch.km);
  if ('grid' in patch) set('grid', patch.grid);
  if ('lang' in patch) set('lang', patch.lang);
  if ('demo' in patch) set('demo', patch.demo ? '1' : undefined);
  const qs = p.toString();
  window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
}

/** Parse "lat, lon" (also "lat lon" / "lat;lon") into coordinates, or null. */
export function parseCoords(text: string): { lat: number; lon: number } | null {
  const m = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lon = parseFloat(m[2]);
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

export function formatCoords(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
