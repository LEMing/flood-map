import type { GeoLoadRequest, GeoLoadResult, GeoProgress } from './geoWorkerTypes';
import { loadTerrainInWorker } from './loadInWorker';

// In-memory handoff between the landing prefetch and the sim build: the landing
// warms a place's world the moment it's chosen, and the sim consumes it instead
// of re-running the (expensive) off-thread DEM + OSM + surface build.
//
// The key intentionally omits `params` — the landing and the initial sim build
// both use the default-ish params (only km/grid, which ARE in the key, vary via
// URL), so a fresh visit always hits. A divergent param set just misses and
// re-fetches (correct, only slower).

export type WorldRequest = Omit<GeoLoadRequest, 'id'>;

const READY_MAX = 2; // bound the retained results (each is several MB)

const inflight = new Map<string, Promise<GeoLoadResult>>();
const ready = new Map<string, GeoLoadResult>();

function worldKey(r: WorldRequest): string {
  const { location: loc } = r;
  return `${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}|${r.mapSizeKm}|${r.N}|${r.elevationSource}|${r.useSurface}`;
}

function remember(key: string, res: GeoLoadResult): void {
  ready.set(key, res);
  while (ready.size > READY_MAX) {
    const oldest = ready.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    ready.delete(oldest);
  }
}

/** Warm a world in the background; resolves to the built result (also cached). */
export function prefetchWorld(req: WorldRequest): Promise<GeoLoadResult> {
  const key = worldKey(req);
  const cached = ready.get(key);
  if (cached) return Promise.resolve(cached);
  let pending = inflight.get(key);
  if (!pending) {
    pending = loadTerrainInWorker(req)
      .then((res) => { remember(key, res); inflight.delete(key); return res; })
      .catch((e) => { inflight.delete(key); throw e; });
    inflight.set(key, pending);
  }
  return pending;
}

/**
 * Get the world for `req`, reusing the landing's prefetch when available.
 * Consume-once: a result is handed out a single time so two live worlds never
 * alias the same backing arrays. A cold call runs the worker with progress.
 */
export function acquireWorld(
  req: WorldRequest,
  onProgress?: (p: GeoProgress) => void,
): Promise<GeoLoadResult> {
  const key = worldKey(req);
  const cached = ready.get(key);
  if (cached) { ready.delete(key); return Promise.resolve(cached); }
  const pending = inflight.get(key);
  if (pending) return pending.then((res) => { ready.delete(key); return res; });
  return loadTerrainInWorker(req, onProgress);
}
