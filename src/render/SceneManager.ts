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
import type { WaterMesh } from './WaterMesh';
import type { SeaMesh } from './SeaMesh';

const BOLT_SEGMENTS = 14;

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
  private readonly stormSky: THREE.Texture;

  // linear-space sky colours fed to the water reflection shader
  private readonly clearTop = new THREE.Color('#6f9fd0');
  private readonly clearHorizon = new THREE.Color('#d9e6f2');
  private readonly stormTop = new THREE.Color('#1b2230');
  private readonly stormHorizon = new THREE.Color('#5a6470');

  private readonly cloud: THREE.Mesh;
  private readonly cloudMat: THREE.ShaderMaterial;
  private readonly haze: THREE.Mesh;
  private readonly lightningLight: THREE.DirectionalLight;
  private readonly bolt: THREE.LineSegments;
  private readonly boltGeo: THREE.BufferGeometry;
  private readonly boltPositions: Float32Array;

  private stormEnabled = false;
  private flash = 0;
  private flashTimer = 3;
  private boltTime = 0;
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
  private readonly vignettePass: ShaderPass;
  private readonly outputPass: OutputPass;
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
    this.stormSky = makeSkyGradient(['#1b2230', '#39434f', '#5a6470']);
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

    this.cloudMat = makeCloudMaterial();
    const cloudGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.cloud = new THREE.Mesh(cloudGeo, this.cloudMat);
    this.cloud.frustumCulled = false;
    this.cloud.renderOrder = -1;
    this.cloud.visible = false;
    this.scene.add(this.cloud);

    this.haze = makeHaze(this.weather);
    this.scene.add(this.haze);

    this.boltPositions = new Float32Array(BOLT_SEGMENTS * 2 * 3);
    this.boltGeo = new THREE.BufferGeometry();
    this.boltGeo.setAttribute('position', new THREE.BufferAttribute(this.boltPositions, 3));
    this.bolt = new THREE.LineSegments(
      this.boltGeo,
      new THREE.LineBasicMaterial({ color: 0xeaf2ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
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
  get sceneDepthTexture(): THREE.Texture { return this.sceneRT.depthTexture!; }
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
    this.cloud.position.set(0, this.cloudY, 0);
    this.cloud.scale.set(sizeMeters * 12, 1, sizeMeters * 12);
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

  private applyStormState(): void {
    const on = this.stormEnabled;
    const s = this.sceneSize;
    this.scene.background = on ? this.stormSky : this.clearSky;
    this.cloud.visible = on;
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
      this.cloudMat.uniforms.uFlash.value = 0;
    }
  }

  /** Animate clouds, storm ease, sun-screen position and lightning. Every frame. */
  updateStorm(dt: number): void {
    this.weather.uTime.value += dt;
    this.cloudMat.uniforms.uTime.value = this.weather.uTime.value;
    (this.cloudMat.uniforms.uCamPos.value as THREE.Vector3).copy(this.camera.position);
    // fade clouds out as the camera rises toward/above the ceiling so they never
    // block the view from a high or top-down vantage.
    this.cloudMat.uniforms.uCamFade.value = THREE.MathUtils.clamp(
      (this.cloudY - this.camera.position.y) / (this.sceneSize * 0.15), 0, 1,
    );
    const target = this.stormEnabled ? 1 : 0;
    this.weather.uStorm.value += (target - this.weather.uStorm.value) * Math.min(1, dt * 0.6);

    // sun screen position + visibility for god rays
    const sunDir = this.tmpSun.copy(this.sun.position).sub(this.controls.target).normalize();
    this.tmpVec.copy(this.controls.target).addScaledVector(sunDir, this.sceneSize * 4).project(this.camera);
    this.weather.uSunScreen.value.set(this.tmpVec.x * 0.5 + 0.5, this.tmpVec.y * 0.5 + 0.5);
    const onScreen = this.tmpVec.z < 1 && Math.abs(this.tmpVec.x) < 1.3 && Math.abs(this.tmpVec.y) < 1.3 && sunDir.y > 0.05;
    this.weather.uSunVisible.value = onScreen ? 1 : 0;

    if (!this.stormEnabled) return;
    this.flash = Math.max(0, this.flash - dt * 7);
    this.flashTimer -= dt;
    if (this.flashTimer <= 0) this.triggerFlash();
    this.boltTime -= dt;
    this.hemi.intensity = 0.72 + this.flash * 2.4;
    this.lightningLight.intensity = this.flash * 2.6;
    this.cloudMat.uniforms.uFlash.value = this.flash * 1.4;
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
    let x = (Math.random() - 0.5) * s * 0.6;
    let z = (Math.random() - 0.5) * s * 0.6;
    const pts: number[][] = [];
    for (let i = 0; i <= BOLT_SEGMENTS; i++) {
      const t = i / BOLT_SEGMENTS;
      pts.push([x, this.cloudY + (this.sceneCenterH - this.cloudY) * t, z]);
      x += (Math.random() - 0.5) * s * 0.05;
      z += (Math.random() - 0.5) * s * 0.05;
    }
    let o = 0;
    for (let i = 0; i < BOLT_SEGMENTS; i++) {
      for (const p of [pts[i], pts[i + 1]]) {
        this.boltPositions[o++] = p[0];
        this.boltPositions[o++] = p[1];
        this.boltPositions[o++] = p[2];
      }
    }
    this.boltGeo.attributes.position.needsUpdate = true;
  }

  /** Two-pass render: no-water scene → RT (refraction source), then full scene (+post). */
  render(water?: WaterMesh, sea?: SeaMesh): void {
    this.controls.update();
    if (water || sea) {
      const hidden: THREE.Object3D[] = [...this.refractionExcludes];
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
  const ctx = c.getContext('2d')!;
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
        vec2 p = vP * 0.002 + uCloudDrift * uTime * 0.3;
        float n = wFbm(p + wFbm(p * 0.6));
        float edge = 1.0 - smoothstep(0.32, 0.5, length(vP)); // radial fade -> no hard slab edge
        float a = smoothstep(0.3, 0.8, n) * 0.20 * uStorm * uHaze * edge;
        gl_FragColor = vec4(vec3(0.62, 0.67, 0.73), a);
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

function makeCloudMaterial(): THREE.ShaderMaterial {
  // Single horizontal plane (the storm ceiling) seen from below. Instead of flat
  // 2D fbm we reconstruct the view ray per-fragment and raymarch a thin slab of
  // procedural 3D noise hanging beneath the plane, accumulating density with the
  // Beer-Lambert law and a cheap sun light-march for self-shadowing. Techniques:
  //   - iq domain-warped fbm + height-gradient density (iquilezles.org dynclouds / fbm)
  //   - Beer-Lambert transmittance exp(-density*absorption) + front-to-back compositing
  //   - sun light-march (Maxime Heckel cloudscapes) for silver-lining contrast
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uCamFade: { value: 1 },
      uCamPos: { value: new THREE.Vector3() },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vP;
      varying vec3 vWorld;
      void main() {
        vP = position.xz;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uFlash, uCamFade;
      uniform vec3 uCamPos;
      varying vec2 vP;
      varying vec3 vWorld;

      const int MARCH_STEPS = 9;
      const int LIGHT_STEPS = 4;

      float hash(vec3 p){
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float noise(vec3 x){
        vec3 i = floor(x), f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                       mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                       mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p){
        float v = 0.0, a = 0.55;
        for (int i = 0; i < 5; i++){ v += a * noise(p); p = p * 2.02 + 7.3; a *= 0.5; }
        return v;
      }

      // density at a slab-local point. y in [0,1] is depth below the ceiling.
      float cloudDensity(vec3 q){
        vec3 p = q * 3.2 + vec3(uTime * 0.05, 0.0, uTime * 0.02);
        // domain warp for billowy structure (iq)
        vec3 w = vec3(fbm(p * 0.5), fbm(p * 0.5 + 4.1), fbm(p * 0.5 + 9.2));
        float base = fbm(p + 1.4 * w);
        // vertical gradient: dense flat ceiling on top fading to wispy tendrils below
        float profile = smoothstep(0.0, 0.25, q.y) * (1.0 - smoothstep(0.55, 1.0, q.y));
        float d = (base - 0.50) * 2.4 * profile;
        return clamp(d, 0.0, 1.0);
      }

      void main() {
        // reconstruct the world-space view ray and march DOWN into the slab
        // beneath this fragment of the ceiling plane.
        vec3 rd = normalize(vWorld - uCamPos);

        // light comes from above (lightning + sky), tinted by uFlash.
        vec3 sunDir = normalize(vec3(0.25, 1.0, 0.15));

        // horizontal parallax through the slab: convert the view-ray slope into a
        // per-depth uv drift so the volume shifts as the camera looks around.
        vec2 uvBase = vP;
        float downSpeed = max(-rd.y, 0.04);
        vec2 uvSlope = rd.xz / (downSpeed * 6.0) * 0.5;

        vec3 cloudCol = vec3(0.0);
        float transmittance = 1.0;

        // ambient stormy gradient: cold dark base, slightly warmer top
        vec3 baseDark  = vec3(0.045, 0.052, 0.072);
        vec3 baseLight = vec3(0.46, 0.50, 0.58);
        vec3 flashCol  = vec3(0.85, 0.92, 1.0);

        float invSteps = 1.0 / float(MARCH_STEPS);
        // sub-step dither to break up banding (blue-noise-style offset)
        float jitter = (hash(vec3(vP * 91.7, uTime)) - 0.5) * invSteps;
        for (int i = 0; i < MARCH_STEPS; i++){
          float depth01 = (float(i) + 0.5) * invSteps + jitter;
          vec3 q = vec3(uvBase + uvSlope * depth01, depth01);
          float density = cloudDensity(q);
          if (density > 0.001){
            // cheap sun light-march for self-shadowing (Beer-Lambert toward sun)
            float lightAccum = 0.0;
            for (int j = 0; j < LIGHT_STEPS; j++){
              float ls = (float(j) + 1.0) * 0.10;
              vec3 lq = q + vec3(sunDir.xz * ls * 0.4, -sunDir.y * ls);
              lightAccum += cloudDensity(lq);
            }
            float sunT = exp(-lightAccum * 1.7);
            // beer-powder: dark cores, bright edges
            float powder = 1.0 - exp(-density * 4.0);
            float lum = sunT * (0.25 + 0.95 * powder);
            // colour from stormy ambient gradient, brightened toward lit edges + flash
            vec3 ambient = mix(baseDark, baseLight, depth01 * 0.7 + 0.3 * powder);
            vec3 c = ambient + flashCol * (lum * 0.6 + uFlash * (0.4 + powder));
            float stepT = exp(-density * 2.6);
            // front-to-back: accumulate emitted light weighted by remaining transmittance
            cloudCol += transmittance * (1.0 - stepT) * c;
            transmittance *= stepT;
            if (transmittance < 0.02) break;
          }
        }

        float coverage = 1.0 - transmittance;
        // overall flash lift so lightning makes the whole ceiling pop
        cloudCol += flashCol * uFlash * 0.18 * coverage;

        float edge = 1.0 - smoothstep(0.32, 0.5, length(vP)); // radial fade -> no hard slab edge
        float alpha = coverage * 0.97 * edge * uCamFade;
        gl_FragColor = vec4(cloudCol, alpha);
      }
    `,
  });
}
