import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import type { Params } from '../config';
import { GodRayShader } from './godRayShader';

/**
 * The post-processing stack: EffectComposer + passes (GTAO → god rays → bloom →
 * wet-lens → vignette → output), plus the screen-space wet-lens shader. Owns the
 * full-screen composite; the SceneManager renders the scene/refraction/dome and
 * then hands off to render() here.
 */
export class PostFx {
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly godRayPass: ShaderPass;
  private readonly wetLensPass: ShaderPass;
  private readonly vignettePass: ShaderPass;
  private readonly outputPass: OutputPass;
  private gtaoPass?: GTAOPass;
  private postEnabled = true;
  private godRayScale = 0.4;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.renderPass = new RenderPass(scene, camera);
    this.godRayPass = new ShaderPass(GodRayShader);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.6, 0.85);
    this.wetLensPass = new ShaderPass(WetLensShader);
    this.wetLensPass.enabled = false;
    this.vignettePass = new ShaderPass(VignetteShader);
    this.vignettePass.uniforms.darkness.value = 0.35;
    this.vignettePass.uniforms.offset.value = 1.1;
    this.outputPass = new OutputPass();
    this.rebuildComposer(false);
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

  applyParams(p: Params): void {
    this.postEnabled = p.postProcessing;
    this.bloomPass.strength = p.bloom;
    this.bloomPass.enabled = p.bloom > 0.001;
    this.vignettePass.uniforms.darkness.value = p.vignette;
    this.vignettePass.enabled = p.vignette > 0.001;
    this.godRayScale = p.godRays;
    this.godRayPass.enabled = p.godRays > 0.001;
    const wantGtao = p.ssao;
    const hasGtao = !!this.gtaoPass && this.composer.passes.includes(this.gtaoPass);
    if (wantGtao !== hasGtao) this.rebuildComposer(wantGtao);
  }

  /** Push the eased wet-lens intensity + frozen-on-pause time into the pass. */
  setWet(intensity: number, time: number): void {
    this.wetLensPass.uniforms.uIntensity.value = intensity;
    this.wetLensPass.uniforms.uTime.value = time;
    this.wetLensPass.enabled = intensity > 0.01;
  }

  setSize(width: number, height: number, pixelRatio: number, ds: THREE.Vector2): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.gtaoPass?.setSize(ds.x, ds.y);
  }

  /** Composite the scene to screen (or a direct render when post is disabled). */
  render(sunScreen: THREE.Vector2, sunVisible: number, storm: number): void {
    if (this.godRayPass.enabled) {
      (this.godRayPass.uniforms.uSunScreen.value as THREE.Vector2).copy(sunScreen);
      this.godRayPass.uniforms.uIntensity.value = sunVisible * storm * this.godRayScale;
    }
    if (this.postEnabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.composer.dispose();
    this.gtaoPass?.dispose?.();
  }
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
