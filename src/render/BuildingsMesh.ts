import * as THREE from 'three';
import type { Heightmap } from '../geo/heightmap';
import type { BuildingShape } from '../geo/osm';

// Extrudes OSM building footprints to their real heights as one merged mesh:
// a clean white/grey architectural massing with a base→top ambient-occlusion
// gradient (flat-shaded). Sits on the TRUE ground (the sim's +5 m building burn
// is un-done per cell) and uses a polygon offset to cover those burned cliffs.

const SEAT_M = 1.5; // sink the base so it seats on minor slopes (no floating)
const MIN_HEIGHT_M = 6; // also covers the 5 m sim burn under the footprint
const BASE_SHADE = 0.5; // vertex AO at street level
const TOP_SHADE = 1.0;

export class BuildingsMesh {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;

  constructor(shapes: BuildingShape[], hm: Heightmap, buildingMask: Uint8Array, burnM: number) {
    const pos: number[] = [];
    const col: number[] = [];
    for (const b of shapes) addBuilding(b, hm, buildingMask, burnM, pos, col);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.geometry.computeBoundingSphere();

    this.material = new THREE.MeshStandardMaterial({
      color: 0xe4e8ee,
      roughness: 0.94,
      metalness: 0.0,
      flatShading: true,
      vertexColors: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 0;
  }

  setVisible(v: boolean): void { this.mesh.visible = v; }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

function addBuilding(
  b: BuildingShape, hm: Heightmap, mask: Uint8Array, burnM: number, pos: number[], col: number[],
): void {
  const ring = dedupRing(b.ring);
  if (ring.length < 3) return;
  const { N, data, sizeMeters } = hm;

  const wx: number[] = [];
  const wz: number[] = [];
  let groundE = Infinity;
  for (const [gx, gy] of ring) {
    wx.push((gx / (N - 1) - 0.5) * sizeMeters);
    wz.push((0.5 - gy / (N - 1)) * sizeMeters);
    const ix = clampIdx(Math.round(gx), N);
    const iy = clampIdx(Math.round(gy), N);
    const k = iy * N + ix;
    groundE = Math.min(groundE, data[k] - (mask[k] ? burnM : 0)); // un-burn → true ground
  }
  const baseY = groundE - SEAT_M;
  const roofY = groundE + Math.max(MIN_HEIGHT_M, b.height);

  // Roof: triangulate the footprint (no holes) and emit at roof height.
  const contour = wx.map((x, i) => new THREE.Vector2(x, wz[i]));
  for (const [a, b2, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
    pushV(pos, col, wx[a], roofY, wz[a], TOP_SHADE);
    pushV(pos, col, wx[b2], roofY, wz[b2], TOP_SHADE);
    pushV(pos, col, wx[c], roofY, wz[c], TOP_SHADE);
  }

  // Walls: each edge → a base→roof quad (two triangles), AO-graded.
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushV(pos, col, wx[i], baseY, wz[i], BASE_SHADE);
    pushV(pos, col, wx[j], baseY, wz[j], BASE_SHADE);
    pushV(pos, col, wx[j], roofY, wz[j], TOP_SHADE);
    pushV(pos, col, wx[i], baseY, wz[i], BASE_SHADE);
    pushV(pos, col, wx[j], roofY, wz[j], TOP_SHADE);
    pushV(pos, col, wx[i], roofY, wz[i], TOP_SHADE);
  }
}

function pushV(pos: number[], col: number[], x: number, y: number, z: number, shade: number): void {
  pos.push(x, y, z);
  col.push(shade, shade, shade);
}

function dedupRing(ring: number[][]): number[][] {
  const n = ring.length;
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) {
    return ring.slice(0, n - 1);
  }
  return ring;
}

function clampIdx(v: number, N: number): number {
  return v < 0 ? 0 : v > N - 1 ? N - 1 : v;
}
