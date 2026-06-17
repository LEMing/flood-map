/* eslint-disable @typescript-eslint/no-explicit-any */
// EXPERIMENTAL WebGPU spike — NOT wired into the app (see src/bench/webgpuBench.ts).
// three.js TSL's fluent compute-node API is not practically strict-typeable, so
// the compute graph below is built with loose node types; this file is isolated
// behind the benchmark page and never imported by the shipping app.
import { WebGPURenderer } from 'three/webgpu';
import { Fn, instanceIndex, instancedArray, uniform, float, int, vec4 } from 'three/tsl';

/**
 * A WebGPU/TSL compute port of the two-pass virtual-pipes solver, mirroring
 * src/sim/virtualPipes.ts (closed boundary, no sources) so its output can be
 * diffed against the CPU reference and the shipping WebGL2 solver. The point is
 * decision data — measure the real net delta on actual hardware before any
 * WebGPURenderer migration (see the compute-architecture memory). This is a
 * global-memory port; workgroup-shared-memory tiling (where the analysis expects
 * the win) is the next iteration if the baseline numbers justify it.
 */
export interface GpuStepParams {
  dt: number;
  gravity: number;
  pipeArea: number;
  friction: number;
}

type N = any; // a TSL node

export class FloodSimulationGPU {
  readonly N: number;
  readonly cellSize: number;
  private readonly renderer: WebGPURenderer;
  private readonly water: [N, N];
  private cur = 0;
  private readonly fluxOf: [N, N];
  private readonly integrateInto: [N, N];
  private readonly uDt = uniform(0);
  private readonly uCoef = uniform(0); // dt * g * A * (1 - friction) / cellSize
  private readonly uCellSize = uniform(0);

  static async create(
    N: number, sizeMeters: number, heightData: Float32Array, waterData: Float32Array,
  ): Promise<FloodSimulationGPU> {
    const renderer = new WebGPURenderer({ antialias: false });
    await renderer.init();
    return new FloodSimulationGPU(renderer, N, sizeMeters, heightData, waterData);
  }

