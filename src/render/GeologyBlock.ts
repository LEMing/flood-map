import * as THREE from 'three';
import type { Heightmap } from '../geo/heightmap';
import { AQUICLUDE_KEY, type GeoColumn, type GeoLayer } from '../geo/geology';
import { VERT_COMMON, VERT_BEGIN, ROCK_HELPERS, ROCK_BLOCK } from './GeologyBlock.glsl';

export interface GeologyParams {
  verticalExaggeration: number;
  worldHeight: number; // on-screen depth the block extends (world units) = depthShownM mapped
  depthShownM: number;
  seaLevelM: number;
  land: GeoColumn;
  marine: GeoColumn;
  oceanCell: boolean; // whole map is open ocean → force marine even where the DEM is flat
  oceanWaterDepthM: number;
  waterTableM: number;
  showWaterTable: boolean;
  highlightAquiclude: boolean;
}

const RAMP_H = 512;
// Sample EVERY edge cell up to large grids so the wall top exactly traces the
// terrain edge — a subsampled chord leaves thin gaps that show bright sky.
const MAX_PERIMETER = 4096;
const NOMINAL_WATER_M = 10; // assumed depth for landcover water lacking real bathymetry
const WATER_CLASS = 80; // ESA WorldCover permanent-water class

interface RingPoint { x: number; z: number; e: number; water: boolean }
interface ColumnGeom { top: number; topStrata: number; marine: number; seabed: number; wt: number }

function perimeterRing(hm: Heightmap, waterMask: Uint8Array | null): RingPoint[] {
  const { N, data, sizeMeters: size } = hm;
  const step = Math.max(1, Math.floor((4 * (N - 1)) / MAX_PERIMETER));
  const at = (ix: number, iy: number): RingPoint => ({
    x: (ix / (N - 1) - 0.5) * size,
    z: (0.5 - iy / (N - 1)) * size,
    e: data[iy * N + ix],
    water: waterMask ? waterMask[iy * N + ix] === WATER_CLASS : false,
  });
  const ring: RingPoint[] = [];
  for (let ix = 0; ix < N - 1; ix += step) ring.push(at(ix, 0));
  for (let iy = 0; iy < N - 1; iy += step) ring.push(at(N - 1, iy));
  for (let ix = N - 1; ix > 0; ix -= step) ring.push(at(ix, N - 1));
  for (let iy = N - 1; iy > 0; iy -= step) ring.push(at(0, iy));
  return ring;
}

// The strata reference is measured down from this, NOT the raw edge: the raw edge
// carries the OSM building/road burn (buildings +5 m), which would stamp the city
// footprint onto every layer contact. A wide box blur (wrap-around the loop)
// removes the building-scale steps while keeping the broad topographic dip.
const STRATA_SMOOTH_M = 130;

function smoothPerimeter(ring: RingPoint[], hm: Heightmap): Float32Array {
  const n = ring.length;
  let cur = new Float32Array(n);
  for (let i = 0; i < n; i++) cur[i] = ring[i].e;
  if (n < 5) return cur;
  const step = Math.max(1, Math.floor((4 * (hm.N - 1)) / MAX_PERIMETER));
  const spacing = (hm.sizeMeters / (hm.N - 1)) * step;
  const radius = Math.max(1, Math.min(Math.floor((n - 1) / 2), Math.round(STRATA_SMOOTH_M / spacing)));
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = -radius; j <= radius; j++) sum += cur[(((i + j) % n) + n) % n];
      out[i] = sum / (2 * radius + 1);
    }
    cur = out;
  }
  return cur;
}

function rgb(hex: number, i: number, data: Uint8Array): void {
  data[i] = (hex >> 16) & 0xff; data[i + 1] = (hex >> 8) & 0xff; data[i + 2] = hex & 0xff; data[i + 3] = 255;
}
function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff; const ag = (a >> 8) & 0xff; const ab = a & 0xff;
  const br = (b >> 16) & 0xff; const bg = (b >> 8) & 0xff; const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const b2 = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | b2;
}

/**
 * Global subsurface cross-section. The top conforms to the terrain relief (or
 * the sea surface over water); strata drape below the local surface. Each wall
 * column is land or marine by its elevation, so a coastline shows soil/crust on
 * one side and sea-water + marine sediment on the other.
 */
