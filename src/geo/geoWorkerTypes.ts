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

export type GeoWorkerResponse =
  | { id: number; ok: true; result: GeoLoadResult }
  | { id: number; ok: false; error: string };
