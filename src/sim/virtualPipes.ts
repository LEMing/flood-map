/**
 * Pure-CPU reference model of the virtual-pipes shallow-water update, in BOTH
 * the legacy single-pass form and the flux/integrate two-pass form. It exists to
 * pin down the physics as a fast, offline, testable spec: the GPU shaders
 * (shaders.ts) mirror this exactly, and virtualPipes.test.ts proves the two-pass
 * reformulation is mass-conservative and numerically identical to the single
 * pass — the regression anchor the GPU path otherwise lacks.
 *
 * Cell layout matches the textures: index = y * N + x, x east, y north. The four
 * outflux components are ordered (L, R, T, B) = (-x, +x, +y, -y), exactly as the
 * GLSL `vec4 outflux` returns (oL, oR, oT, oB).
 */
export interface PipeGrid {
  N: number;
  depth: Float64Array; // water depth per cell (m)
  height: Float64Array; // terrain elevation per cell (m)
  /** Optional per-cell roughness (0..1) scaling outflow; defaults to 1. */
  roughness?: Float64Array;
}

export interface PipeParams {
  dt: number;
  gravity: number;
  pipeArea: number;
  friction: number; // 0..0.95
  cellSize: number; // metres per cell
  boundaryOpen: boolean; // true = water drains off the domain edge
  /** Uniform source/sink terms (m/s), applied in the integrate step. */
  rainRate?: number;
  infilRate?: number;
  evapRate?: number; // fraction per second
  /** Uniform one-shot dump (m) applied on this step only. */
  injectDepth?: number;
}

/** L, R, T, B capped outflow (m of water-column) for one cell, per the GLSL `outflux`. */
export type Flux = [number, number, number, number];

function fluxCoef(p: PipeParams): number {
  const friction = Math.min(0.95, Math.max(0, p.friction));
  return (p.dt * p.gravity * p.pipeArea * (1 - friction)) / p.cellSize;
}

function surfAt(g: PipeGrid, x: number, y: number): number {
  const i = y * g.N + x;
  return g.height[i] + g.depth[i];
}

/**
 * Capped outflow (L, R, T, B) for the cell at (x, y). Mirrors GLSL `outflux`:
 * each direction is max(0, c·(h − hNeighbour)), then scaled by the volume cap K
 * so total outflow·dt never exceeds the cell's stored water (depth stays ≥ 0).
 */
export function outflux(g: PipeGrid, p: PipeParams, x: number, y: number): Flux {
  const N = g.N;
  const i = y * N + x;
  const b = g.height[i];
  const d = g.depth[i];
  const h = b + d;
  const baseCoef = fluxCoef(p);
  const c = g.roughness ? baseCoef * g.roughness[i] : baseCoef;

  const hasL = x > 0;
  const hasR = x < N - 1;
  const hasT = y < N - 1;
  const hasB = y > 0;
  const outside = p.boundaryOpen ? b : h; // open drains, closed = mirror (no flow)
  const hL = hasL ? surfAt(g, x - 1, y) : outside;
  const hR = hasR ? surfAt(g, x + 1, y) : outside;
  const hT = hasT ? surfAt(g, x, y + 1) : outside;
  const hB = hasB ? surfAt(g, x, y - 1) : outside;

  const oL = Math.max(0, c * (h - hL));
  const oR = Math.max(0, c * (h - hR));
  const oT = Math.max(0, c * (h - hT));
  const oB = Math.max(0, c * (h - hB));
  const sumO = oL + oR + oT + oB;
  let K = 1;
  if (sumO > 0) K = Math.min(1, (d * p.cellSize * p.cellSize) / (p.dt * sumO));
  return [oL * K, oR * K, oT * K, oB * K];
}

/** Apply the integrate-step source/sink terms (rain, inject, infiltration, evap) to a depth. */
function applySourcesSinks(dIn: number, p: PipeParams): number {
  let d = dIn;
  if (p.rainRate) d += p.rainRate * p.dt;
  if (p.injectDepth) d += p.injectDepth;
  if (p.infilRate) d -= Math.min(d, p.infilRate * p.dt);
  if (p.evapRate) d *= Math.max(0, Math.min(1, 1 - p.evapRate * p.dt));
  return Math.max(d, 0);
}

/**
 * Legacy single-pass update: every cell computes its own outflux AND recomputes
 * each of its four neighbours' outflux to read back the shared-edge inflow.
 * Returns a new depth array.
 */
export function stepSinglePass(g: PipeGrid, p: PipeParams): Float64Array {
  const N = g.N;
  const area = p.cellSize * p.cellSize;
  const out = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const oC = outflux(g, p, x, y);
      const outflow = oC[0] + oC[1] + oC[2] + oC[3];
      const inL = x > 0 ? outflux(g, p, x - 1, y)[1] : 0; // left's R
      const inR = x < N - 1 ? outflux(g, p, x + 1, y)[0] : 0; // right's L
      const inT = y < N - 1 ? outflux(g, p, x, y + 1)[3] : 0; // top's B
      const inB = y > 0 ? outflux(g, p, x, y - 1)[2] : 0; // bottom's T
      const inflow = inL + inR + inT + inB;
      const dNew = g.depth[i] + (p.dt * (inflow - outflow)) / area;
      out[i] = applySourcesSinks(dNew, p);
    }
  }
  return out;
}

/**
 * Two-pass update. Pass 1 computes every cell's capped outflux once into a flux
 * field; pass 2 reads each cell's own flux plus its four neighbours' opposing
 * components. Inflow across a shared edge is exactly the neighbour's stored
 * capped outflow, so mass is conserved identically to the single pass — with one
 * outflux evaluation per cell instead of five.
 */
export function computeFlux(g: PipeGrid, p: PipeParams): Float64Array {
  const N = g.N;
  const flux = new Float64Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const f = outflux(g, p, x, y);
      const i = (y * N + x) * 4;
      flux[i] = f[0];
      flux[i + 1] = f[1];
      flux[i + 2] = f[2];
      flux[i + 3] = f[3];
    }
  }
  return flux;
}

export function integrate(g: PipeGrid, p: PipeParams, flux: Float64Array): Float64Array {
  const N = g.N;
  const area = p.cellSize * p.cellSize;
  const out = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const f = i * 4;
      const outflow = flux[f] + flux[f + 1] + flux[f + 2] + flux[f + 3];
      const inL = x > 0 ? flux[(i - 1) * 4 + 1] : 0; // left cell's R
      const inR = x < N - 1 ? flux[(i + 1) * 4] : 0; // right cell's L
      const inT = y < N - 1 ? flux[(i + N) * 4 + 3] : 0; // top cell's B
      const inB = y > 0 ? flux[(i - N) * 4 + 2] : 0; // bottom cell's T
      const inflow = inL + inR + inT + inB;
      const dNew = g.depth[i] + (p.dt * (inflow - outflow)) / area;
      out[i] = applySourcesSinks(dNew, p);
    }
  }
  return out;
}

export function stepTwoPass(g: PipeGrid, p: PipeParams): Float64Array {
  return integrate(g, p, computeFlux(g, p));
}
