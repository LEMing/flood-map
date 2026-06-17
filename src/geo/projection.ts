import proj4 from 'proj4';
import type { LatLon } from './heightmap';

// Per the project convention: never hardcode earth radius / Web-Mercator
// constants. We derive everything from proj4's EPSG definitions and a local
// Azimuthal Equidistant projection centred on the area of interest.

const WGS84 = 'EPSG:4326';
const WEB_MERCATOR = 'EPSG:3857';

// proj4 ships these definitions, but define explicitly to be robust.
if (!proj4.defs(WEB_MERCATOR)) {
  proj4.defs(
    WEB_MERCATOR,
    '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs',
  );
}

// Half-width of the square Web-Mercator world, in projected metres, derived
// (not hardcoded) by projecting lon=180 at the equator.
const WORLD_HALF = proj4(WGS84, WEB_MERCATOR, [180, 0])[0];
const WORLD_SIZE = WORLD_HALF * 2;

export interface ProjectedGrid {
  /** lon/lat of every grid node, row-major [iy*N + ix], north-up. */
  lon: Float64Array;
  lat: Float64Array;
}

function aeqdDef(center: LatLon): string {
  return `+proj=aeqd +lat_0=${center.lat} +lon_0=${center.lon} +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`;
}

// A handful of loaders (DEM, land-cover, bathymetry, satellite) each need the
// same lon/lat grid for one world. Memoize the last few so the ~N*N proj4
// forward sweep runs once per (center, size, N) instead of per loader. The
// returned arrays are treated as read-only by every caller, so sharing is safe.
const GRID_CACHE: Array<{ key: string; grid: ProjectedGrid }> = [];
const GRID_CACHE_MAX = 2;

/**
 * Compute the lon/lat of every node of an `N×N` grid covering `sizeMeters` on
 * a side, centred on `center`, using a local equidistant projection so the
 * grid is metric and square on the ground. Row 0 = south, row N-1 = north.
 * Memoized per (center, size, N) — see GRID_CACHE.
 */
export function projectGrid(center: LatLon, sizeMeters: number, N: number): ProjectedGrid {
  const key = `${center.lat},${center.lon},${sizeMeters},${N}`;
  const hit = GRID_CACHE.find((e) => e.key === key);
  if (hit) return hit.grid;
  const grid = computeProjectedGrid(center, sizeMeters, N);
  GRID_CACHE.push({ key, grid });
  if (GRID_CACHE.length > GRID_CACHE_MAX) GRID_CACHE.shift();
  return grid;
}

function computeProjectedGrid(center: LatLon, sizeMeters: number, N: number): ProjectedGrid {
  const aeqd = aeqdDef(center);
  const toWgs = proj4(aeqd, WGS84);
  const lon = new Float64Array(N * N);
  const lat = new Float64Array(N * N);
  const half = sizeMeters / 2;
  const step = N > 1 ? sizeMeters / (N - 1) : 0;

  for (let iy = 0; iy < N; iy++) {
    const y = -half + iy * step; // south(-) -> north(+)
    for (let ix = 0; ix < N; ix++) {
      const x = -half + ix * step; // west(-) -> east(+)
      const [lo, la] = toWgs.forward([x, y]);
      const k = iy * N + ix;
      lon[k] = lo;
      lat[k] = la;
    }
  }
  return { lon, lat };
}

/** Inverse of the local grid projection: metric (east, north) → lon/lat. */
export function localMetersToLonLat(center: LatLon, x: number, y: number): [number, number] {
  const [lon, lat] = proj4(aeqdDef(center), WGS84).forward([x, y]);
  return [lon, lat];
}

/** lon/lat → local grid metres (east, north) relative to `center`. */
export function lonLatToLocalMeters(center: LatLon, lon: number, lat: number): [number, number] {
  const [x, y] = proj4(WGS84, aeqdDef(center)).forward([lon, lat]);
  return [x, y];
}

/** Global pixel coordinate (256px tiles) for a lon/lat at zoom `z`. */
export function lonLatToPixel(lon: number, lat: number, z: number): { gx: number; gy: number } {
  const [mx, my] = proj4(WGS84, WEB_MERCATOR, [lon, lat]);
  const u = (mx + WORLD_HALF) / WORLD_SIZE; // 0 west .. 1 east
  const v = (WORLD_HALF - my) / WORLD_SIZE; // 0 north .. 1 south (slippy convention)
  const worldPixels = 256 * Math.pow(2, z);
  return { gx: u * worldPixels, gy: v * worldPixels };
}

/**
 * Pick the slippy zoom level whose tile pixels are at least as fine as one
 * simulation cell, so we never upsample the DEM below the grid resolution.
 */
export function chooseZoom(center: LatLon, sizeMeters: number, N: number, maxZoom = 15): number {
  const cellSize = sizeMeters / N;
  const latScale = Math.cos((center.lat * Math.PI) / 180);
  const needed = (WORLD_SIZE * latScale) / (256 * cellSize);
  const z = Math.ceil(Math.log2(Math.max(1, needed)));
  return Math.max(0, Math.min(maxZoom, z));
}

/**
 * Pick the highest imagery zoom (= crispest) that still covers the area in no
 * more than `maxTiles` tiles, to bound the number of requests.
 */
export function chooseSatelliteZoom(
  center: LatLon,
  sizeMeters: number,
  maxTiles = 100,
  maxZoom = 18,
  minZoom = 12,
): number {
  const latScale = Math.cos((center.lat * Math.PI) / 180);
  for (let z = maxZoom; z >= minZoom; z--) {
    const groundPerTile = (WORLD_SIZE / Math.pow(2, z)) * latScale;
    const perSide = Math.ceil(sizeMeters / groundPerTile) + 1;
    if (perSide * perSide <= maxTiles) return z;
  }
  return minZoom;
}
