import type { LatLon } from './heightmap';
import { chooseSatelliteZoom, localMetersToLonLat, lonLatToPixel } from './projection';
import { ENDPOINTS } from './endpoints';
import { cachedImage } from './cache';

const TILE = 256;
const MAX_TILES = 16;

/**
 * Fetch a small Esri World Imagery tile stitch around `center` and return it as a
 * data URL for use as the landing page's full-bleed CSS background. This is the
 * WebGL-free preview the landing shows before the 3D sim is built; it reuses the
 * same projection + tile cache as the in-sim drape (`satelliteTiles.ts`).
 *
 * `cachedImage` serves tiles from a same-origin blob URL, so the canvas stays
 * untainted and `toDataURL` works on production (direct Esri) too.
 */
export async function landingBackdrop(center: LatLon, sizeMeters = 3000): Promise<string | null> {
  const z = chooseSatelliteZoom(center, sizeMeters, MAX_TILES);
  const half = sizeMeters / 2;

  let minGx = Infinity, minGy = Infinity, maxGx = -Infinity, maxGy = -Infinity;
  for (const x of [-half, half]) {
    for (const y of [-half, half]) {
      const [lon, lat] = localMetersToLonLat(center, x, y);
      const { gx, gy } = lonLatToPixel(lon, lat, z);
      minGx = Math.min(minGx, gx); maxGx = Math.max(maxGx, gx);
      minGy = Math.min(minGy, gy); maxGy = Math.max(maxGy, gy);
    }
  }

  const txMin = Math.floor(minGx / TILE), txMax = Math.floor(maxGx / TILE);
  const tyMin = Math.floor(minGy / TILE), tyMax = Math.floor(maxGy / TILE);
  const tilesX = txMax - txMin + 1, tilesY = tyMax - tyMin + 1;
  if (tilesX * tilesY > MAX_TILES) return null;

  const canvas = document.createElement('canvas');
  canvas.width = tilesX * TILE;
  canvas.height = tilesY * TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#16202a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let loaded = 0;
  const jobs: Promise<void>[] = [];
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      const url = `${ENDPOINTS.sat}/${z}/${ty}/${tx}`;
      jobs.push(
        cachedImage(url).then(
          (img) => { ctx.drawImage(img, (tx - txMin) * TILE, (ty - tyMin) * TILE); loaded++; },
          () => {},
        ),
      );
    }
  }
  await Promise.all(jobs);
  if (loaded === 0) return null;

  return canvas.toDataURL('image/jpeg', 0.86);
}
