/* eslint-disable @typescript-eslint/no-explicit-any */
// EXPERIMENTAL WebGPU spike — NOT wired into the app (see src/bench/webgpuBench.ts).
// three.js TSL's fluent compute-node API is not practically strict-typeable, so
// the compute graph below is built with loose node types; this file is isolated
// behind the benchmark page and never imported by the shipping app.
import { WebGPURenderer } from 'three/webgpu';
import {
  Fn, instanceIndex, instancedArray, uniform, float, int, vec4, If,
  invocationLocalIndex, workgroupId, workgroupArray, workgroupBarrier,
} from 'three/tsl';

/**
 * A WebGPU/TSL compute port of the two-pass virtual-pipes solver, mirroring
 * src/sim/virtualPipes.ts (closed boundary, no sources) so its output can be
 * diffed against the CPU reference and the shipping WebGL2 solver. Two variants:
 *   - 'global': straight global-memory port (1 thread per cell).
 *   - 'tiled':  16x16 workgroup tiles that cache the (18x18) surf/flux halo in
 *     workgroup shared memory, so each cell reads its neighbours from on-chip
 *     memory instead of global — the optimization the architecture analysis
 *     predicted the win from, especially at large N. TSL's compute dispatch is
 *     1D, so the 2D tile is mapped manually from a 1D workgroup of 256.
 * Measured on real hardware via the benchmark; this is decision data only.
 */
export interface GpuStepParams {
  dt: number;
  gravity: number;
  pipeArea: number;
  friction: number;
}
export type GpuVariant = 'global' | 'tiled';

type N = any; // a TSL node

const TILE = 16; // workgroup covers a TILE x TILE block
const PAD = TILE + 2; // + 1-cell halo each side
const WG = TILE * TILE; // 256 threads / workgroup
const OUTSIDE = 1e9; // surf sentinel for out-of-grid halo (closed boundary -> 0 flux)

export class FloodSimulationGPU {
  readonly N: number;
  readonly cellSize: number;
  readonly variant: GpuVariant;
  private readonly renderer: WebGPURenderer;
  private readonly water: [N, N];
  private cur = 0;
  private readonly fluxOf: [N, N];
  private readonly integrateInto: [N, N];
  private readonly uDt = uniform(0);
  private readonly uCoef = uniform(0); // dt * g * A * (1 - friction) / cellSize
  private readonly uCellSize = uniform(0);

  static async create(
    N: number, sizeMeters: number, heightData: Float32Array, waterData: Float32Array, variant: GpuVariant = 'global',
  ): Promise<FloodSimulationGPU> {
    if (variant === 'tiled' && N % TILE !== 0) throw new Error(`tiled solver needs N divisible by ${TILE}`);
    const renderer = new WebGPURenderer({ antialias: false });
    await renderer.init();
    return new FloodSimulationGPU(renderer, N, sizeMeters, heightData, waterData, variant);
  }

  private constructor(
    renderer: WebGPURenderer, N: number, sizeMeters: number,
    heightData: Float32Array, waterData: Float32Array, variant: GpuVariant,
  ) {
    this.renderer = renderer;
    this.N = N;
    this.variant = variant;
    this.cellSize = sizeMeters / N;
    this.uCellSize.value = this.cellSize;

    const height: N = instancedArray(N * N, 'float');
    seed(height, heightData);
    const wa: N = instancedArray(N * N, 'vec4');
    seed(wa, waterData);
    const wb: N = instancedArray(N * N, 'vec4');
    this.water = [wa, wb];
    const flux: N = instancedArray(N * N, 'vec4');

    const make = variant === 'tiled'
      ? this.tiledKernels(height, flux)
      : this.globalKernels(height, flux);
    this.fluxOf = [make.flux(wa), make.flux(wb)];
    this.integrateInto = [make.integrate(wa, wb), make.integrate(wb, wa)];
  }

