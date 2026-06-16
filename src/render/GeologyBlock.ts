import * as THREE from 'three';
import type { Heightmap } from '../geo/heightmap';
import { AQUICLUDE_KEY, type GeoColumn, type GeoLayer } from '../geo/geology';

export interface GeologyParams {
  verticalExaggeration: number; // terrain Y scale, so the block top meets the relief
  worldHeight: number; // on-screen depth the block extends (world units) = depthShownM mapped
  depthShownM: number; // real depth the block bottom represents (m)
  column: GeoColumn;
  waterTableM: number;
  showWaterTable: boolean;
  highlightAquiclude: boolean;
}

const RAMP_H = 512;
const MAX_PERIMETER = 520; // cap wall columns for perf on big grids

interface RingPoint { x: number; z: number; e: number }

function perimeterRing(hm: Heightmap): RingPoint[] {
  const { N, data, sizeMeters: size } = hm;
  const step = Math.max(1, Math.floor((4 * (N - 1)) / MAX_PERIMETER));
  const at = (ix: number, iy: number): RingPoint => ({
    x: (ix / (N - 1) - 0.5) * size,
    z: (0.5 - iy / (N - 1)) * size,
    e: data[iy * N + ix],
  });
  const ring: RingPoint[] = [];
  for (let ix = 0; ix < N - 1; ix += step) ring.push(at(ix, 0)); // south: W→E
  for (let iy = 0; iy < N - 1; iy += step) ring.push(at(N - 1, iy)); // east: S→N
  for (let ix = N - 1; ix > 0; ix -= step) ring.push(at(ix, N - 1)); // north: E→W
  for (let iy = N - 1; iy > 0; iy -= step) ring.push(at(0, iy)); // west: N→S
  return ring;
}

function rgb(hex: number, i: number, data: Uint8Array): void {
  data[i] = (hex >> 16) & 0xff;
  data[i + 1] = (hex >> 8) & 0xff;
  data[i + 2] = hex & 0xff;
  data[i + 3] = 255;
}

function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff; const ag = (a >> 8) & 0xff; const ab = a & 0xff;
  const br = (b >> 16) & 0xff; const bg = (b >> 8) & 0xff; const bb = b & 0xff;
  return (Math.round(ar + (br - ar) * t) << 16)
    | (Math.round(ag + (bg - ag) * t) << 8)
    | Math.round(ab + (bb - ab) * t);
}

/**
 * Geological cross-section extruded below the terrain. The top edge conforms to
 * the real relief (each wall column rises to its terrain elevation × the current
 * exaggeration); depth is measured BELOW the local surface, so strata drape
 * parallel to the topography instead of lying dead flat. Bottom is a flat floor.
 *
 * Lives in world space (not the terrain group) for an independent deep scale.
 */
export class GeologyBlock {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly ramp: THREE.DataTexture;
  private readonly rampData = new Uint8Array(RAMP_H * 4);
  private readonly geometry: THREE.BufferGeometry;
  private readonly ring: RingPoint[];
  private readonly minE: number;
  private readonly position: Float32Array;
  private readonly yTop: Float32Array;
  private readonly uH = { value: 1 };

  constructor(hm: Heightmap) {
    this.ring = perimeterRing(hm);
    this.minE = this.ring.reduce((m, p) => Math.min(m, p.e), Infinity);

    const segs = this.ring.length;
    const vertCount = segs * 6 + 6; // 2 tris per wall quad + 2 for the floor
    this.position = new Float32Array(vertCount * 3);
    this.yTop = new Float32Array(vertCount);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    this.geometry.setAttribute('aYTop', new THREE.BufferAttribute(this.yTop, 1));

    this.ramp = new THREE.DataTexture(this.rampData, 1, RAMP_H, THREE.RGBAFormat);
    this.ramp.minFilter = THREE.LinearFilter;
    this.ramp.magFilter = THREE.LinearFilter;
    this.ramp.needsUpdate = true;

    this.material = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uRamp = { value: this.ramp };
      shader.uniforms.uH = this.uH;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aYTop;\nvarying float vDepth01;\nuniform float uH;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDepth01 = (aYTop - position.y) / max(uH, 1.0);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vDepth01;\nuniform sampler2D uRamp;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          diffuseColor.rgb = texture2D(uRamp, vec2(0.5, clamp(vDepth01, 0.0, 1.0))).rgb;`,
        );
    };

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  private rebuildRamp(p: GeologyParams): void {
    const { layers } = p.column;
    const last = layers[layers.length - 1];
    const lineHalf = p.depthShownM * 0.004;
    const wtBand = p.depthShownM * 0.006;
    for (let i = 0; i < RAMP_H; i++) {
      const depthM = (i / (RAMP_H - 1)) * p.depthShownM;
      let layer: GeoLayer = last;
      for (const l of layers) {
        if (depthM >= l.topM && depthM < l.botM) { layer = l; break; }
      }
      let hex = layer.hex;
      if (p.highlightAquiclude && layer.key === AQUICLUDE_KEY) hex = mix(hex, 0xff7a3c, 0.28);
      for (const l of layers) {
        if (l.topM > 0 && Math.abs(depthM - l.topM) < lineHalf) { hex = mix(hex, 0x0a0a0a, 0.55); break; }
      }
      if (p.showWaterTable && Math.abs(depthM - p.waterTableM) < wtBand) hex = mix(hex, 0x3fb6e0, 0.85);
      rgb(hex, i * 4, this.rampData);
    }
    this.ramp.needsUpdate = true;
  }

  private rebuildGeometry(ve: number, H: number): void {
    const ring = this.ring;
    const n = ring.length;
    const yFloor = this.minE * ve - H;
    const pos = this.position;
    const top = this.yTop;
    let o = 0; // vertex index
    const put = (x: number, y: number, z: number, yt: number): void => {
      pos[o * 3] = x; pos[o * 3 + 1] = y; pos[o * 3 + 2] = z;
      top[o] = yt;
      o++;
    };
    for (let i = 0; i < n; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      const aTop = a.e * ve;
      const bTop = b.e * ve;
      // quad (aTop, aFloor, bTop, bFloor) → tris (aTop,aFloor,bTop) (bTop,aFloor,bFloor)
      put(a.x, aTop, a.z, aTop); put(a.x, yFloor, a.z, aTop); put(b.x, bTop, b.z, bTop);
      put(b.x, bTop, b.z, bTop); put(a.x, yFloor, a.z, aTop); put(b.x, yFloor, b.z, bTop);
    }
    // flat floor cap: a quad over the footprint, forced to the deepest band
    const s = Math.max(...ring.map((p) => Math.abs(p.x)), ...ring.map((p) => Math.abs(p.z)));
    const deep = yFloor + H * 2; // aYTop so (aYTop - yFloor)/H = 2 → clamps to deepest
    put(-s, yFloor, -s, deep); put(s, yFloor, -s, deep); put(s, yFloor, s, deep);
    put(-s, yFloor, -s, deep); put(s, yFloor, s, deep); put(-s, yFloor, s, deep);

    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aYTop') as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }

  update(p: GeologyParams): void {
    this.uH.value = p.worldHeight;
    this.rebuildRamp(p);
    this.rebuildGeometry(p.verticalExaggeration, p.worldHeight);
  }

  setVisible(v: boolean): void {
    this.mesh.visible = v;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.ramp.dispose();
  }
}
