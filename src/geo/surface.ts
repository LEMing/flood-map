import type { Params } from '../config';
import type { Heightmap } from './heightmap';
import { fetchLandCover, type LandClass } from './landcover';
import { fetchOsm, type OsmRasters } from './osm';
import { lonLatToLocalMeters } from './projection';

// Builds the per-cell urban-surface fields (infiltration, storm-drain capacity,
// roughness) from ESA WorldCover + OSM, and burns OSM buildings (raised no-flow
// obstacles) and roads (lowered channels) into the DEM. This is what turns the
// generic sheet-flow sim into a city flood model.

const MM_S = 1 / 1000 / 3600;
const BUILDING_RAISE_M = 5; // tall enough that flood depths never overtop
const ROAD_LOWER_M = 0.15; // curb-to-crown channel that routes water along streets

// Музыкальный микрорайон was built on a drained marsh with essentially no storm
// sewer — model it (and its surrounds) as a no-drainage zone.
const NO_DRAIN_CENTER = { lat: 45.0762, lon: 38.9988 };
const NO_DRAIN_RADIUS_M = 1300;

export interface SurfaceResult {
  surface: Float32Array; // N*N*4: r=infil m/s, g=drain m/s, b=roughness, a=building flag
  land: LandClass | null;
  osm: OsmRasters | null;
  counts: { buildings: number; roads: number };
}

function classifyInfilRoughness(
  building: boolean, road: boolean, water: boolean, green: boolean, lc: number, soilInfil: number,
): { infil: number; rough: number } {
  if (building) return { infil: 0.2, rough: 1.0 };
  if (water || lc === 80) return { infil: 0.0, rough: 1.0 };
  if (road) return { infil: 0.3, rough: 1.0 };
  if (green || lc === 30 || lc === 10 || lc === 20 || lc === 90 || lc === 100) {
    return { infil: soilInfil, rough: 0.22 }; // grass/tree/wetland — pervious, rough
  }
  if (lc === 40) return { infil: soilInfil * 0.6, rough: 0.4 }; // cropland
  if (lc === 50) return { infil: 0.5, rough: 1.0 }; // built-up (impervious)
  if (lc === 60) return { infil: soilInfil * 0.4, rough: 0.5 }; // bare
  return { infil: soilInfil * 0.5, rough: 0.4 };
}

/** Per-cell infiltration / drainage / roughness texture data — no DEM mutation,
 *  so it can be recomputed live when the drainage / groundwater sliders change. */
export function computeSurfaceFields(
  hm: Heightmap, land: LandClass | null, osm: OsmRasters | null, params: Params,
): Float32Array {
  const { N, sizeMeters } = hm;
  const surface = new Float32Array(N * N * 4);
  const soilInfil = params.infiltrationMmPerHr * (params.groundwaterHigh ? 0.25 : 1);
  const servedDrain = params.drainageCapacityMmPerHr;
  const [mzx, mzy] = lonLatToLocalMeters(hm.center, NO_DRAIN_CENTER.lon, NO_DRAIN_CENTER.lat);
  const step = sizeMeters / (N - 1);
  const half = sizeMeters / 2;

  for (let iy = 0; iy < N; iy++) {
    const cy = -half + iy * step;
    for (let ix = 0; ix < N; ix++) {
      const k = iy * N + ix;
      const building = !!osm?.building[k];
      const road = !!osm?.road[k] && !building;
      const water = !!osm?.water[k] && !building;
      const green = !!osm?.green[k] && !building && !road && !water;
      const lc = land ? land[k] : 30;
      const { infil, rough } = classifyInfilRoughness(building, road, water, green, lc, soilInfil);

      const cx = -half + ix * step;
      const inNoDrain = (cx - mzx) ** 2 + (cy - mzy) ** 2 < NO_DRAIN_RADIUS_M ** 2;
      const urban = building || road || lc === 50;
      const drain = urban && !inNoDrain ? servedDrain : 0;

      surface[k * 4] = infil * MM_S;
      surface[k * 4 + 1] = drain * MM_S;
      surface[k * 4 + 2] = Math.max(0.1, Math.min(1, rough));
      surface[k * 4 + 3] = building ? 1 : 0;
    }
  }
  return surface;
}

function burnHeights(hm: Heightmap, osm: OsmRasters, burnBuildings: boolean): void {
  for (let k = 0; k < hm.N * hm.N; k++) {
    if (burnBuildings && osm.building[k]) hm.data[k] += BUILDING_RAISE_M;
    else if (osm.road[k]) hm.data[k] -= ROAD_LOWER_M;
  }
}

/**
 * Fetch land cover + OSM for the area, burn buildings/roads into the heightmap,
 * and build the surface fields. Returns null if neither source loads. The raw
 * `land`/`osm` are returned so fields can be recomputed live on param changes.
 */
export async function buildSurface(hm: Heightmap, params: Params): Promise<SurfaceResult | null> {
  let land: LandClass | null = null;
  let osm: OsmRasters | null = null;
  await Promise.all([
    fetchLandCover(hm.center, hm.sizeMeters, hm.N).then((l) => { land = l; }).catch(() => {}),
    fetchOsm(hm.center, hm.sizeMeters, hm.N).then((o) => { osm = o; }).catch(() => {}),
  ]);
  if (!land && !osm) return null;
  if (osm) burnHeights(hm, osm, params.burnBuildings);
  return {
    surface: computeSurfaceFields(hm, land, osm, params),
    land,
    osm,
    counts: (osm as OsmRasters | null)?.counts ?? { buildings: 0, roads: 0 },
  };
}
