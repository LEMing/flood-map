import * as THREE from 'three';
import type { TerrainStyle } from '../config';
import type { Heightmap } from '../geo/heightmap';
import { GLSL_FBM } from './glslNoise';

type WeatherUniforms = Record<'uTime' | 'uStorm' | 'uCloudShadow' | 'uCloudScale' | 'uCloudDrift', THREE.IUniform>;

// Build the shared grid geometry (raw elevation in metres, no vertical
// exaggeration — that is applied as a group scale so terrain and water stay
// consistent). World axes: +X east, +Y up, -Z north.
export function createTerrainGeometry(hm: Heightmap): THREE.BufferGeometry {
  const { data, N, sizeMeters } = hm;
  const positions = new Float32Array(N * N * 3);
  const uvs = new Float32Array(N * N * 2);

  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      const k = iy * N + ix;
      const u = ix / (N - 1);
      const v = iy / (N - 1);
      positions[k * 3] = (u - 0.5) * sizeMeters;
      positions[k * 3 + 1] = data[k];
      positions[k * 3 + 2] = (0.5 - v) * sizeMeters;
      uvs[k * 2] = u;
      uvs[k * 2 + 1] = v;
    }
  }

  const cells = N - 1;
  const index = new Uint32Array(cells * cells * 6);
  let o = 0;
  for (let iy = 0; iy < cells; iy++) {
    for (let ix = 0; ix < cells; ix++) {
      const a = iy * N + ix;
      const b = a + 1;
      const c = a + N;
      const d = c + 1;
      index[o++] = a; index[o++] = b; index[o++] = c;
      index[o++] = b; index[o++] = d; index[o++] = c;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  return geo;
}

/** Float texture of raw terrain heights (R channel), aligned to sim cells. */
export function createHeightTexture(hm: Heightmap): THREE.DataTexture {
  const { data, N } = hm;
  const rgba = new Float32Array(N * N * 4);
  for (let i = 0; i < N * N; i++) rgba[i * 4] = data[i];
  const tex = new THREE.DataTexture(rgba, N, N, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

type Ramp = Array<{ t: number; c: THREE.Color }>;

// Hypsometric (natural elevation) tint: lowland green -> tan -> brown -> snow.
const HYPSO_RAMP: Ramp = [
  { t: 0.0, c: new THREE.Color(0x2f6d4f) },
  { t: 0.35, c: new THREE.Color(0x7d9b54) },
  { t: 0.6, c: new THREE.Color(0xb6a06a) },
  { t: 0.8, c: new THREE.Color(0x8a5d3b) },
  { t: 1.0, c: new THREE.Color(0xf3f3f3) },
];

// Thermal heatmap: low = blue, high = red (data-viz of elevation).
const HEAT_RAMP: Ramp = [
  { t: 0.0, c: new THREE.Color(0x07154d) },
  { t: 0.2, c: new THREE.Color(0x1f6fe5) },
  { t: 0.4, c: new THREE.Color(0x18c7c0) },
  { t: 0.55, c: new THREE.Color(0x3fdd54) },
  { t: 0.7, c: new THREE.Color(0xf2e020) },
  { t: 0.85, c: new THREE.Color(0xf58a1f) },
  { t: 1.0, c: new THREE.Color(0xd11414) },
];

function rampColor(ramp: Ramp, t: number, out: THREE.Color): void {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 0; i < ramp.length - 1; i++) {
    const a = ramp[i];
    const b = ramp[i + 1];
    if (x <= b.t) {
      out.copy(a.c).lerp(b.c, (x - a.t) / (b.t - a.t));
      return;
    }
  }
  out.copy(ramp[ramp.length - 1].c);
}

function buildColors(hm: Heightmap, ramp: Ramp): THREE.BufferAttribute {
  const colors = new Float32Array(hm.N * hm.N * 3);
  const span = Math.max(1e-3, hm.max - hm.min);
  const col = new THREE.Color();
  for (let i = 0; i < hm.N * hm.N; i++) {
    rampColor(ramp, (hm.data[i] - hm.min) / span, col);
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  return new THREE.BufferAttribute(colors, 3);
}

export class TerrainMesh {
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;
  readonly heightTexture: THREE.DataTexture;
  private readonly material: THREE.MeshStandardMaterial;
  private satellite?: THREE.Texture;
  private style: TerrainStyle = 'hypsometric';
  private readonly sizeMeters: number;
  private readonly dummyDepth: THREE.DataTexture;
  private currentDepth: THREE.Texture;
  private absorb = 1.5;
  private darken = 0.8;
  private wetness = 0;
  private readonly skyTint = new THREE.Color(0.55, 0.68, 0.82);
  private weatherUniforms?: WeatherUniforms;
  private depthUniforms?: Record<string, THREE.IUniform>;
  private readonly hypsoColor: THREE.BufferAttribute;
  private readonly heatColor: THREE.BufferAttribute;
  private surfaceColor?: THREE.BufferAttribute;

  get hasSatellite(): boolean {
    return !!this.satellite;
  }

  constructor(hm: Heightmap, wireframe: boolean) {
    this.sizeMeters = hm.sizeMeters;
    this.dummyDepth = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    this.dummyDepth.needsUpdate = true;
    this.currentDepth = this.dummyDepth;
    this.geometry = createTerrainGeometry(hm);
    this.heightTexture = createHeightTexture(hm);

    this.hypsoColor = buildColors(hm, HYPSO_RAMP);
    this.heatColor = buildColors(hm, HEAT_RAMP);
    this.geometry.setAttribute('color', this.hypsoColor);

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0.0,
      wireframe,
    });
    this.material.onBeforeCompile = (shader) => {
      const w = this.weatherUniforms;
      shader.uniforms.uSize = { value: this.sizeMeters };
      shader.uniforms.uDepthTex = { value: this.currentDepth };
      shader.uniforms.uDepthAbsorb = { value: this.absorb };
      shader.uniforms.uDepthDarken = { value: this.darken };
      shader.uniforms.uWetness = { value: this.wetness };
      shader.uniforms.uTime = w ? w.uTime : { value: 0 };
      shader.uniforms.uStorm = w ? w.uStorm : { value: 0 };
      shader.uniforms.uCloudShadow = w ? w.uCloudShadow : { value: 0.55 };
      shader.uniforms.uCloudScale = w ? w.uCloudScale : { value: 1 / 320 };
      shader.uniforms.uCloudDrift = w ? w.uCloudDrift : { value: new THREE.Vector2(0.03, 0.015) };
      const n = (this.heightTexture.image as { width: number }).width;
      shader.uniforms.uTexel = { value: new THREE.Vector2(1 / n, 1 / n) };
      shader.uniforms.uWetSky = { value: this.skyTint };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGridUv;\nuniform float uSize;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvGridUv = vec2(position.x / uSize + 0.5, 0.5 - position.z / uSize);',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec2 vGridUv;
          uniform sampler2D uDepthTex;
          uniform float uDepthAbsorb, uDepthDarken, uWetness, uSize;
          uniform float uTime, uStorm, uCloudShadow, uCloudScale;
          uniform vec2 uCloudDrift, uTexel;
          uniform vec3 uWetSky;
          ${GLSL_FBM}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float gWet = 0.0;
          {
            float wd = texture2D(uDepthTex, vGridUv).x;
            float a = 1.0 - exp(-wd * uDepthAbsorb);
            diffuseColor.rgb *= (1.0 - a * uDepthDarken);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.35, 0.55, 0.85), a * 0.5 * uDepthDarken);

            // wet ground only where there is water nearby (a damp halo around the
            // flood), NOT the whole map just because it is raining.
            float nearWater = 0.0;
            for (int j = -2; j <= 2; j++) {
              for (int i = -2; i <= 2; i++) {
                nearWater = max(nearWater, texture2D(uDepthTex, vGridUv + vec2(float(i), float(j)) * uTexel).x);
              }
            }
            gWet = uWetness * smoothstep(0.004, 0.04, nearWater);
            diffuseColor.rgb *= (1.0 - 0.42 * gWet);                                   // wet = darker
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.85, 0.92, 1.08), 0.35 * gWet);

            vec2 worldXZ = (vGridUv - 0.5) * uSize;
            vec2 sp = worldXZ * uCloudScale + uCloudDrift * uTime;
            float clouds = wFbm(sp + wFbm(sp * 0.5));
            float shadow = smoothstep(0.45, 0.85, clouds) * uCloudShadow * uStorm;
            diffuseColor.rgb *= (1.0 - shadow);
          }`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.12, gWet); // wet = glossy (set in color_fragment)`,
        )
        .replace(
          '#include <opaque_fragment>',
          `{
            // wet ground reflects the sky (glossy fresnel sheen) — the main "wet" cue
            vec3 wetV = normalize(vViewPosition);
            float wetFr = pow(1.0 - clamp(dot(wetV, normal), 0.0, 1.0), 4.0);
            outgoingLight = mix(outgoingLight, uWetSky, gWet * (0.22 + 0.65 * wetFr));
          }
          #include <opaque_fragment>`,
        );
      this.depthUniforms = shader.uniforms;
    };

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 0;
  }

  /** Current water-state texture (depth in r) used to darken the terrain beneath. */
  setDepthTexture(tex: THREE.Texture): void {
    this.currentDepth = tex;
    if (this.depthUniforms) this.depthUniforms.uDepthTex.value = tex;
  }

  setWetness(w: number): void {
    this.wetness = w;
    if (this.depthUniforms) this.depthUniforms.uWetness.value = w;
  }

  /** Colour the wet-ground sheen reflects (the current sky). */
  setSkyTint(color: THREE.Color): void {
    this.skyTint.copy(color);
  }

  /** Alias the shared weather uniform objects so SceneManager's writes propagate. */
  setWeatherUniforms(w: WeatherUniforms): void {
    this.weatherUniforms = w;
    if (!this.depthUniforms) return;
    this.depthUniforms.uTime = w.uTime;
    this.depthUniforms.uStorm = w.uStorm;
    this.depthUniforms.uCloudShadow = w.uCloudShadow;
    this.depthUniforms.uCloudScale = w.uCloudScale;
    this.depthUniforms.uCloudDrift = w.uCloudDrift;
  }

  updateWater(depthColorMax: number, darkening: number): void {
    this.absorb = 2.0 / Math.max(0.2, depthColorMax);
    this.darken = darkening;
    if (this.depthUniforms) {
      this.depthUniforms.uDepthAbsorb.value = this.absorb;
      this.depthUniforms.uDepthDarken.value = this.darken;
    }
  }

  setWireframe(on: boolean): void {
    this.material.wireframe = on;
  }

  /** Attach draped imagery (uses a second UV set so the grid UVs stay intact). */
  setSatellite(texture: THREE.Texture, uvSat: Float32Array): void {
    this.satellite?.dispose();
    this.satellite = texture;
    texture.channel = 1; // sample using the 'uv1' attribute
    this.geometry.setAttribute('uv1', new THREE.BufferAttribute(uvSat, 2));
    this.applyStyle(this.style);
  }

  /** Per-cell flood-risk colours from the surface fields (red = no removal). */
  setSurfaceColors(surface: Float32Array, N: number): void {
    const colors = new Float32Array(N * N * 3);
    const dry = new THREE.Color(0x2f8f3a);
    const risky = new THREE.Color(0xd11414);
    const gray = new THREE.Color(0x555a60);
    const out = new THREE.Color();
    for (let i = 0; i < N * N; i++) {
      const sinkMmHr = (surface[i * 4] + surface[i * 4 + 1]) * 1000 * 3600;
      if (surface[i * 4 + 3] > 0.5) out.copy(gray); // building
      else out.copy(dry).lerp(risky, 1 - Math.min(1, sinkMmHr / 15));
      colors[i * 3] = out.r;
      colors[i * 3 + 1] = out.g;
      colors[i * 3 + 2] = out.b;
    }
    this.surfaceColor = new THREE.BufferAttribute(colors, 3);
    if (this.style === 'surface') this.applyStyle('surface');
  }

  applyStyle(style: TerrainStyle): void {
    this.style = style;
    const useSat = style === 'satellite' && !!this.satellite;
    this.material.map = useSat ? this.satellite ?? null : null;
    this.material.vertexColors = !useSat;
    this.material.roughness = useSat ? 0.85 : 0.96;
    if (!useSat) {
      const attr = style === 'heatmap' ? this.heatColor
        : style === 'surface' && this.surfaceColor ? this.surfaceColor
          : this.hypsoColor;
      this.geometry.setAttribute('color', attr);
    }
    this.material.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.heightTexture.dispose();
    this.satellite?.dispose();
    this.dummyDepth.dispose();
  }
}
