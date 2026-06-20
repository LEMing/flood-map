/**
 * Synthetic storm-sewer routing + surcharge — the pure, testable CPU spec the GPU
 * shaders mirror. Each cell has a sewer storage `S` (m depth-equivalent) and a pipe
 * capacity `cap` (m/s, from the flow-accumulation field in surface.ts). Per step:
 *
 *  1. INLET   — surface water enters the pipe, limited by the pipe capacity AND the
 *               remaining pipe space (S_max = cap·bufferSec).
 *  2. ROUTE   — pipe flow moves ONE cell downstream along the precomputed D8
 *               direction, capacity-limited. At an outfall (downstream = −1) it
 *               leaves the domain (discharged).
 *  3. SURCHARGE — a pipe that fills past S_max backs up: the excess pops back to the
 *               surface, exactly where the network is overwhelmed (the bottlenecks /
 *               low points). That is the dominant urban-pluvial flooding mechanism.
 *
 * Mass: surface depth + sewer storage is conserved except for the outfall discharge
 * (water that left the domain through the network). This is a SYNTHETIC heuristic
 * network, not digitized pipes — see the README/MethodNote caveat.
 */

export interface SewerGrid {
  N: number;
  h: Float64Array; // surface water depth (m) — updated in place
  S: Float64Array; // sewer storage (m depth-equivalent) — updated in place
  cap: Float64Array; // per-cell pipe capacity / inlet rate (m/s)
  downstream: Int32Array; // D8 downstream cell index, or -1 for an outfall
}

export interface SewerParams {
  dt: number;
  bufferSec: number; // pipe storage horizon: S_max = cap · bufferSec
}

/** Advance the sewer one step in place; returns the volume-equivalent discharged at outfalls. */
export function stepSewer(g: SewerGrid, p: SewerParams): { discharged: number } {
  const n = g.N * g.N;
  const inlet = new Float64Array(n);
  const out = new Float64Array(n);
  const inflow = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const sMax = g.cap[i] * p.bufferSec;
    inlet[i] = Math.min(Math.max(0, g.h[i]), g.cap[i] * p.dt, Math.max(0, sMax - g.S[i]));
    out[i] = Math.min(g.S[i] + inlet[i], g.cap[i] * p.dt); // pipe throughput this step
  }
  // Route each cell's outflow one step downstream (scatter); outfalls discharge out.
  let discharged = 0;
  for (let i = 0; i < n; i++) {
    const d = g.downstream[i];
    if (d >= 0) inflow[d] += out[i];
    else discharged += out[i];
  }
  for (let i = 0; i < n; i++) {
    const sMax = g.cap[i] * p.bufferSec;
    let sNew = g.S[i] + inlet[i] - out[i] + inflow[i];
    const surcharge = Math.max(0, sNew - sMax); // pipe full → the excess resurfaces
    sNew -= surcharge;
    g.S[i] = sNew;
    g.h[i] = g.h[i] - inlet[i] + surcharge;
  }
  return { discharged };
}
