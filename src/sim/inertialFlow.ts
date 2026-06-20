/**
 * Pure-CPU reference for the INERTIAL flood solver — the inertial ("local
 * acceleration") formulation of the 2-D shallow-water equations from Bates,
 * Horritt & Fewtrell (2010), which the GPU shaders mirror. Unlike the old
 * non-inertial virtual-pipes scheme it STORES a per-face discharge between steps
 * (the momentum/inertia term ∂q/∂t), so a flood wave can accelerate, overshoot and
 * reverse — it is a true (if still simplified) shallow-water solver, not a
 * diffusive-wave approximation.
 *
 * Staggered (Arakawa-C / MAC) grid: cell-centred terrain z and depth h; face-
 * centred discharge per unit width qx (EAST face) and qy (NORTH face), index =
 * y*N + x. The west face of (x,y) is qx[(x-1,y)]; the south face is qy[(x,y-1)].
 * Sign convention: +qx = eastward (+x), +qy = northward (+y). qx[i] is the flux
 * leaving cell i to the east and entering cell i+1 from the west — one shared value
 * per interior face, so interior mass is conserved exactly.
 *
 * This file is the testable spec (inertialFlow.test.ts pins mass conservation, the
 * well-balanced lake-at-rest property, stability and the emergence of inertia); the
 * GPU path in shaders.ts/FloodSimulation.ts is a line-for-line mirror.
 */

export interface InertialGrid {
  N: number;
  z: Float64Array; // terrain elevation (m), index y*N + x
  h: Float64Array; // water depth (m)
  qx: Float64Array; // discharge/width across the EAST face (m²/s), + = +x
  qy: Float64Array; // discharge/width across the NORTH face (m²/s), + = +y
  /** Optional per-cell Manning's n; falls back to params.manning. */
  manningN?: Float64Array;
}

export interface InertialParams {
  dt: number;
  gravity: number;
  cellSize: number; // Δx (m)
  manning: number; // uniform Manning's n used where grid.manningN is absent
  boundaryOpen: boolean; // true = water drains off the domain edge
  hMin?: number; // wet/dry flow threshold (m); faces shallower than this carry no flow
  depressionM?: number; // depression storage (m): held in micro-hollows, doesn't run off
  /** Uniform source/sink terms (m/s), applied in the continuity step. */
  rainRate?: number;
  infilRate?: number;
  evapRate?: number; // constant depth flux (m/s)
  /** Uniform one-shot dump (m) applied on this step only. */
  injectDepth?: number;
}

const HMIN_DEFAULT = 1e-3;

function eta(g: InertialGrid, i: number): number {
  return g.z[i] + g.h[i];
}

function nAt(g: InertialGrid, p: InertialParams, i: number): number {
  return g.manningN ? g.manningN[i] : p.manning;
}

/** Surface + bed elevations on the −/+ side of a face (A = −x/−y cell, B = +x/+y cell). */
export interface FaceGeom { etaA: number; etaB: number; zA: number; zB: number; }

/**
 * One face's inertial discharge update (Bates et al. 2010, eq. for q^{t+Δt}): the
 * stored discharge `qOld` (inertia) is forced by the water-surface slope and damped
 * by the semi-implicit Manning friction term. The returned flux is + toward B (the
 * +x / +y neighbour). hFlow is the depth available to flow across the face (Cunge):
 * max(surfaces) − max(beds).
 */
export function faceFlux(qOld: number, f: FaceGeom, n: number, p: InertialParams): number {
  // Depression storage holds the first `depressionM` of water in sub-grid hollows: subtract
  // it from the Cunge flow depth so shallow sheet flow can't run off (it stays in h).
  const hFlow = Math.max(f.etaA, f.etaB) - Math.max(f.zA, f.zB) - (p.depressionM ?? 0);
  const hMin = p.hMin ?? HMIN_DEFAULT;
  if (hFlow <= hMin) return 0; // dry face / below depression storage → no flow, drop momentum
  const slope = (f.etaB - f.etaA) / p.cellSize; // +slope (B higher) ⇒ flux toward A (negative)
  const num = qOld - p.gravity * hFlow * p.dt * slope;
  const den = 1 + (p.gravity * p.dt * n * n * Math.abs(qOld)) / Math.pow(hFlow, 7 / 3);
  return num / den;
}

/**
 * Discharge across a domain-edge face (open = free outfall to dry terrain, closed =
 * wall). `sign` is +1 for an east/north edge (outflow is +q) and −1 for a west/south
 * edge (outflow is −q). The result is clamped to the outflow direction so an open
 * boundary can only ever DRAIN, never let water flow back in (one-way free outfall).
 */
function boundaryFlux(g: InertialGrid, p: InertialParams, i: number, qOld: number, sign: number): number {
  if (!p.boundaryOpen) return 0; // closed: no flux through the wall
  if (g.h[i] <= (p.hMin ?? HMIN_DEFAULT)) return 0;
  // Outside is dry terrain at the cell's own bed z[i]; orient the in/out sides by sign.
  const inside = eta(g, i);
  const geom: FaceGeom = sign < 0
    ? { etaA: g.z[i], etaB: inside, zA: g.z[i], zB: g.z[i] }
    : { etaA: inside, etaB: g.z[i], zA: g.z[i], zB: g.z[i] };
  const f = faceFlux(qOld, geom, nAt(g, p, i), p);
  return sign > 0 ? Math.max(0, f) : Math.min(0, f);
}

