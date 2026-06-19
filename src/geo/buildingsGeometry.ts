import earcut from 'three/src/extras/lib/earcut.js';
import type { Heightmap } from './heightmap';
import type { BuildingShape } from './osm';

// Extrudes OSM building footprints into a single merged triangle soup — the heavy
// per-load CPU step (triangulating every footprint), kept off the main thread by
// running inside the geo worker. The result is three flat Float32Arrays the
// render-side BuildingsMesh uploads directly; the raw rings never reach the main
// thread. Positions sit on the TRUE ground (the sim's building burn is un-done
// per cell via `mask`/`burnM`); `ground` carries each vertex's ground elevation
// so the render shader can keep heights un-exaggerated under the terrain group's
// vertical-exaggeration scale.

const SEAT_M = 1.5; // sink the base so it seats on minor slopes (no floating)
// The sim raises building cells this high (a no-flow obstacle floods never overtop);
// surface.ts burns it into the DEM and buildingsGeometry un-does it per cell.
export const BUILDING_RAISE_M = 5;
const MIN_HEIGHT_M = BUILDING_RAISE_M + 1; // keep the roof above the burned footprint
const BASE_SHADE = 0.5; // vertex AO at street level
const TOP_SHADE = 1.0;

export interface BuildingGeometryData {
  position: Float32Array; // xyz triples
  color: Float32Array; // rgb triples (AO gradient)
  ground: Float32Array; // per-vertex true ground elevation (metres)
}

interface BuildVerts {
  pos: number[];
  col: number[];
  ground: number[];
}

export function extrudeBuildings(
  shapes: BuildingShape[], hm: Heightmap, mask: Uint8Array, burnM: number,
): BuildingGeometryData {
  const v: BuildVerts = { pos: [], col: [], ground: [] };
  for (const b of shapes) addBuilding(b, hm, mask, burnM, v);
  return {
    position: new Float32Array(v.pos),
    color: new Float32Array(v.col),
    ground: new Float32Array(v.ground),
  };
}

function addBuilding(b: BuildingShape, hm: Heightmap, mask: Uint8Array, burnM: number, v: BuildVerts): void {
  const ring = dedupRing(b.ring);
  if (ring.length < 3) return;
  const { N, data, sizeMeters } = hm;

  const wx: number[] = [];
  const wz: number[] = [];
  const flat: number[] = [];
  let groundE = Infinity;
  for (const [gx, gy] of ring) {
    const x = (gx / (N - 1) - 0.5) * sizeMeters;
    const z = (0.5 - gy / (N - 1)) * sizeMeters;
    wx.push(x);
    wz.push(z);
    flat.push(x, z);
    const ix = clampIdx(Math.round(gx), N);
    const iy = clampIdx(Math.round(gy), N);
    const k = iy * N + ix;
    groundE = Math.min(groundE, data[k] - (mask[k] ? burnM : 0)); // un-burn → true ground
  }
  const baseY = groundE - SEAT_M;
  const roofY = groundE + Math.max(MIN_HEIGHT_M, b.height);

  // Roof: triangulate the footprint (no holes) and emit at roof height.
  const tri = earcut(flat, null, 2);
  for (let i = 0; i < tri.length; i += 3) {
    const a = tri[i], c = tri[i + 1], d = tri[i + 2];
    pushV(v, wx[a], roofY, wz[a], TOP_SHADE, groundE);
    pushV(v, wx[c], roofY, wz[c], TOP_SHADE, groundE);
    pushV(v, wx[d], roofY, wz[d], TOP_SHADE, groundE);
  }

  // Walls: each edge → a base→roof quad (two triangles), AO-graded.
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushV(v, wx[i], baseY, wz[i], BASE_SHADE, groundE);
    pushV(v, wx[j], baseY, wz[j], BASE_SHADE, groundE);
    pushV(v, wx[j], roofY, wz[j], TOP_SHADE, groundE);
    pushV(v, wx[i], baseY, wz[i], BASE_SHADE, groundE);
    pushV(v, wx[j], roofY, wz[j], TOP_SHADE, groundE);
    pushV(v, wx[i], roofY, wz[i], TOP_SHADE, groundE);
  }
}

function pushV(v: BuildVerts, x: number, y: number, z: number, shade: number, ground: number): void {
  v.pos.push(x, y, z);
  v.col.push(shade, shade, shade);
  v.ground.push(ground);
}

function dedupRing(ring: number[][]): number[][] {
  const n = ring.length;
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) {
    return ring.slice(0, n - 1);
  }
  return ring;
}

function clampIdx(value: number, N: number): number {
  return value < 0 ? 0 : value > N - 1 ? N - 1 : value;
}
