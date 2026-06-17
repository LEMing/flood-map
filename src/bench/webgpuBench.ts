// WebGPU solver spike benchmark (NOT part of the app — served at /bench.html).
// Runs the two-pass virtual-pipes solver three ways on identical synthetic input
// — CPU reference (virtualPipes), the shipping WebGL2 GPUComputationRenderer
// solver, and the experimental WebGPU/TSL compute solver — then reports per-step
// wall time and the max-abs depth difference between them. The point is decision
// data (is the WebGPU compute path faster AND numerically faithful) before any
// WebGPURenderer migration. See the compute-architecture analysis.
import * as THREE from 'three';
import { DEFAULT_PARAMS, type Params } from '../config';
import { FloodSimulation } from '../sim/FloodSimulation';
import { FloodSimulationGPU } from '../sim/FloodSimulationGPU';
import { type PipeGrid, type PipeParams, stepTwoPass } from '../sim/virtualPipes';

const STEPS = 200;
const SIZE_METERS = 4000;
const PHYS = { dt: 0.5, gravity: 9.81, pipeArea: 1, friction: 0.1 };

interface Scene {
  height: Float32Array; // N*N
  water4: Float32Array; // N*N*4 (depth, maxD, vx, vy)
  depth0: Float64Array; // N*N
}

/** A gentle bowl of terrain with a central Gaussian blob of water. */
function buildScene(N: number): Scene {
  const height = new Float32Array(N * N);
  const depth0 = new Float64Array(N * N);
  const water4 = new Float32Array(N * N * 4);
  const c = (N - 1) / 2;
  const sigma = N * 0.08;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const rx = (x - c) / N;
      const ry = (y - c) / N;
      height[i] = 40 * (rx * rx + ry * ry);
      const r2 = (x - c) * (x - c) + (y - c) * (y - c);
      const d = 5 * Math.exp(-r2 / (2 * sigma * sigma));
      depth0[i] = d;
      water4[i * 4] = d;
      water4[i * 4 + 1] = d;
    }
  }
  return { height, water4, depth0 };
}

function runCPU(N: number, scene: Scene): { depth: Float64Array; ms: number } {
  const p: PipeParams = {
    dt: PHYS.dt, gravity: PHYS.gravity, pipeArea: PHYS.pipeArea, friction: PHYS.friction,
    cellSize: SIZE_METERS / N, boundaryOpen: false,
  };
  let grid: PipeGrid = { N, depth: Float64Array.from(scene.depth0), height: Float64Array.from(scene.height) };
  const t0 = performance.now();
  for (let s = 0; s < STEPS; s++) grid = { ...grid, depth: stepTwoPass(grid, p) };
  return { depth: grid.depth, ms: performance.now() - t0 };
}

function runWebGL2(N: number, scene: Scene): { depth: Float32Array; ms: number } {
  const renderer = new THREE.WebGLRenderer();
  const heightTex = new THREE.DataTexture(scene.height, N, N, THREE.RedFormat, THREE.FloatType);
  heightTex.minFilter = THREE.NearestFilter;
  heightTex.magFilter = THREE.NearestFilter;
  heightTex.needsUpdate = true;
  const params: Params = {
    ...DEFAULT_PARAMS, boundary: 'closed', raining: false,
    intensityMmPerHr: 0, infiltrationMmPerHr: 0, evaporationPerHr: 0,
    gravity: PHYS.gravity, pipeArea: PHYS.pipeArea, friction: PHYS.friction,
  };
  const sim = new FloodSimulation(renderer, heightTex, N, SIZE_METERS, params);
  sim.seedWater(scene.water4);
  const out = new Float32Array(N * N * 4);
  const t0 = performance.now();
  for (let s = 0; s < STEPS; s++) sim.step(PHYS.dt);
  sim.readWater(out); // forces GPU completion
  const ms = performance.now() - t0;
  const depth = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) depth[i] = out[i * 4];
  sim.dispose();
  heightTex.dispose();
  renderer.dispose();
  return { depth, ms };
}

async function runWebGPU(N: number, scene: Scene): Promise<{ depth: Float32Array; ms: number }> {
  const sim = await FloodSimulationGPU.create(N, SIZE_METERS, scene.height, scene.water4);
  sim.setParams(PHYS);
  const depth = new Float32Array(N * N);
  const t0 = performance.now();
  for (let s = 0; s < STEPS; s++) await sim.step();
  await sim.readDepth(depth);
  const ms = performance.now() - t0;
  sim.dispose();
  return { depth, ms };
}

function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function row(label: string, value: string): string {
  return `<tr><td>${label}</td><td>${value}</td></tr>`;
}

async function benchOne(N: number): Promise<string> {
  const scene = buildScene(N);
  const cpu = runCPU(N, scene);
  let html = `<h2>N = ${N} (${N * N} cells), ${STEPS} steps</h2><table>`;
  html += row('CPU reference (f64)', `${cpu.ms.toFixed(1)} ms — ${(cpu.ms / STEPS).toFixed(2)} ms/step`);

  let webgl: { depth: Float32Array; ms: number } | null = null;
  try {
    webgl = runWebGL2(N, scene);
    html += row('WebGL2 (shipping)', `${webgl.ms.toFixed(1)} ms — ${(webgl.ms / STEPS).toFixed(2)} ms/step`);
    html += row('WebGL2 vs CPU parity', `max |Δdepth| = ${maxAbsDiff(webgl.depth, cpu.depth).toExponential(2)} m`);
  } catch (e) {
    html += row('WebGL2', `<span class="err">failed: ${(e as Error).message}</span>`);
  }

  try {
    const gpu = await runWebGPU(N, scene);
    html += row('WebGPU (TSL compute)', `${gpu.ms.toFixed(1)} ms — ${(gpu.ms / STEPS).toFixed(2)} ms/step <em>(incl. per-step sync; conservative)</em>`);
    html += row('WebGPU vs CPU parity', `max |Δdepth| = ${maxAbsDiff(gpu.depth, cpu.depth).toExponential(2)} m`);
    if (webgl) {
      const speedup = webgl.ms / gpu.ms;
      html += row('WebGPU vs WebGL2 speedup', `<b>${speedup.toFixed(2)}×</b>`);
      html += row('WebGPU vs WebGL2 parity', `max |Δdepth| = ${maxAbsDiff(gpu.depth, webgl.depth).toExponential(2)} m`);
    }
  } catch (e) {
    html += row('WebGPU', `<span class="err">failed: ${(e as Error).message}</span>`);
    console.error('[bench] WebGPU solver error', e);
  }

  return `${html}</table>`;
}

export async function runBench(target: HTMLElement): Promise<void> {
  const hasGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
  target.innerHTML = `<p>navigator.gpu: <b>${hasGPU ? 'available' : 'NOT available — WebGPU rows will be skipped'}</b></p><p>Running…</p>`;
  let out = '';
  for (const N of [256, 512]) {
    try {
      out += await benchOne(N);
    } catch (e) {
      out += `<h2>N = ${N}</h2><p class="err">benchmark error: ${(e as Error).message}</p>`;
      console.error(e);
    }
    target.innerHTML = out;
  }
}
