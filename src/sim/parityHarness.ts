// GPU↔CPU parity harness. The analytical battery (analyticalValidation.test.ts) verifies
// the Float64 CPU reference (inertialFlow.ts); this harness checks that the GLSL shaders
// actually SHIPPED on the GPU still reproduce that reference, so "the shaders mirror the
// CPU spec line-for-line" is a measured result, not a comment. It needs a real WebGL2
// context (float render targets), so it runs in a browser, not the Node unit suite — load
// it via the dev server and call runParity() (see README "Verification").
import * as THREE from 'three';
import { FloodSimulation } from './FloodSimulation';
import { type InertialGrid, type InertialParams, step as cpuStep, inertialCflDt } from './inertialFlow';
import { DEFAULT_PARAMS, type Params } from '../config';

export interface ParityOptions {
  N?: number;
  steps?: number;
  seed?: number;
  tol?: number;
  reliefM?: number; // terrain relief; low → no cell near the wet/dry switch
  dtSafety?: number; // fraction of the depth CFL (stays inside the velocity-aware bound)
  injectM?: number; // uniform dump depth (m)
  debug?: boolean; // also return the raw depth grids
}

export interface ParityResult {
  N: number;
  steps: number;
  dt: number;
  injectDepth: number;
  maxAbsDiff: number; // worst per-cell |h_gpu − h_cpu| (m)
  meanAbsDiff: number;
  maxRelDiff: number; // worst relative diff among cells with appreciable depth
  massRelDiff: number; // |Σh_gpu − Σh_cpu| / Σh_cpu
  pass: boolean;
  gpuH?: number[];
  cpuH?: number[];
}

interface ParityConfig {
  N: number; steps: number; tol: number; reliefM: number; dtSafety: number;
  injectM: number; seed: number; debug: boolean;
  sizeMeters: number; cellSize: number; gravity: number; friction: number;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resolveConfig(opts?: ParityOptions): ParityConfig {
  // tol 1 cm (clean-regime drift is ~1.5 mm); gentle relief + deep dump keeps cells off hMin.
  const base = { N: 48, steps: 120, tol: 0.01, reliefM: 0.5, dtSafety: 0.1, injectM: 3, seed: 1234, debug: false };
  const m = { ...base, ...(opts ?? {}) };
  return { ...m, sizeMeters: m.N * 10, cellSize: 10, gravity: 9.81, friction: 0.03 }; // 10 m cells
}

/** Deterministic bumpy bed: z (Float64, for the CPU) and the GPU height texture (z in .x). */
function makeBed(cfg: ParityConfig): { z: Float64Array; heightTex: THREE.DataTexture } {
  const { N } = cfg;
  const rng = mulberry32(cfg.seed);
  const z = new Float64Array(N * N);
  const data = new Float32Array(N * N * 4);
  for (let i = 0; i < N * N; i++) { const v = rng() * cfg.reliefM; z[i] = v; data[i * 4] = v; }
  const heightTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.FloatType);
  heightTex.magFilter = THREE.NearestFilter;
  heightTex.minFilter = THREE.NearestFilter;
  heightTex.needsUpdate = true;
  return { z, heightTex };
}

/** Run the real GPU shaders: dump once, relax, read back the depth channel. */
function runGpu(cfg: ParityConfig, heightTex: THREE.DataTexture, dt: number, injectDepth: number): Float32Array {
  const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false });
  const params: Params = {
    ...DEFAULT_PARAMS,
    gravity: cfg.gravity, friction: cfg.friction, boundary: 'closed', raining: false,
    rainFootprint: 'uniform', intensityMmPerHr: 0, infiltrationMmPerHr: 0, evaporationPerHr: 0,
  };
  const sim = new FloodSimulation(renderer, heightTex, cfg.N, cfg.sizeMeters, params); // sewer/surface stay off
  sim.requestInject(injectDepth); // consumed by the first step()
  for (let s = 0; s < cfg.steps; s++) sim.step(dt);
  const gpu = new Float32Array(cfg.N * cfg.N * 4);
  sim.readWater(gpu);
  sim.dispose();
  renderer.dispose();
  return gpu;
}

/** The Float64 CPU reference on the identical scenario. */
function runCpuRef(cfg: ParityConfig, z: Float64Array, dt: number, injectDepth: number): Float64Array {
  const N = cfg.N;
  const cg: InertialGrid = {
    N, z: Float64Array.from(z), h: new Float64Array(N * N),
    qx: new Float64Array(N * N), qy: new Float64Array(N * N),
  };
  const cp: InertialParams = {
    dt, gravity: cfg.gravity, cellSize: cfg.cellSize, manning: cfg.friction, boundaryOpen: false, hMin: 1e-3,
  };
  for (let s = 0; s < cfg.steps; s++) cpuStep(cg, s === 0 ? { ...cp, injectDepth } : cp);
  return cg.h;
}

function compareDepth(gpu: Float32Array, cpuH: Float64Array, N: number): {
  maxAbs: number; meanAbs: number; maxRel: number; massRel: number;
} {
  let maxAbs = 0, sumAbs = 0, maxRel = 0, gpuSum = 0, cpuSum = 0;
  for (let i = 0; i < N * N; i++) {
    const a = gpu[i * 4], b = cpuH[i];
    const d = Math.abs(a - b);
    maxAbs = Math.max(maxAbs, d); sumAbs += d; gpuSum += a; cpuSum += b;
    if (b > 0.1) maxRel = Math.max(maxRel, d / b);
  }
  return { maxAbs, meanAbs: sumAbs / (N * N), maxRel, massRel: Math.abs(gpuSum - cpuSum) / cpuSum };
}

/**
 * Run the GPU solver and the CPU reference on an identical scenario — a closed bed with one
 * uniform-depth dump relaxing under gravity + Manning friction (no rain / losses / sewer /
 * surface, so it is the pure inertial core both implement) — and compare depth.
 *
 * The default scenario keeps every cell well above the wet/dry threshold (gentle relief,
 * deep dump): there the two agree to float32-vs-float64 rounding (~1.5 mm over 120 steps),
 * which is the clean parity claim. Push reliefM up / injectM down and cells start crossing
 * `hMin`, a DISCONTINUOUS per-face on/off switch where float32 and float64 flip at slightly
 * different moments — so the depth pattern diverges there (while total mass stays identical
 * to ~1e-9). That divergence is inherent to a float wet/dry scheme, not a shader-vs-CPU
 * mismatch: at 2 steps, flat bed, or deep water the two match to rounding.
 */
export function runParity(opts?: ParityOptions): ParityResult {
  const cfg = resolveConfig(opts);
  const { z, heightTex } = makeBed(cfg);
  const injectDepth = cfg.injectM;
  const dt = cfg.dtSafety * inertialCflDt(cfg.cellSize, cfg.gravity, injectDepth + cfg.reliefM);
  const gpu = runGpu(cfg, heightTex, dt, injectDepth);
  const cpuH = runCpuRef(cfg, z, dt, injectDepth);
  const c = compareDepth(gpu, cpuH, cfg.N);
  return {
    N: cfg.N, steps: cfg.steps, dt, injectDepth,
    maxAbsDiff: c.maxAbs, meanAbsDiff: c.meanAbs, maxRelDiff: c.maxRel, massRelDiff: c.massRel,
    pass: c.maxAbs < cfg.tol,
    gpuH: cfg.debug ? Array.from({ length: cfg.N * cfg.N }, (_, i) => gpu[i * 4]) : undefined,
    cpuH: cfg.debug ? Array.from(cpuH) : undefined,
  };
}
