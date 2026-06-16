import * as THREE from 'three';
import type { Heightmap } from '../geo/heightmap';
import type { Params } from '../config';
import { GLSL_FBM } from './glslNoise';

// A static body of sea water at sea level, separate from the pluvial flood
// WaterMesh. It reuses the terrain grid (flattened to the sea surface) and is
// restricted to cells at/below sea level — real bathymetry where the DEM has
// it, plus coastal land-cover water (ESA WorldCover class 80) where a bare-earth
// DEM reads flat. Alpha-blended over the seabed, so the bottom shows through.

const WATER_CLASS = 80;
const NOMINAL_WATER_M = 10; // assumed depth for coastal land-cover water lacking bathymetry

const vertexShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uSeabed;   // r = seabed elevation (m), g = land-cover water flag
  uniform float uSeaLevel, uNominal;
  varying float vThick;
  varying vec3 vWorld;
  void main() {
    vec4 s = texture2D(uSeabed, uv);
    float elev = s.x;
    bool flag = s.y > 0.5;
    bool sea = elev < uSeaLevel || (flag && elev < uSeaLevel + 2.0);
    vThick = sea ? max(uSeaLevel - elev, flag ? uNominal : 0.01) : -1.0;
    vec3 p = vec3(position.x, uSeaLevel, position.z);
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime, uDepthScale, uOpacity, uRipple, uGlint;
  uniform vec3 uShallow, uDeep, uSkyTop, uSkyHorizon, uSunDir, uSunColor;
  varying float vThick;
  varying vec3 vWorld;
  ${GLSL_FBM}
  vec3 rippleNormal(vec2 p, float t) {
    float e = 0.8, sa = 1.0 / 120.0, sb = 1.0 / 38.0;
    vec2 adv = vec2(0.6, 0.4) * t * 0.05;
    float hxA = wNoise((p + vec2(e,0)) * sa + adv) - wNoise((p - vec2(e,0)) * sa + adv);
    float hyA = wNoise((p + vec2(0,e)) * sa + adv) - wNoise((p - vec2(0,e)) * sa + adv);
    float hxB = wNoise((p + vec2(e,0)) * sb - adv) - wNoise((p - vec2(e,0)) * sb - adv);
    float hyB = wNoise((p + vec2(0,e)) * sb - adv) - wNoise((p - vec2(0,e)) * sb - adv);
    return normalize(vec3(-(0.6*hxA + 0.4*hxB), -(0.6*hyA + 0.4*hyB), 1.0));
  }
  void main() {
    if (vThick <= 0.001) discard;
    float dt = 1.0 - exp(-vThick / uDepthScale);
    vec3 col = mix(uShallow, uDeep, dt);
    vec3 viewDir = normalize(cameraPosition - vWorld);
    vec3 nTS = rippleNormal(vWorld.xz, uTime);
    vec3 surfN = normalize(vec3(0.0, 1.0, 0.0) + uRipple * vec3(nTS.x, 0.0, nTS.y));
    vec3 reflDir = reflect(-viewDir, surfN);
    float up = clamp(reflDir.y, 0.0, 1.0);
    vec3 sky = mix(uSkyHorizon, uSkyTop, pow(up, 0.5));
    float f0 = 0.02;
    float fres = f0 + (1.0 - f0) * pow(1.0 - max(dot(viewDir, surfN), 0.0), 5.0);
    col = mix(col, sky, clamp(fres * 1.3, 0.0, 0.9));
    vec3 halfV = normalize(uSunDir + viewDir);
    col += uSunColor * pow(max(dot(surfN, halfV), 0.0), 200.0) * uGlint;
    float foam = smoothstep(0.0, 0.2, vThick) * (1.0 - smoothstep(0.2, 0.6, vThick)); // thin waterline only
    foam *= smoothstep(0.55, 0.9, wNoise(vWorld.xz * 0.4 + uTime * 0.1));
    col = mix(col, vec3(0.9, 0.94, 1.0), foam * 0.3);
    float alpha = clamp(uOpacity * (0.55 + 0.45 * dt) + fres * 0.15 + foam * 0.2, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`;

type WeatherUniforms = Record<'uTime', THREE.IUniform>;

export interface SeaFrame {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
}

export class SeaMesh {
  readonly mesh: THREE.Mesh;
  readonly hasSea: boolean;
  private readonly material: THREE.ShaderMaterial;
  private readonly seabedTex: THREE.DataTexture;
  private readonly uniforms: Record<string, THREE.IUniform>;

  constructor(geometry: THREE.BufferGeometry, hm: Heightmap, waterMask: Uint8Array | null, params: Params) {
    const { N, data } = hm;
    const rgba = new Float32Array(N * N * 4);
    let hasSea = false;
    const sea = params.seaLevelM;
    for (let i = 0; i < N * N; i++) {
      const elev = data[i];
      const flag = waterMask ? waterMask[i] === WATER_CLASS : false;
      rgba[i * 4] = elev;
      rgba[i * 4 + 1] = flag ? 1 : 0;
      if (elev < sea || (flag && elev < sea + 2)) hasSea = true;
    }
    this.hasSea = hasSea;
    this.seabedTex = new THREE.DataTexture(rgba, N, N, THREE.RGBAFormat, THREE.FloatType);
    this.seabedTex.minFilter = THREE.NearestFilter;
    this.seabedTex.magFilter = THREE.NearestFilter;
    this.seabedTex.needsUpdate = true;

    this.uniforms = {
      uSeabed: { value: this.seabedTex },
      uSeaLevel: { value: params.seaLevelM },
      uNominal: { value: NOMINAL_WATER_M },
      uTime: { value: 0 },
      uDepthScale: { value: 12.0 },
      uOpacity: { value: params.waterOpacity },
      uRipple: { value: params.rippleStrength },
      uGlint: { value: params.sunGlint },
      uShallow: { value: new THREE.Color(0.22, 0.52, 0.58) },
      uDeep: { value: new THREE.Color(0.02, 0.10, 0.22) },
      uSkyTop: { value: new THREE.Color(0.42, 0.62, 0.82) },
      uSkyHorizon: { value: new THREE.Color(0.85, 0.92, 0.97) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 0.96, 0.9) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.renderOrder = 0.5; // above terrain (0), below flood water (1)
    this.mesh.frustumCulled = false;
    this.mesh.visible = hasSea;
  }

  setWeatherUniforms(w: WeatherUniforms): void {
    this.uniforms.uTime = w.uTime;
  }

  setFrame(f: SeaFrame): void {
    (this.uniforms.uSunDir.value as THREE.Vector3).copy(f.sunDir);
    (this.uniforms.uSunColor.value as THREE.Color).copy(f.sunColor);
    (this.uniforms.uSkyTop.value as THREE.Color).copy(f.skyTop);
    (this.uniforms.uSkyHorizon.value as THREE.Color).copy(f.skyHorizon);
  }

  update(params: Params): void {
    this.uniforms.uSeaLevel.value = params.seaLevelM;
    this.uniforms.uOpacity.value = params.waterOpacity;
    this.uniforms.uRipple.value = params.rippleStrength;
    this.uniforms.uGlint.value = params.sunGlint;
    this.mesh.visible = this.hasSea;
  }

  dispose(): void {
    this.material.dispose();
    this.seabedTex.dispose();
  }
}
