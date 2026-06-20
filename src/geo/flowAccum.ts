/**
 * D8 flow accumulation on a DEM — the standard hydrology primitive for "how much
 * upstream catchment drains through each cell". Storm sewers and channels carry the
 * most water along the high-accumulation lines (valley bottoms, streets after a
 * street-burn), so this drives the synthetic drainage-capacity field and the sewer
 * routing direction. Flow from each cell goes to the steepest-descent of its 8
 * neighbours; a cell with no lower neighbour is a pit/outlet where flow terminates.
 */

export interface FlowAccum {
  /** Upstream contributing cells draining through each cell (includes the cell itself, ≥ 1). */
  accum: Float32Array;
  /** Index of the D8 downstream neighbour, or -1 for a pit / domain-edge outlet. */
  downstream: Int32Array;
}

const NX = [-1, 0, 1, -1, 1, -1, 0, 1];
const NY = [-1, -1, -1, 0, 0, 1, 1, 1];
// 1/distance for each neighbour (diagonals are √2 apart) — slope = drop · invDist.
const INV = [Math.SQRT1_2, 1, Math.SQRT1_2, 1, 1, Math.SQRT1_2, 1, Math.SQRT1_2];

/** D8 downstream index for cell (x,y), or -1 if no neighbour is strictly lower. */
export function d8Downstream(elev: Float32Array, N: number, x: number, y: number): number {
  const i = y * N + x;
  let best = -1;
  let bestSlope = 0;
  for (let k = 0; k < 8; k++) {
    const nx = x + NX[k];
    const ny = y + NY[k];
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    const slope = (elev[i] - elev[ny * N + nx]) * INV[k];
    if (slope > bestSlope) {
      bestSlope = slope;
      best = ny * N + nx;
    }
  }
  return best;
}

export function flowAccumulation(elev: Float32Array, N: number): FlowAccum {
  const n = N * N;
  const downstream = new Int32Array(n);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) downstream[y * N + x] = d8Downstream(elev, N, x, y);
  }
  // Accumulate in descending-elevation order: a cell's upstream contributors are all
  // higher, so they have already added their totals by the time we reach it.
  const order = new Array<number>(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => elev[b] - elev[a]);
  const accum = new Float32Array(n).fill(1);
  for (let oi = 0; oi < n; oi++) {
    const i = order[oi];
    const d = downstream[i];
    if (d >= 0) accum[d] += accum[i];
  }
  return { accum, downstream };
}
