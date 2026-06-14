import type { Heightmap, LatLon } from './heightmap';
import { computeMinMax } from './heightmap';
import { chooseZoom, lonLatToPixel, projectGrid } from './projection';
import { ENDPOINTS } from './endpoints';

const TILE = 256;
const MAX_TILES = 100; // safety cap on number of tiles to stitch

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // needed so the decode canvas isn't tainted in prod
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // missing tile -> treated as sea level
    img.src = url;
  });
}

// Terrarium PNG decoding: height = (R*256 + G + B/256) - 32768 (metres).
function decode(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/**
 * Fetch real elevation for an `N×N` metric grid around `center` from the AWS
 * Terrain Tiles open dataset (terrarium encoding), via the `/api/tiles` proxy.
 */
export async function fetchElevation(
  center: LatLon,
  sizeMeters: number,
  N: number,
): Promise<Heightmap> {
  const { lon, lat } = projectGrid(center, sizeMeters, N);
  const z = chooseZoom(center, sizeMeters, N);

  // Per-node global pixel coords + covering tile range.
  const gx = new Float64Array(N * N);
  const gy = new Float64Array(N * N);
  let minGx = Infinity;
  let minGy = Infinity;
  let maxGx = -Infinity;
  let maxGy = -Infinity;
  for (let k = 0; k < N * N; k++) {
    const p = lonLatToPixel(lon[k], lat[k], z);
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
  if (tilesX * tilesY > MAX_TILES) {
    throw new Error(`DEM tile count ${tilesX * tilesY} exceeds cap (${MAX_TILES}).`);
  }

  const canvas = document.createElement('canvas');
  canvas.width = tilesX * TILE;
  canvas.height = tilesY * TILE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create 2D canvas context for DEM decoding.');

  // Fill with the color that decodes to 0 m so any missing tile reads as sea level.
  ctx.fillStyle = 'rgb(128,0,0)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const jobs: Promise<void>[] = [];
  let loaded = 0;
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      const url = `${ENDPOINTS.tiles}/terrarium/${z}/${tx}/${ty}.png`;
      jobs.push(
        loadImage(url).then((img) => {
          if (img) {
            ctx.drawImage(img, (tx - txMin) * TILE, (ty - tyMin) * TILE);
            loaded++;
          }
        }),
      );
    }
  }
  await Promise.all(jobs);
  if (loaded === 0) {
    throw new Error('No elevation tiles could be loaded for this area.');
  }

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = img.data;
  const W = canvas.width;
  const H = canvas.height;

  const sampleAt = (x: number, y: number): number => {
    const cx = Math.min(W - 1, Math.max(0, x));
    const cy = Math.min(H - 1, Math.max(0, y));
    const i = (cy * W + cx) * 4;
    return decode(px[i], px[i + 1], px[i + 2]);
  };

  const data = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) {
    const lx = gx[k] - txMin * TILE;
    const ly = gy[k] - tyMin * TILE;
    const x0 = Math.floor(lx);
    const y0 = Math.floor(ly);
    const fx = lx - x0;
    const fy = ly - y0;
    const h00 = sampleAt(x0, y0);
    const h10 = sampleAt(x0 + 1, y0);
    const h01 = sampleAt(x0, y0 + 1);
    const h11 = sampleAt(x0 + 1, y0 + 1);
    const top = h00 + (h10 - h00) * fx;
    const bot = h01 + (h11 - h01) * fx;
    data[k] = top + (bot - top) * fy;
  }

  const { min, max } = computeMinMax(data);
  return { data, N, sizeMeters, center, min, max, synthetic: false };
}
