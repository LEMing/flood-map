import * as THREE from 'three';
import type { Heightmap } from '../geo/heightmap';
import type { Params } from '../config';
import { GLSL_FBM } from './glslNoise';

// A static body of sea water at sea level, separate from the pluvial flood
// WaterMesh. It reuses the terrain grid (flattened to the sea surface) and is
// restricted to cells at/below sea level — real bathymetry where the DEM has
// it, plus coastal land-cover water (ESA WorldCover class 80) where a bare-earth
// DEM reads flat. Screen-space refraction shows the seabed; depth tints it.

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
    bool sea = (flag && elev < uSeaLevel + 2.0) || elev < uSeaLevel - 1.0;
    vThick = sea ? max(uSeaLevel - elev, flag ? uNominal : 0.01) : -1.0;
    vec3 p = vec3(position.x, uSeaLevel, position.z);
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uSceneColor, uSceneDepth;
  uniform vec2 uResolution;
  uniform float uCameraNear, uCameraFar;
  uniform float uTime, uOpacity, uRipple, uGlint, uRefract;
  uniform vec3 uAbsorb, uDeep, uTint, uSkyTop, uSkyHorizon, uCloudColor, uSunDir, uSunColor;
  varying float vThick;
  varying vec3 vWorld;
  ${GLSL_FBM}

  vec3 rippleNormal(vec2 p, float t) {
    float e = 0.8, sa = 1.0 / 130.0, sb = 1.0 / 41.0;
    vec2 adv = vec2(0.6, 0.4) * t * 0.04;
    float hxA = wNoise((p + vec2(e,0)) * sa + adv) - wNoise((p - vec2(e,0)) * sa + adv);
    float hyA = wNoise((p + vec2(0,e)) * sa + adv) - wNoise((p - vec2(0,e)) * sa + adv);
    float hxB = wNoise((p + vec2(e,0)) * sb - adv*1.6) - wNoise((p - vec2(e,0)) * sb - adv*1.6);
    float hyB = wNoise((p + vec2(0,e)) * sb - adv*1.6) - wNoise((p - vec2(0,e)) * sb - adv*1.6);
    return normalize(vec3(-(0.6*hxA + 0.4*hxB), -(0.6*hyA + 0.4*hyB), 1.0));
  }
  float viewZ(float d) {
    float z = d * 2.0 - 1.0;
    return (2.0 * uCameraNear * uCameraFar) / (z * (uCameraFar - uCameraNear) - (uCameraFar + uCameraNear));
  }

  void main() {
    if (vThick <= 0.001) discard;
    vec3 viewDir = normalize(cameraPosition - vWorld);
    vec3 nTS = rippleNormal(vWorld.xz, uTime);
    vec3 surfN = normalize(vec3(0.0, 1.0, 0.0) + uRipple * vec3(nTS.x, 0.0, nTS.y));

    // --- screen-space refraction of the submerged seabed ---
    vec2 screenUv = gl_FragCoord.xy / uResolution;
    vec3 bottomColor;
    if (uRefract > 0.5) {
      vec2 refrUv = clamp(screenUv + surfN.xz * 0.03 * clamp(vThick * 0.1, 0.0, 1.0), vec2(0.001), vec2(0.999));
      float sceneVZ = viewZ(texture2D(uSceneDepth, refrUv).x);
      float fragVZ = viewZ(gl_FragCoord.z);
      if (sceneVZ > fragVZ + abs(fragVZ) * 0.01 + 0.5) refrUv = screenUv; // reject geometry in front
      bottomColor = texture2D(uSceneColor, refrUv).rgb;
    } else {
      bottomColor = texture2D(uSceneColor, screenUv).rgb;
    }

    // --- Beer-Lambert depth absorption ---
    vec3 transmit = exp(-vThick * uAbsorb);
    vec3 throughWater = mix(uDeep, bottomColor * uTint, transmit);

    // --- sky + cloud reflection with fresnel ---
    vec3 reflDir = reflect(-viewDir, surfN);
    float up = clamp(reflDir.y, 0.0, 1.0);
    vec3 sky = mix(uSkyHorizon, uSkyTop, pow(up, 0.5));
    float cl = 0.5 + 0.5 * sin(reflDir.x * 8.0 + uTime * 0.05) * sin(reflDir.z * 8.0);
    sky = mix(sky, uCloudColor, smoothstep(0.6, 0.95, cl) * up * 0.2);
    float f0 = 0.02;
    float fres = clamp((f0 + (1.0 - f0) * pow(1.0 - max(dot(viewDir, surfN), 0.0), 5.0)) * 1.3, 0.0, 0.92);
    vec3 col = mix(throughWater, sky, fres);

    // --- thin shoreline foam ---
    float foam = smoothstep(0.0, 0.2, vThick) * (1.0 - smoothstep(0.2, 0.6, vThick));
    foam *= smoothstep(0.55, 0.9, wNoise(vWorld.xz * 0.4 + uTime * 0.1));
    col = mix(col, vec3(0.92, 0.95, 1.0), foam * 0.4);

    // --- sun glint ---
    vec3 halfV = normalize(uSunDir + viewDir);
    col += uSunColor * pow(max(dot(surfN, halfV), 0.0), 220.0) * uGlint * 0.6;

    float dt = 1.0 - exp(-vThick / 8.0);
    float alpha = clamp(uOpacity * (0.5 + 0.5 * dt) + fres * 0.25 + foam * 0.4, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`;

type WeatherUniforms = Record<'uTime', THREE.IUniform>;

export interface SeaFrame {
  resolution: THREE.Vector2;
  cameraNear: number;
  cameraFar: number;
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  cloudColor: THREE.Color;
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
      if ((flag && elev < sea + 2) || elev < sea - 1) hasSea = true;
    }
    this.hasSea = hasSea;
    this.seabedTex = new THREE.DataTexture(rgba, N, N, THREE.RGBAFormat, THREE.FloatType);
    this.seabedTex.minFilter = THREE.NearestFilter;
    this.seabedTex.magFilter = THREE.NearestFilter;
    this.seabedTex.needsUpdate = true;

    const k = -Math.log(0.1) / 12; // ~10% of the seabed visible at 12 m depth
    this.uniforms = {
      uSeabed: { value: this.seabedTex },
      uSeaLevel: { value: params.seaLevelM },
      uNominal: { value: NOMINAL_WATER_M },
      uSceneColor: { value: null },
      uSceneDepth: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uCameraNear: { value: 1 },
      uCameraFar: { value: 1 },
      uTime: { value: 0 },
      uOpacity: { value: params.waterOpacity },
      uRipple: { value: params.rippleStrength },
      uGlint: { value: params.sunGlint },
      uRefract: { value: 1 },
      uAbsorb: { value: new THREE.Vector3(k, k * 0.34, k * 0.2) },
      uDeep: { value: new THREE.Color(0.02, 0.10, 0.20) },
      uTint: { value: new THREE.Color(0.45, 0.72, 0.86) },
      uSkyTop: { value: new THREE.Color(0.42, 0.62, 0.82) },
      uSkyHorizon: { value: new THREE.Color(0.85, 0.92, 0.97) },
      uCloudColor: { value: new THREE.Color(0.34, 0.36, 0.42) },
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
      polygonOffset: true, // bias above the near-coplanar shallow seabed → no z-fighting
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.renderOrder = 0.5; // above terrain (0), below flood water (1)
    this.mesh.frustumCulled = false;
    this.mesh.visible = hasSea;
  }

  setWeatherUniforms(w: WeatherUniforms): void {
    this.uniforms.uTime = w.uTime;
  }

  setSceneTextures(color: THREE.Texture | null, depth: THREE.Texture | null): void {
    this.uniforms.uSceneColor.value = color;
    this.uniforms.uSceneDepth.value = depth;
  }

  setFrame(f: SeaFrame): void {
    (this.uniforms.uResolution.value as THREE.Vector2).copy(f.resolution);
    this.uniforms.uCameraNear.value = f.cameraNear;
    this.uniforms.uCameraFar.value = f.cameraFar;
    (this.uniforms.uSunDir.value as THREE.Vector3).copy(f.sunDir);
    (this.uniforms.uSunColor.value as THREE.Color).copy(f.sunColor);
    (this.uniforms.uSkyTop.value as THREE.Color).copy(f.skyTop);
    (this.uniforms.uSkyHorizon.value as THREE.Color).copy(f.skyHorizon);
    (this.uniforms.uCloudColor.value as THREE.Color).copy(f.cloudColor);
  }

  update(params: Params): void {
    this.uniforms.uSeaLevel.value = params.seaLevelM;
    this.uniforms.uOpacity.value = params.waterOpacity;
    this.uniforms.uRipple.value = params.rippleStrength;
    this.uniforms.uGlint.value = params.sunGlint;
    this.uniforms.uRefract.value = params.waterRefraction && params.waterQuality !== 'low' ? 1 : 0;
    this.mesh.visible = this.hasSea;
  }

  dispose(): void {
    this.material.dispose();
    this.seabedTex.dispose();
  }
}
