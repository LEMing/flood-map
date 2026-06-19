// Web Worker that runs the per-load geo build (DEM fetch/decode/inpaint, ocean
// bathymetry, OSM rasterization, surface fields) off the main thread, so a world
// load doesn't jank the render loop. The decode path uses OffscreenCanvas +
// createImageBitmap, both available here. The built typed arrays are transferred
// back (zero-copy). Wired via src/geo/loadInWorker.ts.
import { loadTerrainAt } from './load';
import { buildSurface } from './surface';
import { clearDownloadSink, setDownloadSink } from './cache';
import type { GeoLoadRequest, GeoLoadResult, GeoStage, GeoWorkerResponse } from './geoWorkerTypes';

interface WorkerCtx {
  onmessage: ((e: MessageEvent<GeoLoadRequest>) => void) | null;
  postMessage(message: GeoWorkerResponse, transfer?: Transferable[]): void;
}
const ctx = self as unknown as WorkerCtx;

ctx.onmessage = (e) => {
  void handle(e.data);
};

async function handle(req: GeoLoadRequest): Promise<void> {
  // loadCenter serializes loads, so a module-level "current stage" is safe and
  // lets the cache's download sink tag each fetched chunk with the right stage.
  let stage: GeoStage = 'elevation';
  const sink = (bytes: number) => ctx.postMessage({ id: req.id, progress: { stage, bytes } });
  setDownloadSink(sink);
  try {
    ctx.postMessage({ id: req.id, progress: { stage: 'elevation', bytes: 0 } });
    const load = await loadTerrainAt(req.location, req.mapSizeKm, req.N, req.elevationSource);
    stage = 'features';
    ctx.postMessage({ id: req.id, progress: { stage: 'features', bytes: 0 } });
    const surface = req.useSurface ? await buildSurface(load.heightmap, req.params) : null;
    const result: GeoLoadResult = { ...load, surface };
    ctx.postMessage({ id: req.id, ok: true, result }, transferablesOf(result));
  } catch (err) {
    ctx.postMessage({ id: req.id, ok: false, error: (err as Error).message });
  } finally {
    clearDownloadSink(sink);
  }
}

/** Every freshly-allocated typed array in the result, transferred to avoid a copy. */
function transferablesOf(r: GeoLoadResult): Transferable[] {
  const t: Transferable[] = [r.heightmap.data.buffer];
  const s = r.surface;
  if (s) {
    t.push(s.surface.buffer);
    if (s.land) t.push(s.land.buffer);
    if (s.osm) t.push(s.osm.building.buffer, s.osm.road.buffer, s.osm.water.buffer, s.osm.green.buffer);
    const bg = s.buildingGeometry;
    if (bg) t.push(bg.position.buffer, bg.color.buffer, bg.ground.buffer);
  }
  return t;
}
