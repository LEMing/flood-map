import { fromUrl } from 'geotiff';
import type { LatLon } from './heightmap';
import { projectGrid } from './projection';

// ESA WorldCover 10 m (v200, 2021) land-cover classes, read from the public COG
// tiles (3°×3°, named by SW corner in 3° steps). Used to build per-cell
// infiltration / roughness / imperviousness for the urban flood model.
//
// Class codes: 10 tree, 20 shrub, 30 grassland, 40 cropland, 50 built-up,
// 60 bare, 70 snow, 80 water, 90 wetland, 95 mangrove, 100 moss.

export type LandClass = Uint8Array; // N*N, row-major (iy*N+ix), north-up

const NATIVE_DEG = 10 / 111320; // ~10 m
const TILE_DEG = 3;
const MAX_TILES = 4;

function tileUrl(latSW: number, lonSW: number): string {
  const lat = `${latSW >= 0 ? 'N' : 'S'}${String(Math.abs(latSW)).padStart(2, '0')}`;
  const lon = `${lonSW >= 0 ? 'E' : 'W'}${String(Math.abs(lonSW)).padStart(3, '0')}`;
  return `/api/worldcover/v200/2021/map/ESA_WorldCover_10m_2021_v200_${lat}${lon}_Map.tif`;
}

interface Patch {
  minLon: number; maxLon: number; minLat: number; maxLat: number;
  w: number; h: number; data: ArrayLike<number>;
}

function samplePatch(p: Patch, lon: number, lat: number): number | null {
  if (lon < p.minLon || lon > p.maxLon || lat < p.minLat || lat > p.maxLat) return null;
  const fx = ((lon - p.minLon) / (p.maxLon - p.minLon)) * (p.w - 1);
  const fy = ((p.maxLat - lat) / (p.maxLat - p.minLat)) * (p.h - 1); // row 0 = north
  const x = Math.min(p.w - 1, Math.max(0, Math.round(fx)));
  const y = Math.min(p.h - 1, Math.max(0, Math.round(fy)));
  return p.data[y * p.w + x] as number;
}

export async function fetchLandCover(
  center: LatLon,
  sizeMeters: number,
  N: number,
): Promise<LandClass> {
  const { lon, lat } = projectGrid(center, sizeMeters, N);
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (let k = 0; k < N * N; k++) {
    if (lon[k] < west) west = lon[k];
    if (lon[k] > east) east = lon[k];
    if (lat[k] < south) south = lat[k];
    if (lat[k] > north) north = lat[k];
  }
  const pad = NATIVE_DEG * 2;
  west -= pad; south -= pad; east += pad; north += pad;

  const sw = (v: number) => Math.floor(v / TILE_DEG) * TILE_DEG;
  const tiles: Array<[number, number]> = [];
  for (let la = sw(south); la <= sw(north); la += TILE_DEG) {
    for (let lo = sw(west); lo <= sw(east); lo += TILE_DEG) tiles.push([la, lo]);
  }
  if (tiles.length > MAX_TILES) throw new Error(`Land cover spans ${tiles.length} tiles (cap ${MAX_TILES}).`);

  const patches: Patch[] = [];
  await Promise.all(tiles.map(async ([la, lo]) => {
    const bbox: [number, number, number, number] = [
      Math.max(west, lo), Math.max(south, la),
      Math.min(east, lo + TILE_DEG), Math.min(north, la + TILE_DEG),
    ];
    if (bbox[2] <= bbox[0] || bbox[3] <= bbox[1]) return;
    const w = Math.min(2048, Math.max(8, Math.ceil((bbox[2] - bbox[0]) / NATIVE_DEG) + 2));
    const h = Math.min(2048, Math.max(8, Math.ceil((bbox[3] - bbox[1]) / NATIVE_DEG) + 2));
    try {
      const tiff = await fromUrl(tileUrl(la, lo));
      const raster = await tiff.readRasters({ bbox, width: w, height: h, resampleMethod: 'nearest', interleave: false });
      patches.push({ minLon: bbox[0], maxLon: bbox[2], minLat: bbox[1], maxLat: bbox[3], w, h, data: raster[0] as ArrayLike<number> });
    } catch {
      /* missing tile — skip */
    }
  }));
  if (!patches.length) throw new Error('No land-cover tiles could be read.');

  const out = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) {
    let v: number | null = null;
    for (const p of patches) { v = samplePatch(p, lon[k], lat[k]); if (v !== null) break; }
    out[k] = v === null ? 30 : v; // default to grassland if a gap
  }
  return out;
}
