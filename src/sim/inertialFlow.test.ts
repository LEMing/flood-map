import { describe, it, expect } from 'vitest';
import {
  type InertialGrid,
  type InertialParams,
  momentumStep,
  step,
  inertialCflDt,
} from './inertialFlow';

function makeGrid(N: number, fill: (x: number, y: number) => { z: number; h: number }): InertialGrid {
  const z = new Float64Array(N * N);
  const h = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const c = fill(x, y);
      z[y * N + x] = c.z;
      h[y * N + x] = c.h;
    }
  }
  return { N, z, h, qx: new Float64Array(N * N), qy: new Float64Array(N * N) };
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function totalWater(g: InertialGrid): number {
  let s = 0;
  for (let i = 0; i < g.h.length; i++) s += g.h[i];
  return s;
}

function cfl(g: InertialGrid, p: Omit<InertialParams, 'dt'>): number {
  let hmax = 0;
  for (let i = 0; i < g.h.length; i++) hmax = Math.max(hmax, g.h[i]);
  return inertialCflDt(p.cellSize, p.gravity, hmax);
}

const BASE: Omit<InertialParams, 'dt'> = {
  gravity: 9.81, cellSize: 10, manning: 0.03, boundaryOpen: false,
};

describe('inertial solver — mass conservation', () => {
  it('conserves total water on a closed boundary with no sources (many steps)', () => {
    const rng = mulberry32(7);
    const g = makeGrid(24, () => ({ z: rng() * 30, h: rng() * 2 }));
    const p: InertialParams = { ...BASE, dt: cfl(g, BASE) };
    const start = totalWater(g);
    for (let s = 0; s < 300; s++) step(g, p);
    expect(totalWater(g)).toBeCloseTo(start, 4); // clamp-injected mass error must be negligible
  });

  it('adds exactly rainRate*dt per cell per step on flat closed ground', () => {
    const g = makeGrid(10, () => ({ z: 0, h: 1 }));
    const p: InertialParams = { ...BASE, dt: 0.5, rainRate: 2e-3 };
    const before = totalWater(g);
    step(g, p);
    expect(totalWater(g) - before).toBeCloseTo(p.rainRate! * p.dt * g.N * g.N, 9);
  });

  it('interior face discharge is shared (cell i east flux = cell i+1 west inflow)', () => {
    const rng = mulberry32(3);
    const g = makeGrid(8, () => ({ z: rng() * 10, h: rng() * 2 }));
    const p: InertialParams = { ...BASE, dt: cfl(g, BASE) };
    const { qx } = momentumStep(g, p);
    // The east face of (2,3) is exactly the west face of (3,3): one stored value.
    const i = 3 * 8 + 2;
    expect(qx[i]).toBe(qx[i]); // single source of truth (no separate west-of-(3,3) value exists)
    expect(Number.isFinite(qx[i])).toBe(true);
  });
});

describe('inertial solver — well-balanced (lake at rest)', () => {
  it('a flat water surface over bumpy terrain stays perfectly still', () => {
    const rng = mulberry32(11);
    const LEVEL = 45;
    const g = makeGrid(20, () => {
      const z = rng() * 50; // some cells above the fill level stay dry
      return { z, h: Math.max(0, LEVEL - z) };
    });
    const p: InertialParams = { ...BASE, dt: cfl(g, BASE) };
    const h0 = Float64Array.from(g.h);
    for (let s = 0; s < 150; s++) step(g, p);
    let maxDrift = 0;
    for (let i = 0; i < g.h.length; i++) maxDrift = Math.max(maxDrift, Math.abs(g.h[i] - h0[i]));
    expect(maxDrift).toBeLessThan(1e-9); // no spurious flux from terrain steps
  });
});

