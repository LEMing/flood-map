import type { GeoLoadRequest, GeoLoadResult, GeoWorkerResponse } from './geoWorkerTypes';

// Main-thread client for the geo build worker. A single lazily-created worker
// services all loads; requests are correlated by id. The app awaits the built
// heightmap + surface, then constructs the meshes on the main thread (WebGL).

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (r: GeoLoadResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./geoWorker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<GeoWorkerResponse>) => {
    const res = e.data;
    const p = pending.get(res.id);
    if (!p) return;
    pending.delete(res.id);
    if (res.ok) p.resolve(res.result);
    else p.reject(new Error(res.error));
  };
  w.onerror = (e) => {
    const err = new Error(`geo worker crashed: ${e.message}`);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker = null; // let the next call respawn it
  };
  worker = w;
  return w;
}

/** Build the terrain + (optional) surface for a location in the worker. */
export function loadTerrainInWorker(req: Omit<GeoLoadRequest, 'id'>): Promise<GeoLoadResult> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<GeoLoadResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ ...req, id } satisfies GeoLoadRequest);
  });
}