export class GeologyBlock {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly landRamp: THREE.DataTexture;
  private readonly marineRamp: THREE.DataTexture;
  private readonly landData = new Uint8Array(RAMP_H * 4);
  private readonly marineData = new Uint8Array(RAMP_H * 4);
  private readonly geometry: THREE.BufferGeometry;
  private readonly ring: RingPoint[];
  private readonly strataElev: Float32Array; // smoothed edge elevations (no building burn)
  private readonly position: Float32Array;
  private readonly yTop: Float32Array;
  private readonly marineAttr: Float32Array;
  private readonly seabed01: Float32Array;
  private readonly wtNorm: Float32Array;
  private readonly uH = { value: 1 };
  private readonly uShowWaterTable = { value: 0 };
  private readonly uOceanic = { value: 0 };

  constructor(hm: Heightmap, waterMask: Uint8Array | null = null) {
    this.ring = perimeterRing(hm, waterMask);
    this.strataElev = smoothPerimeter(this.ring, hm);
    const vertCount = this.ring.length * 6 + 6;
    this.position = new Float32Array(vertCount * 3);
    this.yTop = new Float32Array(vertCount);
    this.marineAttr = new Float32Array(vertCount);
    this.seabed01 = new Float32Array(vertCount);
    this.wtNorm = new Float32Array(vertCount);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    this.geometry.setAttribute('aYTop', new THREE.BufferAttribute(this.yTop, 1));
    this.geometry.setAttribute('aMarine', new THREE.BufferAttribute(this.marineAttr, 1));
    this.geometry.setAttribute('aSeabed01', new THREE.BufferAttribute(this.seabed01, 1));
    this.geometry.setAttribute('aWtNorm', new THREE.BufferAttribute(this.wtNorm, 1));

    this.landRamp = this.makeRamp(this.landData);
    this.marineRamp = this.makeRamp(this.marineData);

    // Unlit so the strata read as a clean diagram, immune to storm lighting, fog
    // and exposure (a lit bright sediment was clipping into ACES desaturation).
    // polygonOffset biases it ahead of the sea (which has its own offset to beat
    // the seabed), so the cross-section is never washed out by the water plane.
    this.material = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.material.fog = false;
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uLandRamp = { value: this.landRamp };
      shader.uniforms.uMarineRamp = { value: this.marineRamp };
      shader.uniforms.uH = this.uH;
      shader.uniforms.uShowWaterTable = this.uShowWaterTable;
      shader.uniforms.uOceanic = this.uOceanic;
      shader.uniforms.uSeaShallow = { value: new THREE.Color(0.16, 0.42, 0.55) };
      shader.uniforms.uSeaDeep = { value: new THREE.Color(0.04, 0.13, 0.24) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>${VERT_COMMON}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>${VERT_BEGIN}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>${ROCK_HELPERS}`)
        .replace('#include <color_fragment>', `#include <color_fragment>${ROCK_BLOCK}`);
    };

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  private makeRamp(data: Uint8Array): THREE.DataTexture {
    const t = new THREE.DataTexture(data, 1, RAMP_H, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace; // the hex layer colours are sRGB, not linear
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
    return t;
  }

  private rebuildRamp(col: GeoColumn, data: Uint8Array, p: GeologyParams, isLand: boolean): void {
    const layers = col.layers;
    const last = layers[layers.length - 1];
    const lineHalf = p.depthShownM * 0.004;
    for (let i = 0; i < RAMP_H; i++) {
      const depthM = (i / (RAMP_H - 1)) * p.depthShownM;
      let layer: GeoLayer = last;
      for (const l of layers) { if (depthM >= l.topM && depthM < l.botM) { layer = l; break; } }
      let hex = layer.hex;
      if (p.highlightAquiclude && layer.key === AQUICLUDE_KEY) hex = mix(hex, 0xff7a3c, 0.28);
      for (const l of layers) {
        if (l.topM > 0 && Math.abs(depthM - l.topM) < lineHalf) {
          hex = mix(hex, 0x0a0a0a, 0.55);
          break;
        }
      }
      rgb(hex, i * 4, data);
    }
    void isLand;
  }

  private rebuildGeometry(p: GeologyParams): void {
    const ve = p.verticalExaggeration;
    const H = p.worldHeight;
    const sea = p.seaLevelM;
    const ring = this.ring;
    const n = ring.length;
    const topElev = (e: number): number => Math.max(e, sea);
    const minTop = ring.reduce((m, pt) => Math.min(m, topElev(pt.e)), Infinity);
    const yFloor = minTop * ve - H;
    const pos = this.position;
    const yt = this.yTop;
    const mar = this.marineAttr;
    const sb = this.seabed01;
    const wn = this.wtNorm;
    let o = 0;
    const put = (x: number, y: number, z: number, top: number, marine: number, seabed: number, wt: number): void => {
      pos[o * 3] = x; pos[o * 3 + 1] = y; pos[o * 3 + 2] = z;
      yt[o] = top; mar[o] = marine; sb[o] = seabed; wn[o] = wt; o++;
    };
    const col = (pt: RingPoint, eStrata: number): ColumnGeom => {
      // Water = land-cover water (canals, harbour, sea) or genuinely deep seabed or
      // an all-ocean map. NOT merely "below sea level": vast dry land sits below sea
      // (Dutch polders, -2..-7 m) and must read as land, not a cyan water band.
      const marine = (pt.water && pt.e < sea + 2) || pt.e < sea - 8 || p.oceanCell ? 1 : 0;
      // A water column's surface is the waterline (sea level), never the bed/bank
      // elevation, so the cyan band has a flat top instead of jagged teeth.
      const top = (marine ? sea : topElev(pt.e)) * ve;
      // Strata depth is measured from the SMOOTHED surface, so the building burn
      // doesn't step the layer contacts; the wall-top GEOMETRY still uses the raw
      // edge (top) so it seals against the terrain with no sky gap.
      const topStrata = (marine ? sea : topElev(eStrata)) * ve;
      const waterDepth = marine
        ? Math.max(sea - pt.e, pt.water ? NOMINAL_WATER_M : 0, p.oceanCell ? p.oceanWaterDepthM : 0)
        : 0;
      const seabed = Math.min(1, Math.max(0, waterDepth / p.depthShownM));
      // water-table depth below this column's surface: 0 at the coast (= sea level),
      // up to waterTableM inland. Kept continuous (no -1 jump) so it doesn't smear
      // across land/marine quad edges; the draw is gated to land fragments.
      const wt = Math.min(Math.max(pt.e - sea, 0), p.waterTableM) / p.depthShownM;
      return { top, topStrata, marine, seabed, wt };
    };
    for (let i = 0; i < n; i++) {
      const a = ring[i]; const b = ring[(i + 1) % n];
      const ca = col(a, this.strataElev[i]); const cb = col(b, this.strataElev[(i + 1) % n]);
      put(a.x, ca.top, a.z, ca.topStrata, ca.marine, ca.seabed, ca.wt);
      put(a.x, yFloor, a.z, ca.topStrata, ca.marine, ca.seabed, ca.wt);
      put(b.x, cb.top, b.z, cb.topStrata, cb.marine, cb.seabed, cb.wt);
      put(b.x, cb.top, b.z, cb.topStrata, cb.marine, cb.seabed, cb.wt);
      put(a.x, yFloor, a.z, ca.topStrata, ca.marine, ca.seabed, ca.wt);
      put(b.x, yFloor, b.z, cb.topStrata, cb.marine, cb.seabed, cb.wt);
    }
    const s = Math.max(...ring.map((pt) => Math.abs(pt.x)), ...ring.map((pt) => Math.abs(pt.z)));
    const deep = yFloor + H * 2;
    put(-s, yFloor, -s, deep, 0, 0, 1); put(s, yFloor, -s, deep, 0, 0, 1); put(s, yFloor, s, deep, 0, 0, 1);
    put(-s, yFloor, -s, deep, 0, 0, 1); put(s, yFloor, s, deep, 0, 0, 1); put(-s, yFloor, s, deep, 0, 0, 1);

    for (const name of ['position', 'aYTop', 'aMarine', 'aSeabed01', 'aWtNorm']) {
      (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    }
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }

  update(p: GeologyParams): void {
    this.uH.value = p.worldHeight;
    this.uShowWaterTable.value = p.showWaterTable ? 1 : 0;
    this.uOceanic.value = p.oceanCell ? 1 : 0;
    this.rebuildRamp(p.land, this.landData, p, true);
    this.rebuildRamp(p.marine, this.marineData, p, false);
    this.landRamp.needsUpdate = true;
    this.marineRamp.needsUpdate = true;
    this.rebuildGeometry(p);
  }

  setVisible(v: boolean): void { this.mesh.visible = v; }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.landRamp.dispose();
    this.marineRamp.dispose();
  }
}
