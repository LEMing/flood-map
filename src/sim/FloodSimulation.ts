import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import type { Params } from '../config';
import {
  momentumFragment, limiterFragment, depthFragment,
  sewerOutFragment, sewerRouteFragment, sewerApplyFragment,
} from './shaders';

type U = Record<string, THREE.IUniform>;

/** The GPUComputationRenderer primitives we drive manually (some absent from the .d.ts). */
interface GpuApi {
  setDataType?(type: THREE.TextureDataType): void;
  createTexture(): THREE.DataTexture;
  createRenderTarget(
    sizeXTexture: number, sizeYTexture: number,
    wrapS: THREE.Wrapping, wrapT: THREE.Wrapping,
    minFilter: THREE.MinificationTextureFilter, magFilter: THREE.MagnificationTextureFilter,
  ): THREE.WebGLRenderTarget;
  createShaderMaterial(fragmentShader: string, uniforms?: U): THREE.ShaderMaterial;
  doRenderTarget(material: THREE.ShaderMaterial, output: THREE.WebGLRenderTarget): void;
  renderTexture(input: THREE.Texture, output: THREE.WebGLRenderTarget): void;
  dispose(): void;
}

const MM_PER_HR_TO_M_PER_S = 1 / 1000 / 3600;
const H_MIN = 1e-3; // wet/dry flow threshold (m) — faces shallower than this carry no flow
const SEWER_BUFFER_SEC = 1200; // pipe storage horizon: S_max = capacity · this (how long a pipe absorbs a burst)

/**
 * GPU inertial flood simulation: the local-inertial formulation of the 2-D shallow-
 * water equations (Bates et al. 2010; see shaders.ts), carrying real flow momentum.
 * A ping-pong `tQ` texture stores the per-face discharge (the inertia); a ping-pong
 * `tWater` texture stores depth (r), max depth (g) and a diagnostic velocity (b,a).
 * Each substep runs three passes: momentum (update stored discharge), limiter
 * (per-cell drainage cap so depth stays ≥ 0 and mass is conserved), and depth
 * (continuity + rain/infiltration/drainage/evaporation). The physics is pinned by
 * inertialFlow.ts + its tests.
 */
export class FloodSimulation {
  readonly N: number;
  readonly cellSize: number;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly gpu: GpuApi;
  private readonly momentumMat: THREE.ShaderMaterial;
  private readonly limiterMat: THREE.ShaderMaterial;
  private readonly depthMat: THREE.ShaderMaterial;
  private readonly sewerOutMat: THREE.ShaderMaterial;
  private readonly sewerRouteMat: THREE.ShaderMaterial;
  private readonly sewerApplyMat: THREE.ShaderMaterial;
  private readonly waterRT: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly qRT: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly lamRT: THREE.WebGLRenderTarget;
  private readonly sewerRT: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly outRT: THREE.WebGLRenderTarget;
  private readonly zero: THREE.DataTexture;
  private readonly dummySurface: THREE.DataTexture;
  private readonly dummySewer: THREE.DataTexture;
  private readonly u: U;
  private currentIdx = 0;
  private qIdx = 0;
  private sIdx = 0;
  private sewerOn = false;
  private pendingInject = 0;
  private pendingFill = -1e9;
  private pendingFillSet = false;
  private readonly pendingPoint = { depth: 0, x: 0.5, y: 0.5, r: 0.05 };
  private pbo: WebGLBuffer | null = null;
  private fence: WebGLSync | null = null;
  private readbackInFlight = false;

