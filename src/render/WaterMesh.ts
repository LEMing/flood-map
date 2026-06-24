import * as THREE from 'three';
import type { Params } from '../config';
import type { FrameBasis } from './frameBasis';
import { GLSL_FBM } from './glslNoise';
import { WATER_VERT, WATER_FRAG_HEAD, WATER_FRAG_BODY } from './WaterMesh.glsl';

// rgba of the sim water texture = (depth_m, maxDepth_m, velX, velY).
// The surface mesh reuses the terrain grid; a separate perimeter "skirt" walls
// the map boundary so deep water at the edge has a body instead of a hole.

const vertexShader = WATER_VERT;

const fragmentShader = `${WATER_FRAG_HEAD}${GLSL_FBM}${WATER_FRAG_BODY}`;

export interface WaterFrame extends FrameBasis {
  cloudReflect: number;
}

type WeatherUniforms = Record<'uTime' | 'uStorm' | 'uCloudShadow' | 'uCloudScale' | 'uCloudDrift', THREE.IUniform>;

export class WaterMesh {
  readonly mesh: THREE.Mesh;
  readonly skirt: THREE.Mesh;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly surfaceMat: THREE.ShaderMaterial;
  private readonly skirtMat: THREE.ShaderMaterial;
  private readonly skirtGeo: THREE.BufferGeometry;

  constructor(
    geometry: THREE.BufferGeometry,
    heightTex: THREE.Texture,
    minTerrain: number,
    N: number,
    sizeMeters: number,
    params: Params,
  ) {
    this.uniforms = {
      uWater: { value: null },
      uTexel: { value: new THREE.Vector2(1 / N, 1 / N) },
      uHeightTex: { value: heightTex },
      uMinTerrain: { value: minTerrain },
      uSkirtDrop: { value: 5.0 },
      uSceneColor: { value: null },
      uSceneDepth: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uCameraNear: { value: 1 },
      uCameraFar: { value: 1 },
      uTime: { value: 0 },
      uOpacity: { value: params.waterOpacity },
      uDepthColorMax: { value: params.depthColorMax },
      uAbsorb: { value: new THREE.Vector3() },
      uDeepColor: { value: new THREE.Color(0.03, 0.22, 0.30) },
      uTint: { value: new THREE.Color(0.55, 0.75, 0.92) },
      uSkyTop: { value: new THREE.Color(0.42, 0.62, 0.82) },
      uSkyHorizon: { value: new THREE.Color(0.85, 0.92, 0.97) },
      uCloudColor: { value: new THREE.Color(0.34, 0.36, 0.42) },
      uCloudReflect: { value: 0.15 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1.0, 0.96, 0.9) },
      uRefract: { value: 1 },
      uReflect: { value: 1 },
      uRefractAmount: { value: 0.04 },
      uClarity: { value: params.waterClarity },
      uRippleStrength: { value: params.rippleStrength },
      uFlowScale: { value: params.flowSpeed },
      uShoreFade: { value: Math.max(0.05, params.shorelineSoftness) },
      uFoam: { value: params.foamAmount },
      uFoamVel: { value: 0.3 },
      uGlint: { value: params.sunGlint },
      uShininess: { value: 900.0 },
      uShorelineRim: { value: params.shorelineRim },
      // weather / splashes (aliased from SceneManager.weatherUniforms where possible)
      uRainAmount: { value: 0 },
      uSplashCell: { value: 6.0 },
      uFootprintSpot: { value: 0 },
      uSpotCenter: { value: new THREE.Vector2() },
      uSpotRadius: { value: 1e9 },
      uStorm: { value: 0 },
      uCloudShadow: { value: 0.55 },
      uCloudScale: { value: 1 / 320 },
      uCloudDrift: { value: new THREE.Vector2(0.03, 0.015) },
    };

    const common: THREE.ShaderMaterialParameters = {
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    };
    this.surfaceMat = new THREE.ShaderMaterial(common);
    this.skirtMat = new THREE.ShaderMaterial({ ...common, defines: { SKIRT: '' } });

    this.mesh = new THREE.Mesh(geometry, this.surfaceMat);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;

    this.skirtGeo = buildSkirt(N, sizeMeters);
    this.skirt = new THREE.Mesh(this.skirtGeo, this.skirtMat);
    this.skirt.renderOrder = 1;
    this.skirt.frustumCulled = false;
    this.skirt.visible = params.skirtEnabled;

