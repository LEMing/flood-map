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

  it('discharge responds to the head gradient (flows from the higher surface to the lower)', () => {
    // Flat bed, water surface stepping DOWN toward the east. From rest, every interior
    // east-face discharge must be ≥ 0 (eastward, toward the lower surface) — this pins
    // the sign convention that the continuity/mass tests rely on.
    const N = 6;
    const g = makeGrid(N, (x) => ({ z: 0, h: 3 - x * 0.4 })); // η: 3, 2.6, … 1, dropping east
    const p: InertialParams = { ...BASE, manning: 0.02, dt: cfl(g, BASE) };
    const { qx } = momentumStep(g, p);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N - 1; x++) expect(qx[y * N + x]).toBeGreaterThanOrEqual(0);
    }
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

describe('inertial solver — depression storage', () => {
  // A thin 3 mm sheet on a slope with an OPEN edge: with 5 mm of depression storage it is
  // below the micro-hollow fill level and cannot run off; with none, it drains away.
  const thinSheetOnSlope = (): InertialGrid => makeGrid(20, (x) => ({ z: (20 - x) * 0.5, h: 0.003 }));

  it('holds shallow water below the depression depth — nothing runs off the open edge', () => {
    const g = thinSheetOnSlope();
    // manning at the reference n (0.10) → the roughness scale is 1, so the held depth = depressionM.
    const p: InertialParams = { ...BASE, manning: 0.10, boundaryOpen: true, depressionM: 0.005, dt: cfl(g, BASE) };
    const start = totalWater(g);
    for (let s = 0; s < 100; s++) step(g, p);
    expect(totalWater(g)).toBeCloseTo(start, 9); // held in micro-hollows, not a silent sink
  });

  it('without depression storage the same sheet drains off the open edge', () => {
    const g = thinSheetOnSlope();
    const p: InertialParams = { ...BASE, boundaryOpen: true, depressionM: 0, dt: cfl(g, BASE) };
    const start = totalWater(g);
    for (let s = 0; s < 100; s++) step(g, p);
    expect(totalWater(g)).toBeLessThan(start); // runs off
  });

  it('a steep bed step cannot drain a cell below its depression reserve (limiter cap)', () => {
    // A cell perched 5 mm above the 50 mm depression line atop a 10 m drop into dry ground:
    // the inertial discharge down that face is large, so the limiter — not just the hFlow
    // gate — must hold the reserve (it caps outflow at h − depression, not full h).
    const N = 8, dep = 0.05;
    const g = makeGrid(N, (x, y) => (x === 2 && y === 2 ? { z: 10, h: 0.055 } : { z: 0, h: 0 }));
    const p: InertialParams = { ...BASE, manning: 0.10, depressionM: dep, dt: cfl(g, BASE) }; // n_ref → held = dep
    for (let s = 0; s < 200; s++) step(g, p);
    expect(g.h[2 * N + 2]).toBeGreaterThanOrEqual(dep - 1e-6); // reserve held, not drained to 0
  });

  it('rough cover holds more depression than smooth paving (roughness-scaled)', () => {
    // Same scenario, different land cover: grass (high n) holds a deeper reserve than paving.
    const hold = (manning: number): number => {
      const g = makeGrid(20, (x) => ({ z: (20 - x) * 0.5, h: 0.012 })); // 12 mm sheet on a slope
      const p: InertialParams = { ...BASE, manning, boundaryOpen: true, depressionM: 0.005, dt: cfl(g, BASE) };
      for (let s = 0; s < 150; s++) step(g, p);
      return totalWater(g);
    };
    expect(hold(0.20)).toBeGreaterThan(hold(0.013)); // grass retains more than asphalt
  });

  it('varies the reserve per cell from grid.manningN (real spatial roughness, not just uniform n)', () => {
    // Two perched cells over dry ground, one paved + one grass via a per-cell Manning map: each
    // drains to its OWN roughness-scaled reserve, exercising nAt(grid.manningN) → depressionAt.
    const N = 8;
    const g = makeGrid(N, (x, y) => (y === 4 && (x === 2 || x === 5) ? { z: 5, h: 0.012 } : { z: 0, h: 0 }));
    g.manningN = new Float64Array(N * N).fill(0.05);
    g.manningN[4 * N + 2] = 0.013; // paved cell → ~1 mm reserve
    g.manningN[4 * N + 5] = 0.20; // grass cell → ~8 mm reserve
    const p: InertialParams = { ...BASE, depressionM: 0.005, dt: cfl(g, BASE) };
    for (let s = 0; s < 200; s++) step(g, p);
    expect(g.h[4 * N + 5]).toBeGreaterThan(g.h[4 * N + 2]); // grass holds a deeper reserve than paving
  });
});
