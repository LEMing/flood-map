import { describe, it, expect } from 'vitest';
import {
  type PipeGrid,
  type PipeParams,
  outflux,
  stepSinglePass,
  stepTwoPass,
  computeFlux,
  integrate,
} from './virtualPipes';

function makeGrid(N: number, fill: (x: number, y: number) => { h: number; d: number }): PipeGrid {
  const depth = new Float64Array(N * N);
  const height = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const { h, d } = fill(x, y);
      height[y * N + x] = h;
      depth[y * N + x] = d;
    }
  }
  return { N, depth, height };
}

// Deterministic PRNG so the random-grid tests are reproducible.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomGrid(N: number, seed: number): PipeGrid {
  const rng = mulberry32(seed);
  return makeGrid(N, () => ({ h: rng() * 40, d: rng() * 3 }));
}

const BASE: PipeParams = {
  dt: 0.5,
  gravity: 9.81,
  pipeArea: 1,
  friction: 0.1,
  cellSize: 8,
  boundaryOpen: false,
};

function totalDepth(d: Float64Array): number {
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i];
  return s;
}

describe('virtual-pipes single-pass vs two-pass equivalence', () => {
  it('produces identical depth fields across many seeds (closed boundary)', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const g = randomGrid(16, seed);
      const single = stepSinglePass(g, BASE);
      const two = stepTwoPass(g, BASE);
      for (let i = 0; i < single.length; i++) {
        expect(two[i]).toBeCloseTo(single[i], 12);
      }
    }
  });

  it('stays identical with open boundary and source/sink terms', () => {
    const p: PipeParams = { ...BASE, boundaryOpen: true, rainRate: 1e-4, infilRate: 3e-5, evapRate: 1e-5 };
    const g = randomGrid(24, 42);
    const single = stepSinglePass(g, p);
    const two = stepTwoPass(g, p);
    for (let i = 0; i < single.length; i++) expect(two[i]).toBeCloseTo(single[i], 12);
  });

  it('stays identical with per-cell roughness', () => {
    const g = randomGrid(16, 7);
    g.roughness = new Float64Array(g.N * g.N).map((_, i) => 0.3 + ((i * 31) % 70) / 100);
    const single = stepSinglePass(g, BASE);
    const two = stepTwoPass(g, BASE);
    for (let i = 0; i < single.length; i++) expect(two[i]).toBeCloseTo(single[i], 12);
  });
});

describe('virtual-pipes mass conservation', () => {
  it('conserves total water on a closed boundary with no sources (many steps)', () => {
    let g = randomGrid(20, 11);
    const start = totalDepth(g.depth);
    for (let step = 0; step < 200; step++) {
      g = { ...g, depth: stepTwoPass(g, BASE) };
    }
    expect(totalDepth(g.depth)).toBeCloseTo(start, 6);
  });

  it('only ever loses water on an open boundary (drains toward zero)', () => {
    const pool = (x: number, y: number): { h: number; d: number } =>
      ({ h: 0, d: x > 4 && x < 15 && y > 4 && y < 15 ? 5 : 0 });
    let g = makeGrid(20, pool);
    const start = totalDepth(g.depth);
    const p: PipeParams = { ...BASE, boundaryOpen: true };
    let prev = start;
    for (let step = 0; step < 80; step++) {
      g = { ...g, depth: stepTwoPass(g, p) };
      const now = totalDepth(g.depth);
      expect(now).toBeLessThanOrEqual(prev + 1e-9); // monotonically non-increasing
      prev = now;
    }
    expect(prev).toBeLessThan(start);
  });

  it('never produces negative depth (the per-cell volume cap K)', () => {
    let g = makeGrid(12, (x, y) => ({ h: (x + y) * 2, d: x === 0 && y === 0 ? 50 : 0 }));
    const p: PipeParams = { ...BASE, dt: 5, pipeArea: 10 }; // aggressive flow that would overshoot without K
    for (let step = 0; step < 50; step++) {
      const next = stepTwoPass(g, p);
      for (let i = 0; i < next.length; i++) expect(next[i]).toBeGreaterThanOrEqual(0);
      g = { ...g, depth: next };
    }
  });

  it('adds exactly rainRate*dt of water per cell per step on flat closed ground', () => {
    const g = makeGrid(10, () => ({ h: 0, d: 1 }));
    const p: PipeParams = { ...BASE, rainRate: 2e-3 };
    const next = stepTwoPass(g, p);
    const added = totalDepth(next) - totalDepth(g.depth);
    expect(added).toBeCloseTo(p.rainRate! * p.dt * g.N * g.N, 9);
  });
});

describe('outflux capping', () => {
  it('caps total outflow so it never exceeds the stored volume in one step', () => {
    const g = makeGrid(3, (x, y) => ({ h: 0, d: x === 1 && y === 1 ? 4 : 0 }));
    const p: PipeParams = { ...BASE, dt: 10, pipeArea: 100 };
    const f = outflux(g, p, 1, 1);
    const totalOut = (f[0] + f[1] + f[2] + f[3]) * p.dt; // volume-flux * dt, per unit... in depth*area terms
    const storedVolume = g.depth[1 * 3 + 1] * p.cellSize * p.cellSize;
    expect(totalOut).toBeLessThanOrEqual(storedVolume + 1e-9);
  });

  it('flux pass + integrate compose to the same result as the one-shot two-pass', () => {
    const g = randomGrid(16, 99);
    const composed = integrate(g, BASE, computeFlux(g, BASE));
    const oneShot = stepTwoPass(g, BASE);
    for (let i = 0; i < composed.length; i++) expect(composed[i]).toBe(oneShot[i]);
  });
});