  private constructor(
    renderer: WebGPURenderer, N: number, sizeMeters: number, heightData: Float32Array, waterData: Float32Array,
  ) {
    this.renderer = renderer;
    this.N = N;
    this.cellSize = sizeMeters / N;
    this.uCellSize.value = this.cellSize;

    const height: N = instancedArray(N * N, 'float');
    seed(height, heightData);
    const wa: N = instancedArray(N * N, 'vec4');
    seed(wa, waterData);
    const wb: N = instancedArray(N * N, 'vec4');
    this.water = [wa, wb];
    const flux: N = instancedArray(N * N, 'vec4');

    const Ni: N = int(N);
    const surfAt = (water: N, idx: N): N => height.element(idx).add(water.element(idx).x);

    // Pass 1: each cell's capped outflux (L,R,T,B) -> flux. Mirrors fluxFragment.
    const makeFlux = (water: N): N => Fn(() => {
      const ii: N = int(instanceIndex);
      const xi: N = ii.mod(Ni);
      const yi: N = ii.div(Ni);
      const b: N = height.element(instanceIndex);
      const d: N = water.element(instanceIndex).x;
      const h: N = b.add(d);
      const c: N = this.uCoef;
      const hasL: N = xi.greaterThan(int(0));
      const hasR: N = xi.lessThan(Ni.sub(1));
      const hasT: N = yi.lessThan(Ni.sub(1));
      const hasB: N = yi.greaterThan(int(0));
      // Clamp the read index to this cell when there is no neighbour (avoids an
      // out-of-bounds read); the select then discards it in favour of `h`.
      const hL: N = hasL.select(surfAt(water, hasL.select(ii.sub(1), ii)), h);
      const hR: N = hasR.select(surfAt(water, hasR.select(ii.add(1), ii)), h);
      const hT: N = hasT.select(surfAt(water, hasT.select(ii.add(Ni), ii)), h);
      const hB: N = hasB.select(surfAt(water, hasB.select(ii.sub(Ni), ii)), h);
      const oL: N = c.mul(h.sub(hL)).max(0);
      const oR: N = c.mul(h.sub(hR)).max(0);
      const oT: N = c.mul(h.sub(hT)).max(0);
      const oB: N = c.mul(h.sub(hB)).max(0);
      const sumO: N = oL.add(oR).add(oT).add(oB);
      const cap: N = d.mul(this.uCellSize).mul(this.uCellSize).div(this.uDt.mul(sumO)).min(1);
      const K: N = sumO.greaterThan(0).select(cap, float(1));
      flux.element(instanceIndex).assign(vec4(oL, oR, oT, oB).mul(K));
    })().compute(N * N);

    // Pass 2: integrate depth from the flux field. Mirrors integrateFragment.
    const makeIntegrate = (water: N, out: N): N => Fn(() => {
      const ii: N = int(instanceIndex);
      const xi: N = ii.mod(Ni);
      const yi: N = ii.div(Ni);
      const dOld: N = water.element(instanceIndex).x;
      const maxDOld: N = water.element(instanceIndex).y;
      const oC: N = flux.element(instanceIndex);
      const outflow: N = oC.x.add(oC.y).add(oC.z).add(oC.w);
      const hasL: N = xi.greaterThan(int(0));
      const hasR: N = xi.lessThan(Ni.sub(1));
      const hasT: N = yi.lessThan(Ni.sub(1));
      const hasB: N = yi.greaterThan(int(0));
      const inL: N = hasL.select(flux.element(hasL.select(ii.sub(1), ii)).y, float(0));
      const inR: N = hasR.select(flux.element(hasR.select(ii.add(1), ii)).x, float(0));
      const inT: N = hasT.select(flux.element(hasT.select(ii.add(Ni), ii)).w, float(0));
      const inB: N = hasB.select(flux.element(hasB.select(ii.sub(Ni), ii)).z, float(0));
      const inflow: N = inL.add(inR).add(inT).add(inB);
      const area: N = this.uCellSize.mul(this.uCellSize);
      const dNew: N = dOld.add(this.uDt.mul(inflow.sub(outflow)).div(area)).max(0);
      const maxD: N = maxDOld.max(dNew);
      const dbar: N = dNew.max(0.02);
      const vx: N = float(0.5).mul(inL.sub(oC.x).add(oC.y.sub(inR))).div(this.uCellSize.mul(dbar));
      const vy: N = float(0.5).mul(inB.sub(oC.w).add(oC.z.sub(inT))).div(this.uCellSize.mul(dbar));
      out.element(instanceIndex).assign(vec4(dNew, maxD, vx, vy));
    })().compute(N * N);

    this.fluxOf = [makeFlux(wa), makeFlux(wb)];
    this.integrateInto = [makeIntegrate(wa, wb), makeIntegrate(wb, wa)];
  }

  setParams(p: GpuStepParams): void {
    const friction = Math.min(0.95, Math.max(0, p.friction));
    this.uDt.value = p.dt;
    this.uCoef.value = (p.dt * p.gravity * p.pipeArea * (1 - friction)) / this.cellSize;
  }

  async step(): Promise<void> {
    await this.renderer.computeAsync(this.fluxOf[this.cur]);
    await this.renderer.computeAsync(this.integrateInto[this.cur]);
    this.cur = 1 - this.cur;
  }

  /** Enqueue one step without a CPU<->GPU sync — for throughput benchmarking.
   * Order is preserved in the GPU queue; await a readback to drain it. */
  stepBatched(): void {
    // compute() submits synchronously once the renderer is initialized (the
    // Promise-returning branch is only the pre-init fallback), so voiding here
    // enqueues both passes without a CPU<->GPU sync; readDepth drains the queue.
    void this.renderer.compute(this.fluxOf[this.cur]);
    void this.renderer.compute(this.integrateInto[this.cur]);
    this.cur = 1 - this.cur;
  }

  /** Read the current depth field (out length N*N) back to the CPU. */
  async readDepth(out: Float32Array): Promise<void> {
    const buf = await this.renderer.getArrayBufferAsync((this.water[this.cur] as N).value);
    const all = new Float32Array(buf);
    for (let i = 0; i < this.N * this.N; i++) out[i] = all[i * 4];
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

/** Seed a storage buffer node's backing typed array with CPU data. */
function seed(node: N, data: Float32Array): void {
  (node.value.array as Float32Array).set(data);
}
