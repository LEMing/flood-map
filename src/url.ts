import type { ElevationSource, StormType, TerrainStyle } from './config';

// Shareable URL state: ?lat=..&lon=..&km=..&grid=..&lang=..&demo=.. plus the
// scenario knobs (storm/style/src/water/ve/b3d/overlay) — kept in sync with the
// view so a copied /sim link reopens the exact scene, not just the location.
// Scenario params are written only when they differ from the defaults, so a
// vanilla view stays a clean lat/lon/km/grid URL.

const STORMS: readonly StormType[] = ['constant', 'cloudburst', 'design25yr', 'may2026', 'jun2026'];
const STYLES: readonly TerrainStyle[] = ['satellite', 'hypsometric', 'heatmap', 'surface'];
const SOURCES: readonly ElevationSource[] = ['glo30', 'fabdem', 'terrarium'];

export interface UrlState {
  lat?: number;
  lon?: number;
  km?: number;
  grid?: number;
  lang?: string;
  demo?: boolean;
  // Scenario (shareable look/storm/source/flood knobs)
  storm?: StormType;
  style?: TerrainStyle;
  src?: ElevationSource;
  water?: number; // live flood level (+m); presence implies floodLevelLive
  ve?: number; // vertical exaggeration
  b3d?: boolean; // 3D buildings
  overlay?: boolean; // flood-extent overlay
}

export function readUrlState(): UrlState {
  const p = new URLSearchParams(window.location.search);
  // Strict parse (Number, not parseFloat, so "5junk" is rejected) + an optional
  // clamp, so a typo'd or hostile deep link (?km=1e9, ?water=-9999) can never
  // push an out-of-range value past the UI sliders into the sim/geometry.
  const num = (k: string, min?: number, max?: number): number | undefined => {
    const v = p.get(k);
    if (v === null || v === '') return undefined;
    const n = Number(v);
    if (!isFinite(n)) return undefined;
    return min !== undefined && max !== undefined ? Math.min(max, Math.max(min, n)) : n;
  };
  const bool = (k: string): boolean | undefined => {
    const v = p.get(k);
    return v === null ? undefined : v === '1' || v === 'true';
  };
  const oneOf = <T extends string>(k: string, allowed: readonly T[]): T | undefined => {
    const v = p.get(k);
    return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
  };
  return {
    // grid is left unbounded here — App whitelists it against GRID_RESOLUTIONS.
    lat: num('lat', -90, 90), lon: num('lon', -180, 180), km: num('km', 0.5, 20), grid: num('grid'),
    lang: p.get('lang') ?? undefined,
    demo: bool('demo'),
    storm: oneOf('storm', STORMS),
    style: oneOf('style', STYLES),
    src: oneOf('src', SOURCES),
    water: num('water', 0, 50),
    ve: num('ve', 1, 5),
    b3d: bool('b3d'),
    overlay: bool('overlay'),
  };
}

type Encoder = (v: unknown) => string | undefined; // undefined → delete the param
const fixed = (digits: number): Encoder => (v) => (v === undefined ? undefined : (v as number).toFixed(digits));
const plain: Encoder = (v) => (v === undefined ? undefined : String(v));
const flag: Encoder = (v) => (v === undefined ? undefined : v ? '1' : '0');
const onlyTrue: Encoder = (v) => (v ? '1' : undefined);

const ENCODERS: Partial<Record<keyof UrlState, Encoder>> = {
  lat: fixed(5), lon: fixed(5), km: plain, grid: plain, lang: plain, demo: onlyTrue,
  storm: plain, style: plain, src: plain, water: fixed(2), ve: fixed(2), b3d: flag, overlay: flag,
};

/** Merge the given fields into the URL query without reloading the page. A field
 *  whose encoder yields `undefined` (e.g. a scenario value equal to its default)
 *  is removed, so a vanilla view stays a clean lat/lon/km/grid URL. */
export function writeUrlState(patch: UrlState): void {
  const p = new URLSearchParams(window.location.search);
  for (const key of Object.keys(patch) as (keyof UrlState)[]) {
    const encoded = ENCODERS[key]?.(patch[key]);
    if (encoded === undefined || encoded === '') p.delete(key);
    else p.set(key, encoded);
  }
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