  constructor(
    renderer: THREE.WebGLRenderer,
    heightTexture: THREE.DataTexture,
    N: number,
    sizeMeters: number,
    params: Params,
  ) {
    this.renderer = renderer;
    this.N = N;
    this.cellSize = sizeMeters / N;

    const gpu = new GPUComputationRenderer(N, N, renderer) as unknown as GpuApi;
    this.gpu = gpu;
    gpu.setDataType?.(THREE.FloatType);

    // Fallback 1×1 surface (conductance = 1); real per-cell fields set via setSurface().
    this.dummySurface = new THREE.DataTexture(
      new Float32Array([0, 0, 1, 0]), 1, 1, THREE.RGBAFormat, THREE.FloatType,
    );
    this.dummySurface.needsUpdate = true;

    // Fallback 1×1 sewer fields (capacity 0 → the sewer passes are a no-op).
    this.dummySewer = new THREE.DataTexture(
      new Float32Array([0, 0, 0, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType,
    );
    this.dummySewer.needsUpdate = true;

    // One uniform object per name, shared by reference across the three materials,
    // so updateParams/step mutate a single `u` and every pass sees it.
    this.u = {
      heightmap: { value: heightTexture },
      tWater: { value: null }, // bound to the current water RT each step
      tQ: { value: null }, // bound to the old/new discharge RT per pass
      tQprev: { value: null }, // the OLD discharge RT (its .b = cumulative infiltration F)
      tLam: { value: null }, // bound to the limiter RT before the depth pass
      tSurface: { value: this.dummySurface },
      uUseSurface: { value: 0 },
      uCellSize: { value: this.cellSize },
      uDt: { value: 0 },
      uGravity: { value: params.gravity },
      uRoughness: { value: params.friction },
      uHMin: { value: H_MIN },
      uBoundaryOpen: { value: params.boundary === 'open' ? 1 : 0 },
      uRainRate: { value: 0 },
      uInfilRate: { value: 0 },
      uSorptivity: { value: params.groundwaterHigh ? 0.015 : 0.06 }, // Green-Ampt S = ψ·Δθ (m)
      uEvapRate: { value: 0 },
      uRaining: { value: params.raining ? 1 : 0 },
      uFootprintSpot: { value: params.rainFootprint === 'spot' ? 1 : 0 },
      uSpot: { value: new THREE.Vector2(params.spotX, params.spotY) },
      uSpotRadius: { value: params.spotRadius },
      uInjectDepth: { value: 0 },
      uPointDepth: { value: 0 },
      uPointUv: { value: new THREE.Vector2(0.5, 0.5) },
      uPointRadiusUv: { value: 0.05 },
      uFillLevelAbs: { value: -1e9 },
      uFillSet: { value: 0 },
      tSewer: { value: this.dummySewer }, // static (capacity, D8 dirX, dirY, outfall)
      tSewerState: { value: null }, // bound to the current sewer storage S each step
      tSewerNew: { value: null }, // bound to the routed S before the apply pass
      tOut: { value: null }, // bound to the transient out/inlet RT
      uSewerBuffer: { value: SEWER_BUFFER_SEC },
    };
    const pick = (names: string[]): U => Object.fromEntries(names.map((n) => [n, this.u[n]]));
    const shared = ['heightmap', 'tWater', 'tQ', 'tSurface', 'uUseSurface', 'uCellSize', 'uDt',
      'uGravity', 'uRoughness', 'uHMin', 'uInfilRate', 'uSorptivity', 'uBoundaryOpen'];
    this.momentumMat = gpu.createShaderMaterial(momentumFragment, pick(shared));
    this.limiterMat = gpu.createShaderMaterial(limiterFragment, pick(shared));
    this.depthMat = gpu.createShaderMaterial(depthFragment, pick([
      ...shared, 'tQprev', 'tLam', 'uRainRate', 'uEvapRate', 'uRaining', 'uFootprintSpot',
      'uSpot', 'uSpotRadius', 'uInjectDepth', 'uPointDepth', 'uPointUv', 'uPointRadiusUv',
      'uFillLevelAbs', 'uFillSet',
    ]));
    this.sewerOutMat = gpu.createShaderMaterial(sewerOutFragment,
      pick(['tWater', 'tSewerState', 'tSewer', 'uDt', 'uSewerBuffer']));
    this.sewerRouteMat = gpu.createShaderMaterial(sewerRouteFragment,
      pick(['tOut', 'tSewerState', 'tSewer', 'uSewerBuffer']));
    this.sewerApplyMat = gpu.createShaderMaterial(sewerApplyFragment,
      pick(['tWater', 'tOut', 'tSewerNew']));

    const make = (): THREE.WebGLRenderTarget => gpu.createRenderTarget(
      N, N, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping, THREE.NearestFilter, THREE.NearestFilter,
    );
    this.waterRT = [make(), make()];
    this.qRT = [make(), make()];
    this.lamRT = make();
    this.sewerRT = [make(), make()];
    this.outRT = make();
    this.zero = gpu.createTexture(); // zero-filled (dry water / no discharge)
    this.reset();

    this.updateParams(params);
  }

  updateParams(params: Params): void {
    this.u.uGravity.value = params.gravity;
    this.u.uRoughness.value = params.friction;
    this.u.uBoundaryOpen.value = params.boundary === 'open' ? 1 : 0;
    this.u.uRainRate.value = params.intensityMmPerHr * MM_PER_HR_TO_M_PER_S;
    this.u.uInfilRate.value = params.infiltrationMmPerHr * MM_PER_HR_TO_M_PER_S;
    // Green-Ampt suction-deficit S: soil-derived (Saxton-Rawls, from SoilGrids) once it
    // resolves; until then the groundwater binary (pre-saturated soil has little storage
    // left → small S → infiltration drops to Ks almost at once).
    this.u.uSorptivity.value = params.sorptivityM ?? (params.groundwaterHigh ? 0.015 : 0.06);
    this.u.uEvapRate.value = params.evaporationPerHr * MM_PER_HR_TO_M_PER_S;
    this.u.uRaining.value = params.raining ? 1 : 0;
    this.u.uFootprintSpot.value = params.rainFootprint === 'spot' ? 1 : 0;
    (this.u.uSpot.value as THREE.Vector2).set(params.spotX, params.spotY);
    this.u.uSpotRadius.value = params.spotRadius;
  }

  step(simDt: number): void {
    this.u.uDt.value = simDt;
    this.u.uInjectDepth.value = this.pendingInject; // applied on this single step only
    this.u.uPointDepth.value = this.pendingPoint.depth;
    (this.u.uPointUv.value as THREE.Vector2).set(this.pendingPoint.x, this.pendingPoint.y);
    this.u.uPointRadiusUv.value = this.pendingPoint.r;
    this.u.uFillLevelAbs.value = this.pendingFill;
    this.u.uFillSet.value = this.pendingFillSet ? 1 : 0;

    const water = this.waterRT[this.currentIdx];
    const waterNext = this.waterRT[1 - this.currentIdx];
    const qCur = this.qRT[this.qIdx];
    const qNext = this.qRT[1 - this.qIdx];

    this.u.tWater.value = water.texture; // all three passes read the OLD water surface
    this.u.tQprev.value = qCur.texture; // the OLD discharge (its .b = F at the start of this step)
    this.u.tQ.value = qCur.texture;
    this.gpu.doRenderTarget(this.momentumMat, qNext); // pass 1: discharge + advance F -> qNext
    this.u.tQ.value = qNext.texture;
    this.gpu.doRenderTarget(this.limiterMat, this.lamRT); // pass 2: per-cell drainage cap
    this.u.tLam.value = this.lamRT.texture;
    this.gpu.doRenderTarget(this.depthMat, waterNext); // pass 3: continuity + sources
    this.currentIdx = 1 - this.currentIdx;
    this.qIdx = 1 - this.qIdx;

    this.pendingInject = 0;
    this.pendingPoint.depth = 0;
    this.pendingFill = -1e9;
    this.pendingFillSet = false;
  }

  /**
   * Storm-sewer exchange — run ONCE per frame (not per CFL substep): the sewer
   * dynamics are slow (minutes), so substep resolution is wasted GPU. Inlet from the
   * surface → route one cell downstream → surcharge the excess back to the surface.
   */
  sewerStep(simDt: number): void {
    if (!this.sewerOn) return;
    this.u.uDt.value = simDt;
    const water = this.waterRT[this.currentIdx];
    const waterNext = this.waterRT[1 - this.currentIdx];
    const sNext = this.sewerRT[1 - this.sIdx];
    this.u.tWater.value = water.texture;
    this.u.tSewerState.value = this.sewerRT[this.sIdx].texture;
    this.gpu.doRenderTarget(this.sewerOutMat, this.outRT); // outflow + inlet
    this.u.tOut.value = this.outRT.texture;
    this.gpu.doRenderTarget(this.sewerRouteMat, sNext); // gather downstream → S + surcharge
    this.u.tSewerNew.value = sNext.texture;
    this.gpu.doRenderTarget(this.sewerApplyMat, waterNext); // h -= inlet + surcharge
    this.currentIdx = 1 - this.currentIdx;
    this.sIdx = 1 - this.sIdx;
  }

  /** Dump `depthMeters` of water across the (footprint-shaped) area on the next step. */
  requestInject(depthMeters: number): void {
    this.pendingInject = depthMeters;
  }

  /** Pour a localized cylinder of water at grid-uv (x,y), radius in uv space. */
  requestPointInject(x: number, y: number, depthMeters: number, radiusUv: number): void {
    this.pendingPoint.depth = depthMeters;
    this.pendingPoint.x = x;
    this.pendingPoint.y = y;
    this.pendingPoint.r = radiusUv;
  }

  /**
   * Flood ground below `absoluteElevation` up to that level on the next step.
   * `set` = true sets the water exactly to that level (live slider); otherwise
   * it only raises existing water.
   */
  requestFill(absoluteElevation: number, set = false): void {
    this.pendingFill = absoluteElevation;
    this.pendingFillSet = set;
  }

  /** Per-cell urban surface fields (rgba = infil m/s, drain m/s, conductance 0..1, building flag). */
  setSurface(texture: THREE.Texture | null): void {
    this.u.tSurface.value = texture ?? this.dummySurface;
    this.u.uUseSurface.value = texture ? 1 : 0;
  }

  /** Per-cell storm-sewer fields (rgba = capacity m/s, D8 dirX, dirY, outfall). Null disables routing. */
  setSewer(texture: THREE.Texture | null): void {
    this.u.tSewer.value = texture ?? this.dummySewer;
    this.sewerOn = !!texture;
  }

  /** Drive the rain rate from the storm hyetograph (overrides the constant rate). */
  setRainRateMmPerHr(mmPerHr: number): void {
    this.u.uRainRate.value = mmPerHr * MM_PER_HR_TO_M_PER_S;
  }

  reset(): void {
    this.gpu.renderTexture(this.zero, this.waterRT[0]);
    this.gpu.renderTexture(this.zero, this.waterRT[1]);
    this.gpu.renderTexture(this.zero, this.qRT[0]);
    this.gpu.renderTexture(this.zero, this.qRT[1]);
    this.gpu.renderTexture(this.zero, this.sewerRT[0]);
    this.gpu.renderTexture(this.zero, this.sewerRT[1]);
    this.currentIdx = 0;
    this.qIdx = 0;
    this.sIdx = 0;
  }

  /** rgba = (depth, maxDepth, velX, velY). */
  get waterTexture(): THREE.Texture {
    return this.waterRT[this.currentIdx].texture;
  }

  /** Synchronous read of the water state into `out` (length N*N*4). Stalls the
   * pipeline — used only where the result is needed immediately (precompute). */
  readWater(out: Float32Array): void {
    this.renderer.readRenderTargetPixels(this.waterRT[this.currentIdx], 0, 0, this.N, this.N, out);
  }

  /**
   * Kick off an ASYNC readback into a pixel-pack buffer (no CPU stall). Poll it
   * with {@link pollReadback}. Returns false if one is already in flight or the
   * context isn't WebGL2 (caller should fall back to {@link readWater}).
   */
  requestReadback(): boolean {
    if (this.readbackInFlight) return false;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.fenceSync !== 'function') return false;
    this.renderer.setRenderTarget(this.waterRT[this.currentIdx]);
    if (!this.pbo) {
      this.pbo = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, this.N * this.N * 4 * 4, gl.STREAM_READ);
    } else {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    }
    gl.readPixels(0, 0, this.N, this.N, gl.RGBA, gl.FLOAT, 0); // into the bound PBO
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    this.renderer.setRenderTarget(null);
    gl.flush();
    this.readbackInFlight = !!this.fence;
    return this.readbackInFlight;
  }

  /** If the async readback has completed, copy it into `out` and return true. */
  pollReadback(out: Float32Array): boolean {
    if (!this.readbackInFlight || !this.fence) return false;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const status = gl.clientWaitSync(this.fence, 0, 0);
    if (status === gl.TIMEOUT_EXPIRED || status === gl.WAIT_FAILED) return false;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.deleteSync(this.fence);
    this.fence = null;
    this.readbackInFlight = false;
    return true;
  }

  dispose(): void {
    this.gpu.dispose();
    this.waterRT[0].dispose();
    this.waterRT[1].dispose();
    this.qRT[0].dispose();
    this.qRT[1].dispose();
    this.lamRT.dispose();
    this.sewerRT[0].dispose();
    this.sewerRT[1].dispose();
    this.outRT.dispose();
    this.zero.dispose();
    this.dummySurface.dispose();
    this.dummySewer.dispose();
    this.momentumMat.dispose();
    this.limiterMat.dispose();
    this.depthMat.dispose();
    this.sewerOutMat.dispose();
    this.sewerRouteMat.dispose();
    this.sewerApplyMat.dispose();
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (this.fence) gl.deleteSync(this.fence);
    if (this.pbo) gl.deleteBuffer(this.pbo);
  }
}