    this.update(params);
  }

  setDepthTexture(tex: THREE.Texture): void {
    this.uniforms.uWater.value = tex;
  }

  setSceneTextures(color: THREE.Texture | null, depth: THREE.Texture | null): void {
    this.uniforms.uSceneColor.value = color;
    this.uniforms.uSceneDepth.value = depth;
  }

  /** Alias the shared weather uniform objects so SceneManager's per-frame writes propagate. */
  setWeatherUniforms(w: WeatherUniforms): void {
    this.uniforms.uTime = w.uTime;
    this.uniforms.uStorm = w.uStorm;
    this.uniforms.uCloudShadow = w.uCloudShadow;
    this.uniforms.uCloudScale = w.uCloudScale;
    this.uniforms.uCloudDrift = w.uCloudDrift;
  }

  setFrame(f: WaterFrame): void {
    const u = this.uniforms;
    (u.uResolution.value as THREE.Vector2).copy(f.resolution);
    u.uCameraNear.value = f.cameraNear;
    u.uCameraFar.value = f.cameraFar;
    (u.uSunDir.value as THREE.Vector3).copy(f.sunDir);
    (u.uSunColor.value as THREE.Color).copy(f.sunColor);
    (u.uSkyTop.value as THREE.Color).copy(f.skyTop);
    (u.uSkyHorizon.value as THREE.Color).copy(f.skyHorizon);
    u.uCloudReflect.value = f.cloudReflect;
  }

  /** Splash gating, mirrors Rain.update math. */
  setRain(amount: number, spot: boolean, center: THREE.Vector2, radius: number): void {
    this.uniforms.uRainAmount.value = amount;
    this.uniforms.uFootprintSpot.value = spot ? 1 : 0;
    (this.uniforms.uSpotCenter.value as THREE.Vector2).copy(center);
    this.uniforms.uSpotRadius.value = radius;
  }

  update(params: Params): void {
    const u = this.uniforms;
    u.uOpacity.value = params.waterOpacity;
    u.uDepthColorMax.value = params.depthColorMax;
    // sigma so the bottom is ~10% visible at depthColorMax; red absorbed first.
    const k = -Math.log(0.1) / Math.max(0.2, params.depthColorMax);
    (u.uAbsorb.value as THREE.Vector3).set(k, k * 0.34, k * 0.2);
    u.uRippleStrength.value = params.rippleStrength;
    u.uFlowScale.value = params.flowSpeed;
    u.uShoreFade.value = Math.max(0.05, params.shorelineSoftness);
    u.uShorelineRim.value = params.shorelineRim;
    u.uFoam.value = params.waterQuality === 'low' ? 0 : params.foamAmount;
    u.uGlint.value = params.sunGlint;
    u.uRefract.value = params.waterRefraction && params.waterQuality !== 'low' ? 1 : 0;
    u.uReflect.value = params.waterReflections ? 1 : 0;
    u.uClarity.value = params.waterClarity;
    u.uRainAmount.value = params.rainSplashes ? u.uRainAmount.value : 0;
    this.skirt.visible = params.skirtEnabled;
    if (!params.rainSplashes) this.uniforms.uRainAmount.value = 0;
  }

  dispose(): void {
    this.surfaceMat.dispose();
    this.skirtMat.dispose();
    this.skirtGeo.dispose();
  }
}

// Four vertical wall strips around the domain. Each: N columns × 2 rows (lip, floor).
// uv carries the grid UV (to sample height/water in the vertex shader); aSkirtT in {0,1}.
function buildSkirt(N: number, sizeMeters: number): THREE.BufferGeometry {
  const strips = 4;
  const verts = strips * N * 2;
  const pos = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const skirtT = new Float32Array(verts);
  const half = sizeMeters / 2;
  let p = 0, q = 0, r = 0;
  const push = (x: number, z: number, u: number, v: number, t: number) => {
    pos[p++] = x; pos[p++] = 0; pos[p++] = z;
    uv[q++] = u; uv[q++] = v; skirtT[r++] = t;
  };
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1);
    const e = (s - 0.5) * sizeMeters;
    // terrain maps world-Z e -> v = 0.5 - e/size, so the E/W columns carry v = 1 - s.
    push(-half, e, 0, 1 - s, 0); push(-half, e, 0, 1 - s, 1); // -X edge (u=0)
    push(half, e, 1, 1 - s, 0); push(half, e, 1, 1 - s, 1); //  +X edge (u=1)
    push(e, half, s, 0, 0); push(e, half, s, 0, 1); //  +Z edge -> v=0
    push(e, -half, s, 1, 0); push(e, -half, s, 1, 1); // -Z edge -> v=1
  }
  const idx: number[] = [];
  const colStride = strips * 2;
  for (let edge = 0; edge < strips; edge++) {
    const base = edge * 2;
    for (let i = 0; i < N - 1; i++) {
      const a = i * colStride + base;
      const b = a + 1;
      const c = (i + 1) * colStride + base;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aSkirtT', new THREE.BufferAttribute(skirtT, 1));
  g.setIndex(idx);
  return g;
}
