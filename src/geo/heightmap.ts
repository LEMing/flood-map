export interface LatLon {
  lat: number;
  lon: number;
}

/**
 * A square, north-up grid of terrain elevations in metres, sampled on a
 * metric (equidistant) projection centred on `center`.
 *
 * `data` is row-major, `N * N` floats. Index `(col=ix, row=iy)` is
 * `data[iy * N + ix]`. Row 0 is the SOUTH edge, row N-1 the NORTH edge;
 * column 0 is WEST, column N-1 is EAST. This matches the texture convention
 * used by the simulation (uv.y increases northward) and the terrain mesh.
 */
export interface Heightmap {
  data: Float32Array;
  N: number;
  sizeMeters: number;
  center: LatLon;
  min: number;
  max: number;
  /** true when this came from the synthetic fallback rather than real DEM data */
  synthetic: boolean;
}

export function computeMinMax(data: Float32Array): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!isFinite(min)) min = 0;
  if (!isFinite(max)) max = 0;
  return { min, max };
}
