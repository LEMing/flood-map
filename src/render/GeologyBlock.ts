import * as THREE from 'three';
import { AQUICLUDE_KEY, type GeoColumn, type GeoLayer } from '../geo/geology';

export interface GeologyParams {
  worldTop: number; // world Y of the terrain underside (hm.min * verticalExaggeration)
  worldHeight: number; // on-screen height of the block (world units)
  depthShownM: number; // real depth the block bottom represents (m)
  column: GeoColumn;
  waterTableM: number;
  showWaterTable: boolean;
  highlightAquiclude: boolean;
}

const RAMP_H = 512;

function rgb(hex: number, i: number, data: Uint8Array): void {
  data[i] = (hex >> 16) & 0xff;
  data[i + 1] = (hex >> 8) & 0xff;
  data[i + 2] = hex & 0xff;
  data[i + 3] = 255;
}

/**
 * A geological cross-section block extruded straight down from the terrain
 * underside. Strata are painted by real depth via a 1-D ramp texture, so the
 * layer count is arbitrary and contacts are crisp; the lit MeshStandardMaterial
 * makes the ground read as a solid volume rather than a paper-thin slab.
 *
 * Lives in world space (added to the scene directly, NOT the terrain group), so
 * the deep view has its own vertical scale independent of terrain exaggeration.
 */
export class GeologyBlock {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly ramp: THREE.DataTexture;
  private readonly rampData = new Uint8Array(RAMP_H * 4);

  constructor(sizeMeters: number) {
    this.ramp = new THREE.DataTexture(this.rampData, 1, RAMP_H, THREE.RGBAFormat);
    this.ramp.minFilter = THREE.LinearFilter;
    this.ramp.magFilter = THREE.LinearFilter;
    this.ramp.needsUpdate = true;

    this.material = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.0 });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uRamp = { value: this.ramp };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vDepthNorm;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDepthNorm = 0.5 - position.y;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vDepthNorm;\nuniform sampler2D uRamp;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          diffuseColor.rgb = texture2D(uRamp, vec2(0.5, clamp(vDepthNorm, 0.0, 1.0))).rgb;`,
        );
    };

    const geo = new THREE.BoxGeometry(sizeMeters, 1, sizeMeters);
    this.mesh = new THREE.Mesh(geo, this.material);
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
      const norm = i / (RAMP_H - 1);
      const depthM = norm * p.depthShownM;
      let layer: GeoLayer = last;
      for (const l of layers) {
        if (depthM >= l.topM && depthM < l.botM) { layer = l; break; }
      }
      let hex = layer.hex;

      if (p.highlightAquiclude && layer.key === AQUICLUDE_KEY) {
        hex = mix(hex, 0xff7a3c, 0.28); // warm tint on the Maikop aquiclude
      }
      // thin dark contact line at each layer boundary → geological cross-section look
      for (const l of layers) {
        if (Math.abs(depthM - l.topM) < lineHalf && l.topM > 0) { hex = mix(hex, 0x0a0a0a, 0.55); break; }
      }
      if (p.showWaterTable && Math.abs(depthM - p.waterTableM) < wtBand) {
        hex = mix(hex, 0x3fb6e0, 0.85); // groundwater table line
      }
      rgb(hex, i * 4, this.rampData);
    }
    this.ramp.needsUpdate = true;
  }

  update(p: GeologyParams): void {
    this.rebuildRamp(p);
    this.mesh.scale.set(1, p.worldHeight, 1);
    this.mesh.position.set(0, p.worldTop - p.worldHeight / 2, 0);
  }

  setVisible(v: boolean): void {
    this.mesh.visible = v;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.ramp.dispose();
  }
}

function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff; const ag = (a >> 8) & 0xff; const ab = a & 0xff;
  const br = (b >> 16) & 0xff; const bg = (b >> 8) & 0xff; const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
