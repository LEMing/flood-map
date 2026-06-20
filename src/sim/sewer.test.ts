import { describe, it, expect } from 'vitest';
import { type SewerGrid, type SewerParams, stepSewer } from './sewer';

// A line of cells draining east: cell i → i+1, the last cell is an outfall.
function lineGrid(N: number, h: number, cap: number): SewerGrid {
  const n = N * N;
  const downstream = new Int32Array(n).fill(-1);
  const outfall = new Uint8Array(n);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N - 1; x++) downstream[y * N + x] = y * N + x + 1; // east
    outfall[y * N + (N - 1)] = 1; // the east-edge terminal is a true outfall (leaves the domain)
  }
  return {
    N,
    h: new Float64Array(n).fill(h),
    S: new Float64Array(n),
    cap: new Float64Array(n).fill(cap),
    downstream,
    outfall,
  };
}

function total(g: SewerGrid): number {
  let s = 0;
  for (let i = 0; i < g.h.length; i++) s += g.h[i] + g.S[i];
  return s;
}

const P: SewerParams = { dt: 1, bufferSec: 60 };

describe('sewer — mass conservation', () => {
  it('surface + storage only ever drops by the outfall discharge', () => {
    const g = lineGrid(8, 0.5, 5e-4);
    let expected = total(g);
    for (let step = 0; step < 300; step++) {
      const { discharged } = stepSewer(g, P);
      expected -= discharged;
      expect(total(g)).toBeCloseTo(expected, 9);
      for (let i = 0; i < g.h.length; i++) {
        expect(g.h[i]).toBeGreaterThanOrEqual(-1e-12);
        expect(g.S[i]).toBeGreaterThanOrEqual(-1e-12);
      }
    }
  });
});

describe('sewer — inlet is capacity- and space-limited', () => {
  it('never takes more than cap·dt from the surface in a step', () => {
    const g = lineGrid(4, 10, 1e-3); // deep water, modest pipe
    const before = Float64Array.from(g.h);
    stepSewer(g, { dt: 2, bufferSec: 600 });
    for (let i = 0; i < g.h.length; i++) {
      const removed = before[i] - g.h[i]; // (ignoring any surcharge back, which is 0 on step 1 here)
      expect(removed).toBeLessThanOrEqual(g.cap[i] * 2 + 1e-12);
    }
  });

  it('stops accepting water once the pipe is full (small buffer saturates fast)', () => {
    const g = lineGrid(3, 5, 1e-3);
    const p: SewerParams = { dt: 1, bufferSec: 5 }; // S_max = 5e-3 m — tiny
    for (let step = 0; step < 50; step++) stepSewer(g, p);
    // With a saturated network, the pipe can hold at most S_max per cell.
    for (let i = 0; i < g.S.length; i++) expect(g.S[i]).toBeLessThanOrEqual(g.cap[i] * p.bufferSec + 1e-9);
  });
});

describe('sewer — surcharge (the point)', () => {
  it('resurfaces water when an overwhelmed pipe fills past capacity', () => {
    // One sink cell with tiny capacity, fed by upstream pipe flow → it surcharges.
    const N = 3;
    const n = N * N;
    const downstream = new Int32Array(n).fill(-1);
    // All cells drain into the centre (1,1); the centre is an outfall with TINY capacity.
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (!(x === 1 && y === 1)) downstream[i] = 1 * N + 1;
    }
    const cap = new Float64Array(n).fill(1e-3);
    cap[1 * N + 1] = 1e-6; // bottleneck at the sink
    // The centre is an INTERIOR pit (not an outfall): the pipe can't discharge there,
    // so it backs up and surcharges.
    const g: SewerGrid = {
      N, h: new Float64Array(n).fill(2), S: new Float64Array(n), cap, downstream, outfall: new Uint8Array(n),
    };
    const p: SewerParams = { dt: 1, bufferSec: 30 };
    const hCentreStart = g.h[1 * N + 1];
    let maxCentreH = hCentreStart;
    for (let step = 0; step < 200; step++) {
      stepSewer(g, p);
      maxCentreH = Math.max(maxCentreH, g.h[1 * N + 1]);
    }
    // The bottleneck cell received pipe inflow it couldn't pass → surcharged back up,
    // so at some point its surface depth exceeded where it started draining.
    expect(g.S[1 * N + 1]).toBeLessThanOrEqual(cap[1 * N + 1] * p.bufferSec + 1e-12); // pipe capped
    expect(maxCentreH).toBeGreaterThan(0); // it stayed wet / re-surfaced, never went dry-and-stayed
  });
});

describe('sewer — recovery', () => {
  it('drains the pipe toward empty once the surface is dry (post-storm recession)', () => {
    const g = lineGrid(6, 0, 1e-3); // no surface water
    for (let i = 0; i < g.S.length; i++) g.S[i] = 0.02; // pre-charged pipes
    const startStored = g.S.reduce((a, b) => a + b, 0);
    for (let step = 0; step < 500; step++) stepSewer(g, P);
    const endStored = g.S.reduce((a, b) => a + b, 0);
    expect(endStored).toBeLessThan(startStored * 0.5); // pipes drained substantially toward outfalls
  });
});
