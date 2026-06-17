import type { Heightmap } from '../geo/heightmap';

/** Bilinearly sample terrain elevation (metres) at normalized (u, v) in [0, 1]. */
export function sampleElevation(hm: Heightmap, u: number, v: number): number {
  const N = hm.N;
  const fx = u * (N - 1);
  const fy = v * (N - 1);
  const x0 = Math.min(N - 2, Math.floor(fx));
  const y0 = Math.min(N - 2, Math.floor(fy));
  const dx = fx - x0;
  const dy = fy - y0;
  const d = hm.data;
  const at = (x: number, y: number): number => d[y * N + x];
  const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * dx;
  const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * dx;
  return top + (bot - top) * dy;
}

/** Nearest-cell water depth (metres) from a sim readback buffer at normalized (u, v). */
export function sampleDepth(readback: Float32Array, N: number, u: number, v: number): number {
  const ix = Math.round(u * (N - 1));
  const iy = Math.round(v * (N - 1));
  return readback[(iy * N + ix) * 4];
}
