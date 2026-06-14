import { fromArrayBuffer, fromUrl, type GeoTIFF } from 'geotiff';
import type { ElevationSource } from '../config';
import type { Heightmap, LatLon } from './heightmap';
import { computeMinMax } from './heightmap';
import { projectGrid } from './projection';
import { ENDPOINTS } from './endpoints';

// Reads Copernicus GLO-30 or FABDEM Cloud-Optimized GeoTIFFs (1°×1° tiles, both
// EPSG:4326, ~30 m). geotiff.js issues HTTP range requests, so only the small
// window covering the area is downloaded.

const NATIVE_DEG = 1 / 3600; // ~1 arc-second
const MAX_TILES = 9; // a ≤20 km area can straddle a 1° boundary on both axes
const NODATA_FLOOR = -1000;

const pad2 = (n: number) => String(Math.abs(n)).padStart(2, '0');
const pad3 = (n: number) => String(Math.abs(n)).padStart(3, '0');

function tileUrl(source: ElevationSource, latI: number, lonI: number): string {
  const latS = (latI >= 0 ? 'N' : 'S') + pad2(latI);
  const lonS = (lonI >= 0 ? 'E' : 'W') + pad3(lonI);

  if (source === 'glo30') {
    const name = `Copernicus_DSM_COG_10_${latS}_00_${lonS}_00_DEM`;
    return `${ENDPOINTS.cop30}/${name}/${name}.tif`;
  }

  // FABDEM: 1° tiles grouped into 10°×10° folders named by their SW–NE corners.
  const lat10 = Math.floor(latI / 10) * 10;
  const lon10 = Math.floor(lonI / 10) * 10;
  const corner = (la: number, lo: number) =>
    `${la >= 0 ? 'N' : 'S'}${pad2(la)}${lo >= 0 ? 'E' : 'W'}${pad3(lo)}`;
  const folder = `${corner(lat10, lon10)}-${corner(lat10 + 10, lon10 + 10)}_FABDEM_V1-2`;
  // Hugging Face CDN serves these with CORS + range support, so we hit it
  // directly (its signed LFS redirect can't be proxied cleanly in dev).
  return `https://huggingface.co/datasets/links-ads/fabdem-v12/resolve/main/tiles/${folder}/${latS}${lonS}_FABDEM_V1-2.tif`;
}

// GLO-30 is a true COG on S3 → cheap range reads. FABDEM lives on Hugging
// Face's Xet backend, which signs each redirect to a fixed byte range and
// breaks geotiff's range requests, so we download the (~13 MB) tile whole.
async function openTiff(source: ElevationSource, url: string): Promise<GeoTIFF> {
  if (source === 'fabdem') {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return fromArrayBuffer(await resp.arrayBuffer());
  }
  return fromUrl(url);
}

interface Patch {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
  w: number;
  h: number;
  data: ArrayLike<number>;
}

function samplePatch(p: Patch, lon: number, lat: number): number | null {
  if (lon < p.minLon || lon > p.maxLon || lat < p.minLat || lat > p.maxLat) return null;
  const fx = ((lon - p.minLon) / (p.maxLon - p.minLon)) * (p.w - 1);
  const fy = ((p.maxLat - lat) / (p.maxLat - p.minLat)) * (p.h - 1); // row 0 = north
  const x0 = Math.min(p.w - 2, Math.max(0, Math.floor(fx)));
  const y0 = Math.min(p.h - 2, Math.max(0, Math.floor(fy)));
  const dx = fx - x0;
  const dy = fy - y0;
  const at = (x: number, y: number) => p.data[y * p.w + x] as number;
  const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * dx;
  const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * dx;
  return top + (bot - top) * dy;
}

export async function fetchElevationCog(
  source: ElevationSource,
  center: LatLon,
  sizeMeters: number,
  N: number,
): Promise<Heightmap> {
  const { lon, lat } = projectGrid(center, sizeMeters, N);
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (let k = 0; k < N * N; k++) {
    if (lon[k] < west) west = lon[k];
    if (lon[k] > east) east = lon[k];
    if (lat[k] < south) south = lat[k];
    if (lat[k] > north) north = lat[k];
  }
  const pad = NATIVE_DEG * 2;
  west -= pad; south -= pad; east += pad; north += pad;

  const tiles: Array<[number, number]> = [];
  for (let latI = Math.floor(south); latI <= Math.floor(north); latI++) {
    for (let lonI = Math.floor(west); lonI <= Math.floor(east); lonI++) {
      tiles.push([latI, lonI]);
    }
  }
  if (tiles.length > MAX_TILES) {
    throw new Error(`DEM spans ${tiles.length} tiles (cap ${MAX_TILES}); reduce map size.`);
  }

  const patches: Patch[] = [];
  await Promise.all(
    tiles.map(async ([latI, lonI]) => {
      const bbox: [number, number, number, number] = [
        Math.max(west, lonI),
        Math.max(south, latI),
        Math.min(east, lonI + 1),
        Math.min(north, latI + 1),
      ];
      const w = Math.min(2048, Math.max(8, Math.ceil((bbox[2] - bbox[0]) / NATIVE_DEG) + 2));
      const h = Math.min(2048, Math.max(8, Math.ceil((bbox[3] - bbox[1]) / NATIVE_DEG) + 2));
      try {
        const tiff = await openTiff(source, tileUrl(source, latI, lonI));
        const raster = await tiff.readRasters({
          bbox,
          width: w,
          height: h,
          resampleMethod: 'bilinear',
          interleave: false,
        });
        patches.push({
          minLon: bbox[0], maxLon: bbox[2], minLat: bbox[1], maxLat: bbox[3],
          w, h, data: raster[0] as ArrayLike<number>,
        });
      } catch {
        // Missing tile (e.g. ocean) — skip; other tiles/fallbacks still apply.
      }
    }),
  );
  if (!patches.length) {
    throw new Error('No elevation tiles could be read for this area.');
  }

  const data = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) {
    let v: number | null = null;
    for (const p of patches) {
      v = samplePatch(p, lon[k], lat[k]);
      if (v !== null) break;
    }
    data[k] = v === null || v < NODATA_FLOOR ? 0 : v;
  }

  const { min, max } = computeMinMax(data);
  return { data, N, sizeMeters, center, min, max, synthetic: false };
}
