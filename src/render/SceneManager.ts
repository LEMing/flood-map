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
  render(water?: WaterMesh): void {
    this.controls.update();
    if (water) {
      const hidden = [water.mesh, water.skirt, ...this.refractionExcludes];
      const prev = hidden.map((o) => o.visible);
      for (const o of hidden) o.visible = false;
      this.renderer.setRenderTarget(this.sceneRT);
      this.renderer.render(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
      water.setSceneTextures(this.sceneRT.texture, this.sceneRT.depthTexture);
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

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    const ds = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.sceneRT.setSize(ds.x, ds.y);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.gtaoPass?.setSize(ds.x, ds.y); // resize even when not in the chain
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
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFlash: { value: 0 }, uCamFade: { value: 1 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uFlash, uCamFade;
      varying vec2 vP;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
                   mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
      }
      float fbm(vec2 p){
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
        return v;
      }
      void main() {
        vec2 p = vP * 6.0 + vec2(uTime * 0.03, uTime * 0.015);
        float n = fbm(p + fbm(p * 0.5));
        float density = smoothstep(0.35, 0.85, n);
        vec3 dark = vec3(0.10, 0.11, 0.14);
        vec3 mid = vec3(0.34, 0.36, 0.42);
        vec3 col = mix(dark, mid, n);
        col += uFlash * vec3(0.85, 0.9, 1.0) * (0.4 + density);
        float edge = 1.0 - smoothstep(0.32, 0.5, length(vP)); // radial fade -> no hard slab edge
        gl_FragColor = vec4(col, density * 0.95 * edge * uCamFade);
      }
    `,
  });
}
