import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import type { Params } from '../config';
import { GLSL_FBM } from './glslNoise';
import { GodRayShader } from './godRayShader';
import { makeCloudDome, type CloudDomeHandle } from './CloudDome';
import type { WaterMesh } from './WaterMesh';
import type { SeaMesh } from './SeaMesh';

const BOLT_CAP = 320; // max line segments in a recursive branching bolt

export interface WeatherUniformBlock {
  uTime: THREE.IUniform<number>;
  uCloudDrift: THREE.IUniform<THREE.Vector2>;
  uCloudScale: THREE.IUniform<number>;
  uStorm: THREE.IUniform<number>;
  uCloudShadow: THREE.IUniform<number>;
  uSunScreen: THREE.IUniform<THREE.Vector2>;
  uSunVisible: THREE.IUniform<number>;
}

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly clearSky: THREE.Texture;

  // linear-space sky colours fed to the water reflection shader
  private readonly clearTop = new THREE.Color('#6f9fd0');
  private readonly clearHorizon = new THREE.Color('#d9e6f2');
  private readonly stormTop = new THREE.Color('#1b2230');
  private readonly stormHorizon = new THREE.Color('#5a6470');

  private readonly cloudDome: CloudDomeHandle;
  // The dome lives in its own scene and is raymarched into a half-res HDR target
  // (clouds are low-frequency, so the ~4× pixel saving is near-invisible); a
  // full-screen blit upscales + tonemaps it into the main scene.
  private readonly domeScene = new THREE.Scene();
  private readonly domeRT: THREE.WebGLRenderTarget;
  private readonly domeBlit: THREE.Mesh;
  private readonly haze: THREE.Mesh;
  private readonly lightningLight: THREE.DirectionalLight;
  private readonly bolt: THREE.LineSegments;
  private readonly boltGeo: THREE.BufferGeometry;
  private readonly boltPositions: Float32Array;

  private stormEnabled = false;
  private flash = 0;
  private flashTimer = 3;
  private boltTime = 0;
  private boltCount = 0;
  private sceneSize = 2000;
  private sceneCenterH = 0;
  private cloudY = 600;

  readonly weather: WeatherUniformBlock = {
    uTime: { value: 0 },
    uCloudDrift: { value: new THREE.Vector2(0.03, 0.015) },
    uCloudScale: { value: 1 / 320 },
    uStorm: { value: 0 },
    uCloudShadow: { value: 0.5 },
    uSunScreen: { value: new THREE.Vector2(0.5, 0.8) },
    uSunVisible: { value: 0 },
  };

  // post-processing
  private readonly sceneRT: THREE.WebGLRenderTarget;
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly godRayPass: ShaderPass;
  private readonly wetLensPass: ShaderPass;
  private readonly vignettePass: ShaderPass;
  private readonly outputPass: OutputPass;
  private wetTarget = 0;
  private wetCurrent = 0;
  private gtaoPass?: GTAOPass;
  private postEnabled = true;
  private godRayScale = 0.4;
  private renderScale = 1;
  private readonly dprCap = Math.min(window.devicePixelRatio, 2);
  private refractionExcludes: THREE.Object3D[] = [];
  private readonly tmpVec = new THREE.Vector3();
  private readonly tmpSun = new THREE.Vector3();
  private readonly sunCol = new THREE.Color();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x0b0e13, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.clearSky = makeSkyGradient(['#6f9fd0', '#a9c8e6', '#d9e6f2']);
    this.scene.background = this.clearSky;

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 200000);
    this.camera.position.set(1500, 1400, 1500);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x55514a, 1.0);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff4e6, 2.2);
    this.sun.position.set(-1, 1.4, -0.8).normalize();
    this.scene.add(this.sun, this.sun.target);

    this.lightningLight = new THREE.DirectionalLight(0xdfeaff, 0);
    this.lightningLight.position.set(0.2, 1, 0.1);
    this.scene.add(this.lightningLight, this.lightningLight.target);

    this.cloudDome = makeCloudDome(Math.min(this.camera.far * 0.5, 8000));
    this.cloudDome.mesh.visible = true; // gated by rendering domeScene only when storm is on
    this.domeScene.add(this.cloudDome.mesh);
    const dds = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.domeRT = new THREE.WebGLRenderTarget(
      Math.max(2, Math.ceil(dds.x / 2)), Math.max(2, Math.ceil(dds.y / 2)),
      { type: THREE.HalfFloatType, depthBuffer: false },
    );
    this.domeRT.texture.minFilter = THREE.LinearFilter;
    this.domeRT.texture.magFilter = THREE.LinearFilter;
    this.domeBlit = makeDomeBlit(this.domeRT.texture);
    this.scene.add(this.domeBlit);

    this.haze = makeHaze(this.weather);
    this.scene.add(this.haze);

    this.boltPositions = new Float32Array(BOLT_CAP * 6);
    this.boltGeo = new THREE.BufferGeometry();
    this.boltGeo.setAttribute('position', new THREE.BufferAttribute(this.boltPositions, 3));
    this.bolt = new THREE.LineSegments(
      this.boltGeo,
      new THREE.LineBasicMaterial({
        color: 0xeaf2ff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.bolt.frustumCulled = false;
    this.bolt.renderOrder = 5;
    this.bolt.visible = false;
    this.scene.add(this.bolt);

    const ds = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.sceneRT = new THREE.WebGLRenderTarget(ds.x, ds.y, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(ds.x, ds.y, THREE.UnsignedIntType),
    });

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.godRayPass = new ShaderPass(GodRayShader);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.6, 0.85);
    this.wetLensPass = new ShaderPass(WetLensShader);
    this.wetLensPass.enabled = false;
    this.vignettePass = new ShaderPass(VignetteShader);
    this.vignettePass.uniforms.darkness.value = 0.35;
    this.vignettePass.uniforms.offset.value = 1.1;
    this.outputPass = new OutputPass();
    this.rebuildComposer(false);

    window.addEventListener('resize', this.onResize);
  }

  private rebuildComposer(useGtao: boolean): void {
    this.composer.passes.length = 0;
    this.composer.addPass(this.renderPass);
    if (useGtao) {
      if (!this.gtaoPass) {
        const ds = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        this.gtaoPass = new GTAOPass(this.scene, this.camera, ds.x, ds.y);
        this.gtaoPass.output = GTAOPass.OUTPUT.Default;
      }
      this.gtaoPass.enabled = true;
      this.composer.addPass(this.gtaoPass);
    }
    this.composer.addPass(this.godRayPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.wetLensPass);
    this.composer.addPass(this.vignettePass);
    this.composer.addPass(this.outputPass);
  }

  /** Update the composer / atmosphere uniforms from params (idempotent). */
  applyPostParams(p: Params): void {
    this.postEnabled = p.postProcessing;
    this.renderer.toneMappingExposure = p.exposure;
    this.bloomPass.strength = p.bloom;
    this.bloomPass.enabled = p.bloom > 0.001;
    this.vignettePass.uniforms.darkness.value = p.vignette;
    this.vignettePass.enabled = p.vignette > 0.001;
    this.godRayScale = p.godRays;
    this.godRayPass.enabled = p.godRays > 0.001;
    this.setRenderScale(p.renderScale);
    this.weather.uCloudShadow.value = p.cloudShadows;
    this.haze.visible = this.stormEnabled && p.groundHaze > 0.001;
    (this.haze.material as THREE.ShaderMaterial).uniforms.uHaze.value = p.groundHaze;
    const wantGtao = p.ssao;
    const hasGtao = !!this.gtaoPass && this.composer.passes.includes(this.gtaoPass);
    if (wantGtao !== hasGtao) this.rebuildComposer(wantGtao);
  }

  get sceneColorTexture(): THREE.Texture { return this.sceneRT.texture; }
  get sceneDepthTexture(): THREE.Texture {
    const depth = this.sceneRT.depthTexture;
    if (!depth) throw new Error('sceneRT was created without a depth texture');
    return depth;
  }
  get skyTopColor(): THREE.Color { return this.stormEnabled ? this.stormTop : this.clearTop; }
  get skyHorizonColor(): THREE.Color { return this.stormEnabled ? this.stormHorizon : this.clearHorizon; }
  get sunColorLinear(): THREE.Color {
    // scale glint colour by current sun brightness so it dims in storm
    return this.sunCol.copy(this.sun.color).multiplyScalar(Math.min(1, this.sun.intensity / 2.2));
  }

  get sunDirection(): THREE.Vector3 {
    return this.tmpSun.copy(this.sun.position).sub(this.controls.target).normalize();
  }

  getResolution(out: THREE.Vector2): THREE.Vector2 {
    return this.renderer.getDrawingBufferSize(out);
  }

  /** Above-water overlays to hide while rendering the refraction source (so they
   * aren't baked into the bottom and refracted under the water). */
  setRefractionExcludes(list: THREE.Object3D[]): void {
    this.refractionExcludes = list;
  }

  /** Frame the camera and lighting to a freshly built terrain. */
  fitToTerrain(sizeMeters: number, centerHeight: number): void {
    this.sceneSize = sizeMeters;
    this.sceneCenterH = centerHeight;
    const d = sizeMeters * 0.85;
    this.camera.position.set(d * 0.7, sizeMeters * 0.6 + 300, d * 0.7);
    this.camera.near = Math.max(1, sizeMeters * 0.008);
    this.camera.far = sizeMeters * 6;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, centerHeight, 0);
    this.controls.minDistance = sizeMeters * 0.08;
    this.controls.maxDistance = sizeMeters * 4;
    this.controls.update();

    const target = new THREE.Vector3(0, centerHeight, 0);
    this.sun.position.set(-1, 1.4, -0.8).multiplyScalar(sizeMeters).add(target);
    this.sun.target.position.copy(target);

    this.cloudY = centerHeight + sizeMeters * 0.8 + 300;
    this.cloudDome.uniforms.uCloudBase.value = this.cloudY;
    this.cloudDome.uniforms.uCloudTop.value = this.cloudY + sizeMeters * 1.6;
    // Cloud cells ≈ 2× the map footprint, so a small map still shows whole clouds
    // (a fixed ~5 km cell left a 1 km map sitting under a single gap → empty sky).
    this.cloudDome.uniforms.uShapeScale.value = 1 / (sizeMeters * 2);
    this.haze.position.set(0, centerHeight - sizeMeters * 0.02 + 12, 0);
    this.haze.scale.set(sizeMeters * 8, 1, sizeMeters * 8);
    this.lightningLight.position.set(0.2, 1, 0.1).multiplyScalar(sizeMeters).add(target);
    this.lightningLight.target.position.copy(target);

    this.applyStormState();
  }

  setStorm(enabled: boolean): void {
    this.stormEnabled = enabled;
    this.applyStormState();
  }

  /** 0..1 amount of rain-on-the-lens, driven each frame by the rain state. */
  setWetness(target: number): void {
    this.wetTarget = THREE.MathUtils.clamp(target, 0, 1);
  }

  private applyStormState(): void {
    const on = this.stormEnabled;
    const s = this.sceneSize;
    // The cloud dome renders its own analytic sky, so the gradient background is
    // only used in clear weather; during a storm the dome covers it entirely.
    this.scene.background = on ? null : this.clearSky;
    this.domeBlit.visible = on;
    this.haze.visible = on && (this.haze.material as THREE.ShaderMaterial).uniforms.uHaze.value > 0.001;
    this.hemi.intensity = on ? 0.72 : 1.0;
    this.hemi.color.set(on ? 0x9fb0c4 : 0xcfe3ff);
    this.sun.intensity = on ? 0.7 : 2.2;
    this.scene.fog = on
      ? new THREE.Fog(0x5a6678, s * 1.0, s * 4.2)
      : new THREE.Fog(0xacc7e0, s * 1.4, s * 6);
    if (!on) {
      this.flash = 0;
      this.lightningLight.intensity = 0;
      this.bolt.visible = false;
      this.cloudDome.uniforms.uFlash.value = 0;
    }
  }

  /**
   * Every frame. Camera-dependent uniforms and the storm-presence ease always
   * update (so the view stays correct and toggling storm still works), but cloud
   * DRIFT and lightning only advance when `animate` (Play); on Pause the sky is
   * a still frame.
   */
  updateStorm(dt: number, animate: boolean): void {
    if (animate) this.weather.uTime.value += dt;
    // Recentre the dome on the camera so its world-space slab math (ray origin =
    // camera) stays correct; the look is driven by the eased storm state below.
    this.cloudDome.mesh.position.copy(this.camera.position);
    this.cloudDome.uniforms.uTime.value = this.weather.uTime.value;
    this.cloudDome.uniforms.uCamPos.value.copy(this.camera.position);
    const target = this.stormEnabled ? 1 : 0;
    this.weather.uStorm.value += (target - this.weather.uStorm.value) * Math.min(1, dt * 0.6);
    this.cloudDome.uniforms.uStorm.value = this.weather.uStorm.value;

    // wet-lens droplets ease in/out with the rain; uTime is frozen on pause so
    // they hold still, and the pass is skipped entirely when dry.
    this.wetCurrent += (this.wetTarget - this.wetCurrent) * Math.min(1, dt * 2.5);
    this.wetLensPass.uniforms.uIntensity.value = this.wetCurrent;
    this.wetLensPass.uniforms.uTime.value = this.weather.uTime.value;
    this.wetLensPass.enabled = this.wetCurrent > 0.01;

    // sun screen position + visibility for god rays
    const sunDir = this.tmpSun.copy(this.sun.position).sub(this.controls.target).normalize();
    this.cloudDome.uniforms.uSunDir.value.copy(sunDir);
    this.tmpVec.copy(this.controls.target).addScaledVector(sunDir, this.sceneSize * 4).project(this.camera);
    this.weather.uSunScreen.value.set(this.tmpVec.x * 0.5 + 0.5, this.tmpVec.y * 0.5 + 0.5);
    const onScreen =
      this.tmpVec.z < 1 &&
      Math.abs(this.tmpVec.x) < 1.3 &&
      Math.abs(this.tmpVec.y) < 1.3 &&
      sunDir.y > 0.05;
    this.weather.uSunVisible.value = onScreen ? 1 : 0;

    if (!animate) {
      this.flash = 0;
      this.lightningLight.intensity = 0;
      this.bolt.visible = false;
      this.cloudDome.uniforms.uFlash.value = 0;
      return;
    }
    if (!this.stormEnabled) return;
    this.flash = Math.max(0, this.flash - dt * 7);
    this.flashTimer -= dt;
    if (this.flashTimer <= 0) this.triggerFlash();
    this.boltTime -= dt;
    this.hemi.intensity = 0.72 + this.flash * 2.4;
    this.lightningLight.intensity = this.flash * 2.6;
    this.cloudDome.uniforms.uFlash.value = this.flash * 1.3;
    this.bolt.visible = this.boltTime > 0;
    (this.bolt.material as THREE.LineBasicMaterial).opacity = Math.min(1, this.boltTime * 6);
  }

  private triggerFlash(): void {
    this.flash = 1;
    const doubleStrike = Math.random() < 0.4;
    this.flashTimer = doubleStrike ? 0.11 : 2.5 + Math.random() * 6.5;
    if (Math.random() < 0.75) {
      this.makeBolt();
      this.boltTime = 0.18 + Math.random() * 0.14;
    }
  }

  private makeBolt(): void {
    const s = this.sceneSize;
    const start = new THREE.Vector3((Math.random() - 0.5) * s * 0.5, this.cloudY, (Math.random() - 0.5) * s * 0.5);
    const end = new THREE.Vector3(
      start.x + (Math.random() - 0.5) * s * 0.12, this.sceneCenterH, start.z + (Math.random() - 0.5) * s * 0.12,
    );
    this.boltCount = 0;
    this.genBolt(start, end, 6, s * 0.045);
    this.boltGeo.setDrawRange(0, this.boltCount / 3);
    this.boltGeo.attributes.position.needsUpdate = true;
  }

  /**
   * Recursive midpoint-displacement bolt (procedural-weather skill): each segment
   * splits at a jittered midpoint, with a ~35% chance of forking a dimmer branch.
   * Emits line-segment pairs into boltPositions; bloom turns the bright additive
   * line into a glow, so no separate glow mesh is needed.
   */
  private genBolt(a: THREE.Vector3, b: THREE.Vector3, gen: number, jitter: number): void {
    const buf = this.boltPositions;
    if (gen <= 0 || this.boltCount + 6 > buf.length) {
      buf[this.boltCount++] = a.x; buf[this.boltCount++] = a.y; buf[this.boltCount++] = a.z;
      buf[this.boltCount++] = b.x; buf[this.boltCount++] = b.y; buf[this.boltCount++] = b.z;
      return;
    }
    const t = 0.4 + Math.random() * 0.2;
    const mid = new THREE.Vector3(
      a.x + (b.x - a.x) * t + (Math.random() - 0.5) * jitter,
      a.y + (b.y - a.y) * t,
      a.z + (b.z - a.z) * t + (Math.random() - 0.5) * jitter,
    );
    this.genBolt(a, mid, gen - 1, jitter * 0.6);
    this.genBolt(mid, b, gen - 1, jitter * 0.6);
    if (Math.random() < 0.35 && gen > 2) {
      const be = new THREE.Vector3(
        mid.x + (Math.random() - 0.5) * jitter * 2, mid.y - jitter, mid.z + (Math.random() - 0.5) * jitter * 2,
      );
      this.genBolt(mid, be, gen - 2, jitter * 0.4);
    }
  }

  /** Two-pass render: no-water scene → RT (refraction source), then full scene (+post). */
  render(water?: WaterMesh, sea?: SeaMesh): void {
    this.controls.update();
    // Raymarch the cloud dome once, at half resolution, into its own HDR target.
    if (this.domeBlit.visible) {
      this.renderer.setRenderTarget(this.domeRT);
      this.renderer.render(this.domeScene, this.camera);
      this.renderer.setRenderTarget(null);
    }
    if (water || sea) {
      // The refraction source only needs what's seen DOWN through the water
      // (terrain/seabed); skip the sky blit in this pass.
      const hidden: THREE.Object3D[] = [...this.refractionExcludes, this.domeBlit];
      if (water) hidden.push(water.mesh, water.skirt);
      if (sea) hidden.push(sea.mesh);
      const prev = hidden.map((o) => o.visible);
      for (const o of hidden) o.visible = false;
      this.renderer.setRenderTarget(this.sceneRT);
      this.renderer.render(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
      water?.setSceneTextures(this.sceneRT.texture, this.sceneRT.depthTexture);
      sea?.setSceneTextures(this.sceneRT.texture, this.sceneRT.depthTexture);
      hidden.forEach((o, i) => { o.visible = prev[i]; });
    }
    if (this.godRayPass.enabled) {
      (this.godRayPass.uniforms.uSunScreen.value as THREE.Vector2).copy(this.weather.uSunScreen.value);
      this.godRayPass.uniforms.uIntensity.value =
        this.weather.uSunVisible.value * this.weather.uStorm.value * this.godRayScale;
    }
    if (this.postEnabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Scale the 3D render resolution (backing store) without touching the HTML UI. */
  setRenderScale(scale: number): void {
    const s = THREE.MathUtils.clamp(scale, 0.4, 1);
    if (Math.abs(s - this.renderScale) < 1e-3) return;
    this.renderScale = s;
    this.applyResolution();
  }

  private applyResolution(): void {
    this.renderer.setPixelRatio(this.dprCap * this.renderScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    const ds = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.sceneRT.setSize(ds.x, ds.y);
    this.domeRT.setSize(Math.max(2, Math.ceil(ds.x / 2)), Math.max(2, Math.ceil(ds.y / 2)));
    this.composer.setPixelRatio(this.dprCap * this.renderScale);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.gtaoPass?.setSize(ds.x, ds.y);
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.applyResolution();
  };

  dispose(): void {
    this.composer.dispose();
    this.sceneRT.dispose();
    this.sceneRT.depthTexture?.dispose();
    this.gtaoPass?.dispose?.();
    window.removeEventListener('resize', this.onResize);
  }
}

function makeSkyGradient(stops: [string, string, string]): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, stops[0]);
  grad.addColorStop(0.5, stops[1]);
  grad.addColorStop(1, stops[2]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeHaze(weather: WeatherUniformBlock): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: weather.uTime,
      uStorm: weather.uStorm,
      uCloudDrift: weather.uCloudDrift,
      uHaze: { value: 0.5 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uStorm, uHaze;
      uniform vec2 uCloudDrift;
      varying vec2 vP;
      ${GLSL_FBM}
      void main() {
        // Two drifting, domain-warped fbm layers → rolling volumetric-looking
        // ground-fog wisps (procedural-weather skill) instead of one flat sheet.
        vec2 base = vP * 0.0018;
        vec2 drift = uCloudDrift * uTime;
        float n1 = wFbm(base + drift * 0.4 + wFbm(base * 0.6 + drift * 0.2));
        float n2 = wFbm(base * 2.3 - drift * 0.8);
        float wisp = smoothstep(0.30, 0.74, n1 * 0.68 + n2 * 0.32);
        float edge = 1.0 - smoothstep(0.30, 0.5, length(vP)); // radial fade -> no hard slab edge
        float a = wisp * 0.18 * uStorm * uHaze * edge;
        vec3 col = mix(vec3(0.50, 0.55, 0.62), vec3(0.72, 0.76, 0.82), wisp);
        gl_FragColor = vec4(col, a);
      }
    `,
  });
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.visible = false;
  return mesh;
}

/**
 * Full-screen quad that upscales the half-res linear-HDR cloud target and lets
 * the renderer tonemap it once (toneMapped:true), so the sky matches a full-res
 * dome exactly — only the raymarch resolution drops.
 */
function makeDomeBlit(tex: THREE.Texture): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: tex } },
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: true,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex;
      varying vec2 vUv;
      void main() { gl_FragColor = texture2D(uTex, vUv); }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

/**
 * Wet-lens post pass (procedural-weather skill): rain droplets + running streaks
 * on the "camera lens" with per-drop refraction, faded in with the rain.
 */
const WetLensShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uIntensity: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uIntensity;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec4 sceneColor = texture2D(tDiffuse, uv);
      if (uIntensity < 0.01) { gl_FragColor = sceneColor; return; }
      vec2 grid = floor(uv * 30.0);
      float droplet = 0.0;
      vec2 refractOffset = vec2(0.0);
      for (float dy = -1.0; dy <= 1.0; dy += 1.0) {
        for (float dx = -1.0; dx <= 1.0; dx += 1.0) {
          vec2 cell = grid + vec2(dx, dy);
          float h = hash(cell + floor(uTime * 0.5));
          if (h > 1.0 - uIntensity * 0.4) {
            vec2 dropPos = (cell + 0.5 + (hash(cell * 1.3) - 0.5) * 0.8) / 30.0;
            float dist = length(uv - dropPos);
            float radius = 0.005 + hash(cell * 2.7) * 0.01;
            float drop = smoothstep(radius, radius * 0.3, dist);
            droplet = max(droplet, drop);
            vec2 dir = normalize(uv - dropPos + 1e-5);
            refractOffset += dir * drop * 0.003;
          }
        }
      }
      float streak = hash(vec2(floor(uv.x * 60.0), 0.0));
      if (streak > 0.92 && uIntensity > 0.5) {
        float streakY = fract(uv.y * 3.0 - uTime * 0.2 + streak);
        float streakAlpha = smoothstep(0.0, 0.02, streakY) * smoothstep(0.15, 0.05, streakY);
        refractOffset.y += streakAlpha * 0.005;
        droplet = max(droplet, streakAlpha * 0.5);
      }
      vec4 refracted = texture2D(tDiffuse, uv + refractOffset);
      vec4 result = mix(sceneColor, refracted, droplet);
      result.rgb *= 1.0 - uIntensity * 0.02;
      gl_FragColor = result;
    }
  `,
};
