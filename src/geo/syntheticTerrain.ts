import type { Heightmap, LatLon } from './heightmap';
import { computeMinMax } from './heightmap';

// Deterministic value-noise terrain used as an offline-safe fallback when the
// real DEM cannot be fetched. Produces a bowl-shaped valley with ridges so the
// flood simulation has somewhere for water to collect and drain.

function hash2(ix: number, iy: number, seed: number): number {
  let h = ix * 374761393 + iy * 668265263 + seed * 2246822519;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return (h & 0xffff) / 0xffff;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

function fbm(x: number, y: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < 5; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 17);
    freq *= 2;
    amp *= 0.5;
  }
  return sum;
}

export function syntheticHeightmap(
  center: LatLon,
  sizeMeters: number,
  N: number,
): Heightmap {
  const data = new Float32Array(N * N);
  const seed = Math.floor(Math.abs(center.lat * 1000 + center.lon * 1000)) % 100000;
  const reliefMeters = 220;

  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      const u = ix / (N - 1);
      const v = iy / (N - 1);
      const noise = fbm(u * 6, v * 6, seed);
      // Bowl: lowest in the centre so water has a basin to fill.
      const dx = u - 0.5;
      const dy = v - 0.5;
      const bowl = (dx * dx + dy * dy) * 2.2;
      data[iy * N + ix] = 900 + reliefMeters * (noise * 0.8 + bowl);
    }
  }

  const { min, max } = computeMinMax(data);
  return { data, N, sizeMeters, center, min, max, synthetic: true };
}
