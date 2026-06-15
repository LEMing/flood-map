import * as THREE from 'three';
import {
  GPUComputationRenderer,
  type Variable,
} from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import type { Params } from '../config';
import { waterFragment } from './shaders';

type U = Record<string, THREE.IUniform>;

const MM_PER_HR_TO_M_PER_S = 1 / 1000 / 3600;

/**
 * GPU shallow-water flood simulation. A single ping-pong variable `tWater`
 * stores depth (r), max depth (g) and velocity (b,a); see shaders.ts for the
 * conservative virtual-pipes update.
 */
export class FloodSimulation {
  readonly N: number;
  readonly cellSize: number;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly gpu: GPUComputationRenderer;
  private readonly water: Variable;
  private readonly water0: THREE.DataTexture;
  private readonly dummySurface: THREE.DataTexture;
  private readonly u: U;
  private pendingInject = 0;
  private pendingFill = -1e9;
  private pendingFillSet = false;
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

    this.gpu = new GPUComputationRenderer(N, N, renderer);
    const maybeSetType = (this.gpu as unknown as {
      setDataType?: (t: THREE.TextureDataType) => void;
    }).setDataType;
    if (maybeSetType) maybeSetType.call(this.gpu, THREE.FloatType);

    this.water0 = this.gpu.createTexture();
    this.water = this.gpu.addVariable('tWater', waterFragment, this.water0);
    this.gpu.setVariableDependencies(this.water, [this.water]);

    // Fallback 1×1 surface (roughness = 1); real per-cell fields set via setSurface().
    this.dummySurface = new THREE.DataTexture(
      new Float32Array([0, 0, 1, 0]), 1, 1, THREE.RGBAFormat, THREE.FloatType,
    );
    this.dummySurface.needsUpdate = true;

    this.u = {
      heightmap: { value: heightTexture },
      uCellSize: { value: this.cellSize },
      uDt: { value: 0 },
      uGravity: { value: params.gravity },
      uPipeArea: { value: params.pipeArea },
      uFriction: { value: params.friction },
      uBoundaryOpen: { value: params.boundary === 'open' ? 1 : 0 },
      uRainRate: { value: 0 },
      uInfilRate: { value: 0 },
      uEvapRate: { value: 0 },
      uRaining: { value: params.raining ? 1 : 0 },
      uFootprintSpot: { value: params.rainFootprint === 'spot' ? 1 : 0 },
      uSpot: { value: new THREE.Vector2(params.spotX, params.spotY) },
      uSpotRadius: { value: params.spotRadius },
      uInjectDepth: { value: 0 },
      uFillLevelAbs: { value: -1e9 },
      uFillSet: { value: 0 },
      tSurface: { value: this.dummySurface },
      uUseSurface: { value: 0 },
    };
    Object.assign(this.water.material.uniforms, this.u);

    const error = this.gpu.init();
    if (error !== null) {
      throw new Error(`GPU simulation init failed: ${error}`);
    }
    this.updateParams(params);
  }

  updateParams(params: Params): void {
    this.u.uGravity.value = params.gravity;
    this.u.uPipeArea.value = params.pipeArea;
    this.u.uFriction.value = params.friction;
    this.u.uBoundaryOpen.value = params.boundary === 'open' ? 1 : 0;
    this.u.uRainRate.value = params.intensityMmPerHr * MM_PER_HR_TO_M_PER_S;
    this.u.uInfilRate.value = params.infiltrationMmPerHr * MM_PER_HR_TO_M_PER_S;
    this.u.uEvapRate.value = params.evaporationPerHr / 3600;
    this.u.uRaining.value = params.raining ? 1 : 0;
    this.u.uFootprintSpot.value = params.rainFootprint === 'spot' ? 1 : 0;
    (this.u.uSpot.value as THREE.Vector2).set(params.spotX, params.spotY);
    this.u.uSpotRadius.value = params.spotRadius;
  }

  step(simDt: number): void {
    this.u.uDt.value = simDt;
    this.u.uInjectDepth.value = this.pendingInject; // applied on this single step only
    this.u.uFillLevelAbs.value = this.pendingFill;
    this.u.uFillSet.value = this.pendingFillSet ? 1 : 0;
    this.gpu.compute();
    this.pendingInject = 0;
    this.pendingFill = -1e9;
    this.pendingFillSet = false;
  }

  /** Dump `depthMeters` of water across the (footprint-shaped) area on the next step. */
  requestInject(depthMeters: number): void {
    this.pendingInject = depthMeters;
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

  /** Per-cell urban surface fields (rgba = infil m/s, drain m/s, roughness 0..1). */
  setSurface(texture: THREE.Texture | null): void {
    this.u.tSurface.value = texture ?? this.dummySurface;
    this.u.uUseSurface.value = texture ? 1 : 0;
  }

  /** Drive the rain rate from the storm hyetograph (overrides the constant rate). */
  setRainRateMmPerHr(mmPerHr: number): void {
    this.u.uRainRate.value = mmPerHr * MM_PER_HR_TO_M_PER_S;
  }

  reset(): void {
    this.gpu.renderTexture(this.water0, this.water.renderTargets[0]);
    this.gpu.renderTexture(this.water0, this.water.renderTargets[1]);
  }

  /** rgba = (depth, maxDepth, velX, velY). */
  get waterTexture(): THREE.Texture {
    return this.gpu.getCurrentRenderTarget(this.water).texture;
  }

  /** Synchronous read of the water state into `out` (length N*N*4). Stalls the
   * pipeline — used only where the result is needed immediately (precompute). */
  readWater(out: Float32Array): void {
    this.renderer.readRenderTargetPixels(
      this.gpu.getCurrentRenderTarget(this.water),
      0, 0, this.N, this.N, out,
    );
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
    this.renderer.setRenderTarget(this.gpu.getCurrentRenderTarget(this.water));
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
    this.water0.dispose();
    this.dummySurface.dispose();
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (this.fence) gl.deleteSync(this.fence);
    if (this.pbo) gl.deleteBuffer(this.pbo);
  }
}