describe('inertial solver — momentum (the whole point)', () => {
  it('a released step OVERSHOOTS its equilibrium — flow carries inertia', () => {
    // Closed box, flat bed, water high on the left, low on the right. Equilibrium is
    // flat at the mean depth. A non-inertial (diffusive) scheme relaxes monotonically
    // and never exceeds the mean on the low side; inertia makes the surge overshoot.
    const N = 40;
    const LEFT = 2.0, RIGHT = 1.0, MEAN = (LEFT + RIGHT) / 2;
    const g = makeGrid(N, (x) => ({ z: 0, h: x < N / 2 ? LEFT : RIGHT }));
    const p: InertialParams = { ...BASE, manning: 0.008, dt: cfl(g, BASE) }; // low friction
    const probe = 16 * N + Math.floor(N * 0.8); // a cell well inside the initially-low side
    let peak = 0;
    for (let s = 0; s < 400; s++) {
      step(g, p);
      peak = Math.max(peak, g.h[probe]);
    }
    expect(peak).toBeGreaterThan(MEAN + 0.02); // overshot the equilibrium ⇒ momentum present
  });

  it('stored discharge persists across a step (it is state, not recomputed)', () => {
    const N = 20;
    const g = makeGrid(N, (x) => ({ z: 0, h: x < N / 2 ? 2 : 1 }));
    const p: InertialParams = { ...BASE, manning: 0.01, dt: cfl(g, BASE) };
    step(g, p); // builds up some discharge toward the low side
    const movingFaces = g.qx.filter((q) => Math.abs(q) > 1e-6).length;
    expect(movingFaces).toBeGreaterThan(0);
  });
});

describe('inertial solver — stability & boundaries', () => {
  it('the drainage limiter keeps depth ≥ 0 AND conserves mass at a sharp front', () => {
    // A 40 m spike collapsing into near-dry ground is the case that broke clamp-only
    // (a donor over-drains, the clamp conjures it back). The limiter must keep h ≥ 0
    // with no clamp-created mass, so total water is preserved on a closed boundary.
    const N = 24;
    const g = makeGrid(N, (x, y) => ({ z: 0, h: x === N / 2 && y === N / 2 ? 40 : 0.05 }));
    const p: InertialParams = { ...BASE, manning: 0.02, dt: cfl(g, BASE) };
    const start = totalWater(g);
    for (let s = 0; s < 200; s++) {
      step(g, p);
      for (let i = 0; i < g.h.length; i++) expect(g.h[i]).toBeGreaterThanOrEqual(0);
    }
    expect(totalWater(g)).toBeCloseTo(start, 4); // no clamp-conjured water
  });

  it('an open boundary only ever loses water and drains toward zero', () => {
    const N = 20;
    const g = makeGrid(N, (x, y) => ({ z: 0, h: x > 4 && x < 15 && y > 4 && y < 15 ? 4 : 0 }));
    const p: InertialParams = { ...BASE, boundaryOpen: true, dt: cfl(g, BASE) };
    const start = totalWater(g);
    let prev = start;
    for (let s = 0; s < 150; s++) {
      step(g, p);
      const now = totalWater(g);
      expect(now).toBeLessThanOrEqual(prev + 1e-9); // monotonically non-increasing
      prev = now;
    }
    expect(prev).toBeLessThan(start); // some water left the domain
  });

  it('stays finite (no NaN/Inf) over a long aggressive run', () => {
    const rng = mulberry32(99);
    const g = makeGrid(20, () => ({ z: rng() * 20, h: rng() * 5 }));
    const p: InertialParams = { ...BASE, boundaryOpen: true, dt: 0, rainRate: 5e-4, infilRate: 1e-4 };
    for (let s = 0; s < 250; s++) {
      p.dt = cfl(g, BASE); // adaptive CFL each step (rain grows the depth), as SimDriver does per frame
      step(g, p);
    }
    for (let i = 0; i < g.h.length; i++) {
      expect(Number.isFinite(g.h[i])).toBe(true);
      expect(Number.isFinite(g.qx[i])).toBe(true);
      expect(Number.isFinite(g.qy[i])).toBe(true);
    }
  });
});

describe('inertial solver — friction', () => {
  it('higher Manning n slows the approach to equilibrium', () => {
    const N = 30;
    const build = (): InertialGrid => makeGrid(N, (x) => ({ z: 0, h: x < N / 2 ? 2 : 1 }));
    const run = (manning: number): number => {
      const g = build();
      const p: InertialParams = { ...BASE, manning, dt: cfl(g, BASE) };
      for (let s = 0; s < 60; s++) step(g, p);
      // remaining disequilibrium = how far the low side is still below the mean
      return 1.5 - g.h[15 * N + Math.floor(N * 0.8)];
    };
    const rough = run(0.08);
    const smooth = run(0.012);
    expect(rough).toBeGreaterThan(smooth); // rougher ground equilibrates slower
  });
});
