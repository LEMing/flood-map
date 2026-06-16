import type { ElevationSource } from '../config';
import { SOURCE_LABELS } from '../config';
import type { GeocodeResult } from './geocode';
import { geocode } from './geocode';
import { fetchElevation } from './elevationTiles';
import { fetchElevationCog } from './elevationCog';
import { computeMinMax, type Heightmap } from './heightmap';
import { syntheticHeightmap } from './syntheticTerrain';

/**
 * Bare-earth sources (FABDEM, GLO-30) are land-only and read ~0 over water, so
 * coasts look dry. Terrarium tiles carry real seabed depth (blended GEBCO/ETOPO),
 * so where the land DEM is at/below sea level we carve in the terrarium
 * bathymetry — giving the sea floor real relief while keeping land detail.
 */
function mergeBathymetry(land: Heightmap, bathy: Heightmap): void {
  const a = land.data;
  const b = bathy.data;
  if (a.length !== b.length) return;
  for (let i = 0; i < a.length; i++) {
    if (b[i] < -0.5 && a[i] < 2) a[i] = b[i];
  }
  const mm = computeMinMax(a);
  land.min = mm.min;
  land.max = mm.max;
}

export interface TerrainLoad {
  location: GeocodeResult;
  heightmap: Heightmap;
  sourceUsed: ElevationSource | 'synthetic';
  warning?: string;
}

async function fetchFrom(
  source: ElevationSource,
  location: GeocodeResult,
  sizeMeters: number,
  N: number,
): Promise<Heightmap> {
  return source === 'terrarium'
    ? fetchElevation(location, sizeMeters, N)
    : fetchElevationCog(source, location, sizeMeters, N);
}

/**
 * Geocode an address and fetch its DEM from the requested source. On failure it
 * falls back to terrarium (free/no-key), then to synthetic terrain, so the app
 * never hard-fails; geocode failures propagate.
 */
export async function loadTerrain(
  address: string,
  mapSizeKm: number,
  N: number,
  source: ElevationSource,
): Promise<TerrainLoad> {
  return loadTerrainAt(await geocode(address), mapSizeKm, N, source);
}

/** Fetch the DEM for an already-resolved location (e.g. typed coordinates). */
export async function loadTerrainAt(
  location: GeocodeResult,
  mapSizeKm: number,
  N: number,
  source: ElevationSource,
): Promise<TerrainLoad> {
  const sizeMeters = mapSizeKm * 1000;

  const order: ElevationSource[] = source === 'terrarium' ? ['terrarium'] : [source, 'terrarium'];
  let lastError = '';
  for (const s of order) {
    try {
      const heightmap = await fetchFrom(s, location, sizeMeters, N);
      // Coastal/low areas: blend in terrarium seabed depth so water reads as water.
      if (s !== 'terrarium' && heightmap.min < 5) {
        try {
          mergeBathymetry(heightmap, await fetchElevation(location, sizeMeters, N));
        } catch { /* no bathymetry available — keep the land DEM */ }
      }
      if (heightmap.max - heightmap.min < 1e-3) {
        lastError = 'no elevation relief';
        continue;
      }
      return {
        location,
        heightmap,
        sourceUsed: s,
        warning: s === source ? undefined : `${SOURCE_LABELS[source]} unavailable — used ${SOURCE_LABELS[s]}.`,
      };
    } catch (err) {
      lastError = (err as Error).message;
    }
  }

  return {
    location,
    heightmap: syntheticHeightmap(location, sizeMeters, N),
    sourceUsed: 'synthetic',
    warning: `Elevation data unavailable (${lastError}). Using synthetic terrain.`,
  };
}