  // ---- global-memory variant (1 thread/cell, neighbours read from global) ----
  private globalKernels(height: N, flux: N): { flux: (w: N) => N; integrate: (w: N, o: N) => N } {
    const Ni: N = int(this.N);
    const surfAt = (water: N, idx: N): N => height.element(idx).add(water.element(idx).x);
    const makeFlux = (water: N): N => Fn(() => {
      const ii: N = int(instanceIndex);
      const xi: N = ii.mod(Ni);
      const yi: N = ii.div(Ni);
      const d: N = water.element(instanceIndex).x;
      const h: N = height.element(instanceIndex).add(d);
      const c: N = this.uCoef;
      const hasL: N = xi.greaterThan(int(0));
      const hasR: N = xi.lessThan(Ni.sub(1));
      const hasT: N = yi.lessThan(Ni.sub(1));
      const hasB: N = yi.greaterThan(int(0));
      const hL: N = hasL.select(surfAt(water, hasL.select(ii.sub(1), ii)), h);
      const hR: N = hasR.select(surfAt(water, hasR.select(ii.add(1), ii)), h);
      const hT: N = hasT.select(surfAt(water, hasT.select(ii.add(Ni), ii)), h);
      const hB: N = hasB.select(surfAt(water, hasB.select(ii.sub(Ni), ii)), h);
      flux.element(instanceIndex).assign(cappedFlux(h, hL, hR, hT, hB, c, d, this.uCellSize, this.uDt));
    })().compute(this.N * this.N);
    const makeIntegrate = (water: N, out: N): N => Fn(() => {
      const ii: N = int(instanceIndex);
      const xi: N = ii.mod(Ni);
      const yi: N = ii.div(Ni);
      const hasL: N = xi.greaterThan(int(0));
      const hasR: N = xi.lessThan(Ni.sub(1));
      const hasT: N = yi.lessThan(Ni.sub(1));
      const hasB: N = yi.greaterThan(int(0));
      const oC: N = flux.element(instanceIndex);
      const inL: N = hasL.select(flux.element(hasL.select(ii.sub(1), ii)).y, float(0));
      const inR: N = hasR.select(flux.element(hasR.select(ii.add(1), ii)).x, float(0));
      const inT: N = hasT.select(flux.element(hasT.select(ii.add(Ni), ii)).w, float(0));
      const inB: N = hasB.select(flux.element(hasB.select(ii.sub(Ni), ii)).z, float(0));
      out.element(instanceIndex).assign(integrated(water.element(instanceIndex), oC, inL, inR, inT, inB, this.uCellSize, this.uDt));
    })().compute(this.N * this.N);
    return { flux: makeFlux, integrate: makeIntegrate };
  }

