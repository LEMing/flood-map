import * as THREE from 'three';
import type { Heightmap } from '../geo/heightmap';
import { AQUICLUDE_KEY, type GeoColumn, type GeoLayer } from '../geo/geology';

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

function rgb(hex: number, i: number, data: Uint8Array): void {
  data[i] = (hex >> 16) & 0xff; data[i + 1] = (hex >> 8) & 0xff; data[i + 2] = hex & 0xff; data[i + 3] = 255;
}
function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff; const ag = (a >> 8) & 0xff; const ab = a & 0xff;
  const br = (b >> 16) & 0xff; const bg = (b >> 8) & 0xff; const bb = b & 0xff;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
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
  private readonly position: Float32Array;
  private readonly yTop: Float32Array;
  private readonly marineAttr: Float32Array;
  private readonly seabed01: Float32Array;
  private readonly uH = { value: 1 };

  constructor(hm: Heightmap, waterMask: Uint8Array | null = null) {
    this.ring = perimeterRing(hm, waterMask);
    const vertCount = this.ring.length * 6 + 6;
    this.position = new Float32Array(vertCount * 3);
    this.yTop = new Float32Array(vertCount);
    this.marineAttr = new Float32Array(vertCount);
    this.seabed01 = new Float32Array(vertCount);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    this.geometry.setAttribute('aYTop', new THREE.BufferAttribute(this.yTop, 1));
    this.geometry.setAttribute('aMarine', new THREE.BufferAttribute(this.marineAttr, 1));
    this.geometry.setAttribute('aSeabed01', new THREE.BufferAttribute(this.seabed01, 1));

    this.landRamp = this.makeRamp(this.landData);
    this.marineRamp = this.makeRamp(this.marineData);

    // Unlit so the strata read as a clean diagram, immune to storm lighting, fog
    // and exposure (a lit bright sediment was clipping into ACES desaturation).
    this.material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    this.material.fog = false;
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uLandRamp = { value: this.landRamp };
      shader.uniforms.uMarineRamp = { value: this.marineRamp };
      shader.uniforms.uH = this.uH;
      shader.uniforms.uSeaShallow = { value: new THREE.Color(0.16, 0.42, 0.55) };
      shader.uniforms.uSeaDeep = { value: new THREE.Color(0.04, 0.13, 0.24) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aYTop; attribute float aMarine; attribute float aSeabed01;
          varying float vDepth01; varying float vMarine; varying float vSeabed01; varying vec3 vWorld; uniform float uH;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vDepth01 = (aYTop - position.y) / max(uH, 1.0);
          vMarine = aMarine; vSeabed01 = aSeabed01; vWorld = position;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vDepth01; varying float vMarine; varying float vSeabed01; varying vec3 vWorld;
          uniform sampler2D uLandRamp; uniform sampler2D uMarineRamp; uniform vec3 uSeaShallow, uSeaDeep;
          float gHash(vec3 p){ return fract(sin(dot(floor(p), vec3(127.1, 311.7, 74.7))) * 43758.5453); }
          float gNoise(vec3 p){
            vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(gHash(i), gHash(i + vec3(1,0,0)), f.x), mix(gHash(i + vec3(0,1,0)), gHash(i + vec3(1,1,0)), f.x), f.y),
                       mix(mix(gHash(i + vec3(0,0,1)), gHash(i + vec3(1,0,1)), f.x), mix(gHash(i + vec3(0,1,1)), gHash(i + vec3(1,1,1)), f.x), f.y), f.z);
          }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float d = clamp(vDepth01, 0.0, 1.0);
          vec3 landC = texture2D(uLandRamp, vec2(0.5, d)).rgb;
          vec3 marineC; float water = 0.0;
          if (d < vSeabed01) {
            float wt = vSeabed01 > 1e-4 ? d / vSeabed01 : 0.0;
            marineC = mix(uSeaShallow, uSeaDeep, wt); water = 1.0;
          } else {
            float bd = (d - vSeabed01) / max(1e-3, 1.0 - vSeabed01);
            marineC = texture2D(uMarineRamp, vec2(0.5, clamp(bd, 0.0, 1.0))).rgb;
          }
          diffuseColor.rgb = mix(landC, marineC, vMarine);
          // rock grain + faint horizontal laminae so sediment reads as sediment, not a flat slab
          float solid = (vMarine > 0.5 && water > 0.5) ? 0.0 : 1.0;
          float grain = gNoise(vWorld * 0.03 + gNoise(vWorld * 0.008));
          float lam = gNoise(vec3(vWorld.x * 0.006, vWorld.y * 0.13, vWorld.z * 0.006));
          diffuseColor.rgb *= mix(1.0, (0.84 + 0.30 * grain) * (0.94 + 0.12 * lam), solid);
          // manual directional shade (unlit material) so the block still reads as 3D
          vec3 gn = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
          float lambert = clamp(dot(gn, normalize(vec3(0.45, 0.5, 0.72))), 0.0, 1.0);
          diffuseColor.rgb *= (0.62 + 0.48 * lambert);`);
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
    const wtBand = p.depthShownM * 0.006;
    for (let i = 0; i < RAMP_H; i++) {
      const depthM = (i / (RAMP_H - 1)) * p.depthShownM;
      let layer: GeoLayer = last;
      for (const l of layers) { if (depthM >= l.topM && depthM < l.botM) { layer = l; break; } }
      let hex = layer.hex;
      if (p.highlightAquiclude && layer.key === AQUICLUDE_KEY) hex = mix(hex, 0xff7a3c, 0.28);
      for (const l of layers) { if (l.topM > 0 && Math.abs(depthM - l.topM) < lineHalf) { hex = mix(hex, 0x0a0a0a, 0.55); break; } }
      if (isLand && p.showWaterTable && Math.abs(depthM - p.waterTableM) < wtBand) hex = mix(hex, 0x3fb6e0, 0.85);
      rgb(hex, i * 4, data);
    }
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
    const pos = this.position; const yt = this.yTop; const mar = this.marineAttr; const sb = this.seabed01;
    let o = 0;
    const put = (x: number, y: number, z: number, top: number, marine: number, seabed: number): void => {
      pos[o * 3] = x; pos[o * 3 + 1] = y; pos[o * 3 + 2] = z;
      yt[o] = top; mar[o] = marine; sb[o] = seabed; o++;
    };
    const col = (pt: RingPoint): { top: number; marine: number; seabed: number } => {
      const marine = pt.e < sea || pt.water || p.oceanCell ? 1 : 0;
      const top = topElev(pt.e) * ve;
      const waterDepth = marine
        ? Math.max(sea - pt.e, pt.water ? NOMINAL_WATER_M : 0, p.oceanCell ? p.oceanWaterDepthM : 0)
        : 0;
      const seabed = Math.min(1, Math.max(0, waterDepth / p.depthShownM));
      return { top, marine, seabed };
    };
    for (let i = 0; i < n; i++) {
      const a = ring[i]; const b = ring[(i + 1) % n];
      const ca = col(a); const cb = col(b);
      put(a.x, ca.top, a.z, ca.top, ca.marine, ca.seabed);
      put(a.x, yFloor, a.z, ca.top, ca.marine, ca.seabed);
      put(b.x, cb.top, b.z, cb.top, cb.marine, cb.seabed);
      put(b.x, cb.top, b.z, cb.top, cb.marine, cb.seabed);
      put(a.x, yFloor, a.z, ca.top, ca.marine, ca.seabed);
      put(b.x, yFloor, b.z, cb.top, cb.marine, cb.seabed);
    }
    const s = Math.max(...ring.map((pt) => Math.abs(pt.x)), ...ring.map((pt) => Math.abs(pt.z)));
    const deep = yFloor + H * 2;
    put(-s, yFloor, -s, deep, 0, 0); put(s, yFloor, -s, deep, 0, 0); put(s, yFloor, s, deep, 0, 0);
    put(-s, yFloor, -s, deep, 0, 0); put(s, yFloor, s, deep, 0, 0); put(-s, yFloor, s, deep, 0, 0);

    for (const name of ['position', 'aYTop', 'aMarine', 'aSeabed01']) {
      (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    }
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }

  update(p: GeologyParams): void {
    this.uH.value = p.worldHeight;
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