/** Pass A: update every face's stored discharge from the current water surface. */
export function momentumStep(g: InertialGrid, p: InertialParams): { qx: Float64Array; qy: Float64Array } {
  const N = g.N;
  const qx = new Float64Array(N * N);
  const qy = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (x < N - 1) {
        const r = i + 1;
        const n = 0.5 * (nAt(g, p, i) + nAt(g, p, r));
        qx[i] = faceFlux(g.qx[i], { etaA: eta(g, i), etaB: eta(g, r), zA: g.z[i], zB: g.z[r] }, n, p);
      } else {
        qx[i] = boundaryFlux(g, p, i, g.qx[i], 1); // east domain edge
      }
      if (y < N - 1) {
        const u = i + N;
        const n = 0.5 * (nAt(g, p, i) + nAt(g, p, u));
        qy[i] = faceFlux(g.qy[i], { etaA: eta(g, i), etaB: eta(g, u), zA: g.z[i], zB: g.z[u] }, n, p);
      } else {
        qy[i] = boundaryFlux(g, p, i, g.qy[i], 1); // north domain edge
      }
    }
  }
  return { qx, qy };
}

/** Apply the uniform continuity source/sink terms (rain, inject, infiltration, evap). */
function applySourcesSinks(dIn: number, p: InertialParams): number {
  let d = dIn;
  if (p.rainRate) d += p.rainRate * p.dt;
  if (p.injectDepth) d += p.injectDepth;
  if (p.infilRate) d -= Math.min(d, p.infilRate * p.dt);
  if (p.evapRate) d -= Math.min(d, p.evapRate * p.dt);
  return Math.max(d, 0);
}

/**
 * Per-cell drainage limiter λ ∈ (0,1] — the inertial analogue of the old virtual-
 * pipes K cap. λ[i] scales every face draining cell i so that, in one step, the
 * cell cannot lose more water than it holds. A shared face is scaled by its DONOR's
 * λ (the cell it drains), so the same value enters both adjacent cells' continuity
 * and mass stays conserved while depth stays ≥ 0 without a mass-creating clamp.
 */
function drainageLimiter(g: InertialGrid, p: InertialParams, qx: Float64Array, qy: Float64Array): Float64Array {
  const N = g.N;
  const lam = new Float64Array(N * N).fill(1);
  const k = p.dt / p.cellSize;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const qW = x > 0 ? qx[i - 1] : boundaryFlux(g, p, i, 0, -1);
      const qS = y > 0 ? qy[i - N] : boundaryFlux(g, p, i, 0, -1);
      const drain = k * (Math.max(0, qx[i]) + Math.max(0, -qW) + Math.max(0, qy[i]) + Math.max(0, -qS));
      // Only the water above the depression reserve may leave in one step — so a steep face
      // can't drain a cell below its micro-hollow storage.
      const avail = Math.max(0, g.h[i] - (p.depressionM ?? 0));
      if (drain > avail) lam[i] = avail / drain;
    }
  }
  return lam;
}

/**
 * Pass B: advance depth by continuity ∂h/∂t = −(∂qx/∂x + ∂qy/∂y) using the updated,
 * drainage-limited face discharges, then apply the source/sink terms. The west/south
 * faces of the domain edge are non-stored boundary faces (computed memoryless).
 */
export function continuityStep(g: InertialGrid, p: InertialParams, qx: Float64Array, qy: Float64Array): Float64Array {
  const N = g.N;
  const lam = drainageLimiter(g, p, qx, qy);
  // A face's discharge scaled by its donor cell's limiter (the cell it drains).
  const east = (i: number, x: number): number => qx[i] * lam[qx[i] > 0 ? i : (x < N - 1 ? i + 1 : i)];
  const north = (i: number, y: number): number => qy[i] * lam[qy[i] > 0 ? i : (y < N - 1 ? i + N : i)];
  const out = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const qE = east(i, x);
      const qN = north(i, y);
      const qW = x > 0 ? east(i - 1, x - 1) : boundaryFlux(g, p, i, 0, -1) * lam[i];
      const qS = y > 0 ? north(i - N, y - 1) : boundaryFlux(g, p, i, 0, -1) * lam[i];
      const net = (qE - qW) + (qN - qS); // net outflow per unit width
      const dNew = g.h[i] - (p.dt * net) / p.cellSize;
      out[i] = applySourcesSinks(dNew, p);
    }
  }
  return out;
}

/** Advance the grid one step in place: update stored discharges, then depths. */
export function step(g: InertialGrid, p: InertialParams): void {
  const { qx, qy } = momentumStep(g, p);
  const h = continuityStep(g, p, qx, qy);
  g.qx.set(qx);
  g.qy.set(qy);
  g.h.set(h);
}

/** CFL-stable substep length for the inertial scheme: Δt ≤ α·Δx/√(g·h_max), α≈0.7. */
export function inertialCflDt(cellSize: number, gravity: number, maxDepth: number, alpha = 0.7): number {
  return (alpha * cellSize) / Math.sqrt(gravity * Math.max(maxDepth, 1e-3));
}
