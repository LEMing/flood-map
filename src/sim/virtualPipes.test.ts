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

describe('Manning friction', () => {
  const sum = (f: number[]): number => f[0] + f[1] + f[2] + f[3];
  const FRIC: PipeParams = { ...BASE, friction: 1 }; // land-cover Manning n at full scale

  // A rough centre cell (low conductance -> high Manning n) draining to dry neighbours.
  function roughPeak(): PipeGrid {
    const g = makeGrid(3, (x, y) => ({ h: 0, d: x === 1 && y === 1 ? 4 : 0 }));
    g.roughness = new Float64Array(9).fill(0.1); // conductance 0.1 -> n ≈ 0.23
    return g;
  }

  it('damps flux as the flow speed rises (and not at all at rest)', () => {
    const g = roughPeak();
    const atRest = outflux(g, FRIC, 1, 1);
    g.speed = new Float64Array(9).fill(10);
    const moving = outflux(g, FRIC, 1, 1);
    expect(sum(moving)).toBeLessThan(sum(atRest)); // friction only acts on moving water
    expect(sum(moving)).toBeGreaterThan(0);
  });

  it('damps more on rougher ground (lower conductance) at the same speed', () => {
    const rough = roughPeak();
    rough.speed = new Float64Array(9).fill(10);
    const smooth = makeGrid(3, (x, y) => ({ h: 0, d: x === 1 && y === 1 ? 4 : 0 }));
    smooth.roughness = new Float64Array(9).fill(1); // conductance 1 -> n ≈ 0.015 (paved)
    smooth.speed = new Float64Array(9).fill(10);
    // Compare the friction factor alone (strip the linear conductance term out).
    const roughFlux = sum(outflux(rough, FRIC, 1, 1)) / 0.1;
    const smoothFlux = sum(outflux(smooth, FRIC, 1, 1)) / 1.0;
    expect(roughFlux).toBeLessThan(smoothFlux);
  });

  it('still conserves mass on a closed boundary with friction + speed (many steps)', () => {
    let g = randomGrid(16, 5);
    g.roughness = new Float64Array(256).map((_, i) => 0.2 + (i % 5) / 10);
    g.speed = new Float64Array(256).fill(1.5);
    const start = totalDepth(g.depth);
    for (let step = 0; step < 120; step++) g = { ...g, depth: stepTwoPass(g, FRIC) };
    expect(totalDepth(g.depth)).toBeCloseTo(start, 6);
  });

  it('two-pass stays identical to single-pass with per-cell speed', () => {
    const g = randomGrid(16, 17);
    g.roughness = new Float64Array(256).map((_, i) => 0.15 + ((i * 7) % 80) / 100);
    g.speed = new Float64Array(256).map((_, i) => ((i * 13) % 50) / 10);
    const single = stepSinglePass(g, FRIC);
    const two = stepTwoPass(g, FRIC);
    for (let i = 0; i < single.length; i++) expect(two[i]).toBeCloseTo(single[i], 12);
  });
});

describe('evaporation (constant depth flux)', () => {
  it('removes the same absolute depth from shallow and deep cells (not a fraction)', () => {
    // Two depths sharing one water surface (h = b + d = 2 everywhere) so no flux moves
    // between them — isolating the evaporation term.
    const g = makeGrid(2, (x) => (x === 0 ? { h: 1.9, d: 0.1 } : { h: 0, d: 2 }));
    const p: PipeParams = { ...BASE, evapRate: 1e-3 };
    const next = stepTwoPass(g, p);
    const shallowLoss = 0.1 - next[0];
    const deepLoss = 2 - next[1];
    const expected = p.evapRate! * p.dt;
    expect(shallowLoss).toBeCloseTo(expected, 9);
    expect(deepLoss).toBeCloseTo(expected, 9);
    expect(shallowLoss).toBeCloseTo(deepLoss, 9); // depth-independent: a flux, not a fraction
  });

  it('never evaporates below zero (caps at the available depth)', () => {
    const g = makeGrid(2, () => ({ h: 0, d: 1e-4 }));
    const p: PipeParams = { ...BASE, evapRate: 1, dt: 1 }; // 1 m/s * 1 s ≫ 1e-4 m present
    const next = stepTwoPass(g, p);
    for (let i = 0; i < next.length; i++) expect(next[i]).toBe(0);
  });
});
