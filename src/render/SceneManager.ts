import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Params } from '../config';
import { makeCloudDome, type CloudDomeHandle } from './CloudDome';
import { LightningSystem } from './LightningSystem';
import { PostFx } from './PostFx';
import { type WeatherUniformBlock, makeSkyGradient, makeHaze, makeDomeBlit } from './skyMaterials';
import type { WaterMesh } from './WaterMesh';
import type { SeaMesh } from './SeaMesh';

export type { WeatherUniformBlock };

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
  private readonly hazeUHaze: THREE.IUniform<number>;
  private readonly lightning: LightningSystem;

  private stormEnabled = false;
  private sceneSize = 2000;
  private cloudY = 600;

  private contextIsLost = false;
  /** Set by the app: pause on GPU context loss, rebuild the world on restore. */
  onLost?: () => void;
  onRestored?: () => void;

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
  private readonly postFx: PostFx;
  private wetTarget = 0;
  private wetCurrent = 0;
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

    this.lightning = new LightningSystem(this.scene);

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

    const haze = makeHaze(this.weather);
    this.haze = haze.mesh;
    this.hazeUHaze = haze.uHaze;
    this.scene.add(this.haze);

    const ds = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.sceneRT = new THREE.WebGLRenderTarget(ds.x, ds.y, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(ds.x, ds.y, THREE.UnsignedIntType),
    });

    this.postFx = new PostFx(this.renderer, this.scene, this.camera);

    window.addEventListener('resize', this.onResize);
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
  }

  /** True while the GPU context is lost; the app skips stepping + rendering. */
  get contextLost(): boolean {
    return this.contextIsLost;
  }

  private handleContextLost = (e: Event): void => {
    e.preventDefault(); // tell the browser we intend to recover, so it fires 'restored'
    this.contextIsLost = true;
    this.onLost?.();
  };

  private handleContextRestored = (): void => {
    this.contextIsLost = false;
    this.onRestored?.();
  };

  /** Update the post stack / atmosphere uniforms from params (idempotent). */
  applyPostParams(p: Params): void {
    this.renderer.toneMappingExposure = p.exposure;
    this.setRenderScale(p.renderScale);
    this.weather.uCloudShadow.value = p.cloudShadows;
    this.haze.visible = this.stormEnabled && p.groundHaze > 0.001;
    this.hazeUHaze.value = p.groundHaze;
    this.postFx.applyParams(p);
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
    this.lightning.configure(sizeMeters, this.cloudY, centerHeight, target);

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
    this.haze.visible = on && this.hazeUHaze.value > 0.001;
    this.hemi.intensity = on ? 0.72 : 1.0;
    this.hemi.color.set(on ? 0x9fb0c4 : 0xcfe3ff);
    this.sun.intensity = on ? 0.7 : 2.2;
    this.scene.fog = on
      ? new THREE.Fog(0x5a6678, s * 1.0, s * 4.2)
      : new THREE.Fog(0xacc7e0, s * 1.4, s * 6);
    if (!on) {
      this.lightning.reset();
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
    if (Math.abs(target - this.weather.uStorm.value) < 1e-3) this.weather.uStorm.value = target;
    this.cloudDome.uniforms.uStorm.value = this.weather.uStorm.value;

    // wet-lens droplets ease in/out with the rain; uTime is frozen on pause so
    // they hold still, and the pass is skipped entirely when dry.
    this.wetCurrent += (this.wetTarget - this.wetCurrent) * Math.min(1, dt * 2.5);
    if (Math.abs(this.wetTarget - this.wetCurrent) < 1e-3) this.wetCurrent = this.wetTarget;
    this.postFx.setWet(this.wetCurrent, this.weather.uTime.value);

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
      this.lightning.reset();
      this.cloudDome.uniforms.uFlash.value = 0;
      return;
    }
    if (!this.stormEnabled) return;
    const flash = this.lightning.update(dt);
    this.hemi.intensity = 0.72 + flash * 2.4;
    this.cloudDome.uniforms.uFlash.value = flash * 1.3;
  }

  /** Advance OrbitControls (damping). Returns true while the camera is still
   *  moving (input or inertia glide) — drives render-on-demand so the loop keeps
   *  drawing through the damping tail and stops once the camera is at rest. */
  tickControls(): boolean {
    return this.controls.update();
  }

  /** True while a storm/wet-lens ease is still in flight, so the loop keeps
   *  rendering the transition until it settles (then idle stops repainting). */
  isSettling(): boolean {
    const stormTarget = this.stormEnabled ? 1 : 0;
    return (
      Math.abs(stormTarget - this.weather.uStorm.value) > 1e-3 ||
      Math.abs(this.wetTarget - this.wetCurrent) > 1e-3
    );
  }

  /** Two-pass render: no-water scene → RT (refraction source), then full scene (+post). */
  render(water?: WaterMesh, sea?: SeaMesh): void {
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
    this.postFx.render(this.weather.uSunScreen.value, this.weather.uSunVisible.value, this.weather.uStorm.value);
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
    this.postFx.setSize(window.innerWidth, window.innerHeight, this.dprCap * this.renderScale, ds);
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.applyResolution();
  };

  dispose(): void {
    this.postFx.dispose();
    this.sceneRT.dispose();
    this.sceneRT.depthTexture?.dispose();
    window.removeEventListener('resize', this.onResize);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
  }
}
