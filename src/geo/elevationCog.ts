import { fromArrayBuffer, fromUrl, type GeoTIFF } from 'geotiff';
import type { ElevationSource } from '../config';
import type { Heightmap, LatLon } from './heightmap';
import { computeMinMax } from './heightmap';
import { projectGrid } from './projection';
import { ENDPOINTS } from './endpoints';
import { peekArrayBuffer, putArrayBuffer } from './cache';

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
    const cached = await peekArrayBuffer(url);
    if (cached) return fromArrayBuffer(cached);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = await resp.arrayBuffer();
    // The HF/Xet signed-redirect backend occasionally serves a tiny error body
    // or a truncated file; a real land tile is several MB. Only cache a body
    // that passes this size check so a bad read is never persisted.
    if (buf.byteLength < 30_000) throw new Error(`FABDEM body too small (${buf.byteLength} B)`);
    putArrayBuffer(url, buf);
    return fromArrayBuffer(buf);
  }
  return fromUrl(url);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A transient bad read tends to come back near-zero/flat. If a tile reads as
// >92% near sea level we treat it as suspect and retry (genuine water tiles
// will simply read the same way again and be accepted on the last attempt).
function looksDegenerate(raster: ArrayLike<number>): boolean {
  const n = raster.length;
  if (!n) return true;
  const step = Math.max(1, Math.floor(n / 2000));
  let near0 = 0;
  let count = 0;
  for (let i = 0; i < n; i += step) {
    if (Math.abs(raster[i] as number) < 0.5) near0++;
    count++;
  }
  return near0 / count > 0.92;
}

// Fill holes (failed/uncovered tiles) by iteratively averaging valid neighbours,
// so a missing tile blends with the surrounding terrain instead of dropping to a
// sea-level cliff.
function inpaintHoles(data: Float32Array, valid: Uint8Array, N: number): void {
  const cur = Uint8Array.from(valid);
  let remaining = 0;
  for (let i = 0; i < N * N; i++) if (!cur[i]) remaining++;
  let pass = 0;
  while (remaining > 0 && pass++ < N) {
    const filled: number[] = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const k = r * N + c;
        if (cur[k]) continue;
        let s = 0;
        let nb = 0;
        if (r > 0 && cur[k - N]) { s += data[k - N]; nb++; }
        if (r < N - 1 && cur[k + N]) { s += data[k + N]; nb++; }
        if (c > 0 && cur[k - 1]) { s += data[k - 1]; nb++; }
        if (c < N - 1 && cur[k + 1]) { s += data[k + 1]; nb++; }
        if (nb > 0) { data[k] = s / nb; filled.push(k); }
      }
    }
    for (const k of filled) cur[k] = 1;
    remaining -= filled.length;
    if (!filled.length) break;
  }
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
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const tiff = await openTiff(source, tileUrl(source, latI, lonI));
          const raster = await tiff.readRasters({
            bbox, width: w, height: h, resampleMethod: 'bilinear', interleave: false,
          });
          const band = raster[0] as ArrayLike<number>;
          // Retry once on a suspiciously near-zero read (flaky backend); a genuine
          // water tile will read the same way and be accepted on the next attempt.
          if (attempt === 0 && looksDegenerate(band)) {
            await sleep(300);
            continue;
          }
          patches.push({ minLon: bbox[0], maxLon: bbox[2], minLat: bbox[1], maxLat: bbox[3], w, h, data: band });
          return;
        } catch {
          if (attempt < 2) await sleep(300 * (attempt + 1));
          // else: give up on this tile — inpainting fills the gap from neighbours.
        }
      }
    }),
  );
  if (!patches.length) {
    throw new Error('No elevation tiles could be read for this area.');
  }

  const data = new Float32Array(N * N);
  const valid = new Uint8Array(N * N);
  let validCount = 0;
  for (let k = 0; k < N * N; k++) {
    let v: number | null = null;
    for (const p of patches) {
      v = samplePatch(p, lon[k], lat[k]);
      if (v !== null) break;
    }
    if (v === null || v < NODATA_FLOOR) {
      data[k] = 0;
    } else {
      data[k] = v;
      valid[k] = 1;
      validCount++;
    }
  }
  if (validCount === 0) throw new Error('Elevation read returned no valid data for this area.');
  if (validCount < N * N) inpaintHoles(data, valid, N); // blend missing tiles, no sea-level cliff

  const { min, max } = computeMinMax(data);
  return { data, N, sizeMeters, center, min, max, synthetic: false };
}
