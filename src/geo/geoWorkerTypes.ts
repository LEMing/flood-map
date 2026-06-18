import type { ElevationSource, Params } from '../config';
import type { GeocodeResult } from './geocode';
import type { TerrainLoad } from './load';
import type { SurfaceResult } from './surface';

/** A request to build the terrain + surface for one location, off the main thread. */
export interface GeoLoadRequest {
  id: number;
  location: GeocodeResult;
  mapSizeKm: number;
  N: number;
  elevationSource: ElevationSource;
  useSurface: boolean;
  params: Params;
}

export interface GeoLoadResult extends TerrainLoad {
  surface: SurfaceResult | null;
}

/** Which part of the off-thread build is currently downloading. */
export type GeoStage = 'elevation' | 'features';

/** Incremental progress while the worker builds: the active stage + the bytes
 *  downloaded by this message's fetch (deltas; the client sums them). */
export interface GeoProgress {
  stage: GeoStage;
  bytes: number;
}

export type GeoWorkerResponse =
  | { id: number; ok: true; result: GeoLoadResult }
  | { id: number; ok: false; error: string }
  | { id: number; progress: GeoProgress };