  // ---- tiled variant: 16x16 workgroup, (18x18) halo cached in shared memory ----
  private tiledKernels(height: N, flux: N): { flux: (w: N) => N; integrate: (w: N, o: N) => N } {
    const Ni: N = int(this.N);
    const tilesX: N = int(this.N / TILE);
    // local (lx,ly) within the 16x16 tile, and the tile's global origin (ox,oy).
    const tileCoords = (): { li: N; lx: N; ly: N; ox: N; oy: N } => {
      const li: N = int(invocationLocalIndex);
      const w: N = int(workgroupId.x);
      const tx: N = w.mod(tilesX);
      const ty: N = w.div(tilesX);
      return { li, lx: li.mod(int(TILE)), ly: li.div(int(TILE)), ox: tx.mul(int(TILE)), oy: ty.mul(int(TILE)) };
    };

    const makeFlux = (water: N): N => Fn(() => {
      const share: N = workgroupArray('float', PAD * PAD); // surf (= height + depth) for the padded tile
      const { li, lx, ly, ox, oy } = tileCoords();
      // Cooperative halo load: PAD*PAD=324 cells across WG=256 threads (each loads 1; first 68 load a 2nd).
      const loadSurf = (k: N): void => {
        const sx: N = k.mod(int(PAD));
        const sy: N = k.div(int(PAD));
        const gx: N = ox.add(sx).sub(1);
        const gy: N = oy.add(sy).sub(1);
        const inB: N = gx.greaterThanEqual(int(0)).and(gx.lessThan(Ni)).and(gy.greaterThanEqual(int(0))).and(gy.lessThan(Ni));
        const gIdx: N = inB.select(gy.mul(Ni).add(gx), int(0));
        const s: N = height.element(gIdx).add(water.element(gIdx).x);
        share.element(k).assign(inB.select(s, float(OUTSIDE)));
      };
      loadSurf(li);
      If(li.lessThan(int(PAD * PAD - WG)), () => { loadSurf(li.add(int(WG))); });
      workgroupBarrier();

      const g: N = oy.add(ly).mul(Ni).add(ox.add(lx)); // this cell's global index
      const d: N = water.element(g).x; // own depth from global (cheap, 1/thread)
      const si: N = ly.add(1).mul(int(PAD)).add(lx.add(1)); // centre in shared (shifted +1)
      const h: N = share.element(si);
      flux.element(g).assign(cappedFlux(
        h, share.element(si.sub(1)), share.element(si.add(1)),
        share.element(si.add(int(PAD))), share.element(si.sub(int(PAD))),
        this.uCoef, d, this.uCellSize, this.uDt,
      ));
    })().compute(this.N * this.N, [WG]);

    const makeIntegrate = (water: N, out: N): N => Fn(() => {
      const share: N = workgroupArray('vec4', PAD * PAD); // flux for the padded tile
      const { li, lx, ly, ox, oy } = tileCoords();
      const loadFlux = (k: N): void => {
        const sx: N = k.mod(int(PAD));
        const sy: N = k.div(int(PAD));
        const gx: N = ox.add(sx).sub(1);
        const gy: N = oy.add(sy).sub(1);
        const inB: N = gx.greaterThanEqual(int(0)).and(gx.lessThan(Ni)).and(gy.greaterThanEqual(int(0))).and(gy.lessThan(Ni));
        const gIdx: N = inB.select(gy.mul(Ni).add(gx), int(0));
        share.element(k).assign(inB.select(flux.element(gIdx), vec4(0, 0, 0, 0)));
      };
      loadFlux(li);
      If(li.lessThan(int(PAD * PAD - WG)), () => { loadFlux(li.add(int(WG))); });
      workgroupBarrier();

      const g: N = oy.add(ly).mul(Ni).add(ox.add(lx));
      const si: N = ly.add(1).mul(int(PAD)).add(lx.add(1));
      const oC: N = share.element(si);
      const inL: N = share.element(si.sub(1)).y;
      const inR: N = share.element(si.add(1)).x;
      const inT: N = share.element(si.add(int(PAD))).w;
      const inB: N = share.element(si.sub(int(PAD))).z;
      out.element(g).assign(integrated(water.element(g), oC, inL, inR, inT, inB, this.uCellSize, this.uDt));
    })().compute(this.N * this.N, [WG]);

    return { flux: makeFlux, integrate: makeIntegrate };
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
   * compute() submits synchronously once initialized; readDepth drains the queue. */
  stepBatched(): void {
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

/** Capped outflux vec4(L,R,T,B) from a cell's surf h and its 4 neighbour surfs. */
function cappedFlux(h: N, hL: N, hR: N, hT: N, hB: N, c: N, d: N, cell: N, dt: N): N {
  const oL: N = c.mul(h.sub(hL)).max(0);
  const oR: N = c.mul(h.sub(hR)).max(0);
  const oT: N = c.mul(h.sub(hT)).max(0);
  const oB: N = c.mul(h.sub(hB)).max(0);
  const sumO: N = oL.add(oR).add(oT).add(oB);
  const cap: N = d.mul(cell).mul(cell).div(dt.mul(sumO)).min(1);
  const K: N = sumO.greaterThan(0).select(cap, float(1));
  return vec4(oL, oR, oT, oB).mul(K);
}

/** Integrate one cell: vec4(depth, maxD, vx, vy) from its own + neighbour flux. */
function integrated(cellWater: N, oC: N, inL: N, inR: N, inT: N, inB: N, cell: N, dt: N): N {
  const dOld: N = cellWater.x;
  const maxDOld: N = cellWater.y;
  const outflow: N = oC.x.add(oC.y).add(oC.z).add(oC.w);
  const inflow: N = inL.add(inR).add(inT).add(inB);
  const area: N = cell.mul(cell);
  const dNew: N = dOld.add(dt.mul(inflow.sub(outflow)).div(area)).max(0);
  const maxD: N = maxDOld.max(dNew);
  const dbar: N = dNew.max(0.02);
  const vx: N = float(0.5).mul(inL.sub(oC.x).add(oC.y.sub(inR))).div(cell.mul(dbar));
  const vy: N = float(0.5).mul(inB.sub(oC.w).add(oC.z.sub(inT))).div(cell.mul(dbar));
  return vec4(dNew, maxD, vx, vy);
}

/** Seed a storage buffer node's backing typed array with CPU data. */
function seed(node: N, data: Float32Array): void {
  node.value.array.set(data);
  node.value.needsUpdate = true;
}
