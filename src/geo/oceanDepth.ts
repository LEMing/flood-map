import { ENDPOINTS } from './endpoints';
import type { LatLon } from './heightmap';
import { lonLatToPixel, projectGrid } from './projection';
import { cachedBitmap } from './cache';

const TILE = 256;

// The map fetches terrarium at a high zoom (matched to a ~2 km footprint), where
// the open dataset reads a flat 0 m over water. A low zoom still carries the
// blended GEBCO/ETOPO seabed, so a single coarse tile is the reliable signal for
// "is this point at sea" and gives a real water depth there.
const COARSE_ZOOM = 9;

// ImageBitmap (works on a Worker) from the cached tile blob; null on failure.
function loadImage(url: string): Promise<ImageBitmap | null> {
  return cachedBitmap(url).catch(() => null);
}

/**
 * Coarse seabed elevation (metres; negative below sea level) at one point, read
 * from a single low-zoom terrarium tile. Samples the 3×3 neighbourhood around the
 * centre pixel and returns the deepest value so a partially-coastal pixel still
 * registers water. Returns +Infinity on any fetch/decode failure (treat as land).
 */
export async function coarseSeabedElevM(lat: number, lon: number): Promise<number> {
  const n = 2 ** COARSE_ZOOM;
  const x = ((lon + 180) / 360) * n;
  const latR = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  const tx = Math.floor(x);
  const ty = Math.floor(y);

  const img = await loadImage(`${ENDPOINTS.tiles}/terrarium/${COARSE_ZOOM}/${tx}/${ty}.png`);
  if (!img) return Infinity;
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return Infinity;
  ctx.drawImage(img, 0, 0);

  const px = Math.floor((x - tx) * img.width);
  const py = Math.floor((y - ty) * img.height);
  let deepest = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const sx = Math.min(img.width - 1, Math.max(0, px + dx));
      const sy = Math.min(img.height - 1, Math.max(0, py + dy));
      const d = ctx.getImageData(sx, sy, 1, 1).data;
      const h = d[0] * 256 + d[1] + d[2] / 256 - 32768;
      if (h < deepest) deepest = h;
    }
  }
  return deepest;
}

/**
 * Coarse seabed elevation (m) sampled onto the heightmap grid from low-zoom
 * terrarium tiles, which carry the GEBCO/ETOPO seabed the high-zoom DEM lacks.
 * Returns one value per node (bilinear), or null if no tile loads. Used to carve
 * real bathymetry into the bare-earth DEM, which reads nodata garbage over water.
 */
export async function coarseBathymetryGrid(
  center: LatLon,
  sizeMeters: number,
  N: number,
): Promise<Float32Array | null> {
  const { lon, lat } = projectGrid(center, sizeMeters, N);
  const gx = new Float64Array(N * N);
  const gy = new Float64Array(N * N);
  let minGx = Infinity;
  let minGy = Infinity;
  let maxGx = -Infinity;
  let maxGy = -Infinity;
  for (let k = 0; k < N * N; k++) {
    const p = lonLatToPixel(lon[k], lat[k], COARSE_ZOOM);
    gx[k] = p.gx;
    gy[k] = p.gy;
    if (p.gx < minGx) minGx = p.gx;
    if (p.gy < minGy) minGy = p.gy;
    if (p.gx > maxGx) maxGx = p.gx;
    if (p.gy > maxGy) maxGy = p.gy;
  }

  const txMin = Math.floor(minGx / TILE);
  const txMax = Math.floor(maxGx / TILE);
  const tyMin = Math.floor(minGy / TILE);
  const tyMax = Math.floor(maxGy / TILE);
  const tilesX = txMax - txMin + 1;
  const tilesY = tyMax - tyMin + 1;
  if (tilesX * tilesY > 16) return null; // a 2 km footprint spans 1–4 coarse tiles

  const canvas = new OffscreenCanvas(tilesX * TILE, tilesY * TILE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = 'rgb(128,0,0)'; // decodes to 0 m, so a missing tile reads as sea level
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let loaded = 0;
  await Promise.all(
    Array.from({ length: tilesX * tilesY }, (_, idx) => {
      const tx = txMin + (idx % tilesX);
      const ty = tyMin + Math.floor(idx / tilesX);
      return loadImage(`${ENDPOINTS.tiles}/terrarium/${COARSE_ZOOM}/${tx}/${ty}.png`).then((img) => {
        if (img) {
          ctx.drawImage(img, (tx - txMin) * TILE, (ty - tyMin) * TILE);
          loaded++;
        }
      });
    }),
  );
  if (loaded === 0) return null;

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const W = canvas.width;
  const sample = (x: number, y: number): number => {
    const cx = Math.min(W - 1, Math.max(0, x));
    const cy = Math.min(canvas.height - 1, Math.max(0, y));
    const i = (cy * W + cx) * 4;
    return data[i] * 256 + data[i + 1] + data[i + 2] / 256 - 32768;
  };

  const out = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) {
    const lx = gx[k] - txMin * TILE;
    const ly = gy[k] - tyMin * TILE;
    const x0 = Math.floor(lx);
    const y0 = Math.floor(ly);
    const fx = lx - x0;
    const fy = ly - y0;
    const top = sample(x0, y0) + (sample(x0 + 1, y0) - sample(x0, y0)) * fx;
    const bot = sample(x0, y0 + 1) + (sample(x0 + 1, y0 + 1) - sample(x0, y0 + 1)) * fx;
    out[k] = top + (bot - top) * fy;
  }
  return out;
}
