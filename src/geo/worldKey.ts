import type { GeoLoadRequest } from './geoWorkerTypes';

export type WorldRequest = Omit<GeoLoadRequest, 'id'>;

// The handoff key intentionally omits `params` — the landing prefetch and the
// initial sim build both use the default-ish params (only km/grid, which ARE in
// the key, vary via URL), so a fresh visit always hits. A divergent param set
// just misses and re-fetches (correct, only slower).
export function worldKey(r: WorldRequest): string {
  const { location: loc } = r;
  return `${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}|${r.mapSizeKm}|${r.N}|${r.elevationSource}|${r.useSurface}`;
}
