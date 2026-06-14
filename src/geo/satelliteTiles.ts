import * as THREE from 'three';
import type { LatLon } from './heightmap';
import { chooseSatelliteZoom, lonLatToPixel, projectGrid } from './projection';

const TILE = 256;
const MAX_TILES = 100;

export interface SatelliteDrape {
  texture: THREE.Texture;
  /** Per grid node (iy*N+ix) uv into the stitched imagery, length N*N*2. */
  uvSat: Float32Array;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Fetch Esri World Imagery covering the `N×N` grid around `center` and return a
 * texture plus per-node UVs that drape it exactly over the terrain grid. Esri
 * tiles use a {z}/{y}/{x} path, served through the `/api/sat` proxy.
 */
export async function fetchSatellite(
  center: LatLon,
  sizeMeters: number,
  N: number,
): Promise<SatelliteDrape> {
  const { lon, lat } = projectGrid(center, sizeMeters, N);
  const z = chooseSatelliteZoom(center, sizeMeters, MAX_TILES);

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
    throw new Error(`Imagery tile count ${tilesX * tilesY} exceeds cap (${MAX_TILES}).`);
  }

  const canvas = document.createElement('canvas');
  canvas.width = tilesX * TILE;
  canvas.height = tilesY * TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create 2D canvas context for imagery.');
  ctx.fillStyle = '#2b3a2b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let loaded = 0;
  const jobs: Promise<void>[] = [];
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      const url = `/api/sat/${z}/${ty}/${tx}`;
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
    throw new Error('No satellite imagery tiles could be loaded for this area.');
  }

  const uvSat = new Float32Array(N * N * 2);
  for (let k = 0; k < N * N; k++) {
    uvSat[k * 2] = (gx[k] - txMin * TILE) / canvas.width;
    uvSat[k * 2 + 1] = (gy[k] - tyMin * TILE) / canvas.height;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  return { texture, uvSat };
}
