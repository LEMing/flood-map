import { describe, it, expect } from 'vitest';
import { flowAccumulation, d8Downstream } from './flowAccum';

// Build an N×N elevation grid from a function.
function grid(N: number, f: (x: number, y: number) => number): Float32Array {
  const e = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) e[y * N + x] = f(x, y);
  return e;
}

describe('flowAccumulation — planar slope draining east', () => {
  const N = 4;
  const elev = grid(N, (x) => -x); // strictly decreasing eastward
  const { accum, downstream } = flowAccumulation(elev, N);

  it('routes every interior cell to its eastern (downslope) neighbour', () => {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N - 1; x++) expect(downstream[y * N + x]).toBe(y * N + x + 1);
    }
  });

  it('terminates at the eastern outlet of each row (a pit)', () => {
    for (let y = 0; y < N; y++) expect(downstream[y * N + (N - 1)]).toBe(-1);
  });

  it('accumulates the whole upstream column: cell x carries x+1 cells', () => {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) expect(accum[y * N + x]).toBe(x + 1);
    }
  });

  it('total accumulation equals the sum of all flow path lengths', () => {
    let total = 0;
    for (let i = 0; i < accum.length; i++) total += accum[i];
    expect(total).toBe(N * (1 + 2 + 3 + 4)); // 4 rows × triangular(4)
  });
});

describe('flowAccumulation — a central pit', () => {
  const N = 5;
  // A bowl: elevation grows with Chebyshev distance from the centre (2,2).
  const elev = grid(N, (x, y) => Math.max(Math.abs(x - 2), Math.abs(y - 2)));
  const { accum, downstream } = flowAccumulation(elev, N);

  it('drains all cells into the lowest point, which is a pit', () => {
    const centre = 2 * N + 2;
    expect(downstream[centre]).toBe(-1); // nothing lower
    expect(accum[centre]).toBe(N * N); // the whole grid drains through the centre
  });

  it('the pit has the maximum accumulation', () => {
    const centre = 2 * N + 2;
    for (let i = 0; i < accum.length; i++) expect(accum[centre]).toBeGreaterThanOrEqual(accum[i]);
  });
});

describe('d8Downstream', () => {
  it('prefers the steepest descent (cardinal beats a shallower diagonal)', () => {
    const N = 3;
    // Centre (1,1) high; east neighbour drops 1.0 (slope 1.0), NE diagonal drops 1.2
    // (slope 1.2/√2 ≈ 0.85). The steeper cardinal east should win.
    const elev = grid(N, (x, y) => {
      if (x === 1 && y === 1) return 5;
      if (x === 2 && y === 1) return 4; // east: slope 1.0
      if (x === 2 && y === 0) return 3.8; // NE: slope 1.2/√2 ≈ 0.85
      return 10;
    });
    expect(d8Downstream(elev, N, 1, 1)).toBe(1 * N + 2); // east
  });

  it('returns -1 when no neighbour is lower (a local minimum)', () => {
    const N = 3;
    const elev = grid(N, (x, y) => (x === 1 && y === 1 ? 0 : 5));
    expect(d8Downstream(elev, N, 1, 1)).toBe(-1);
  });
});
