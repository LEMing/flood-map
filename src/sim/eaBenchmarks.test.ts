// Two cases from the UK Environment Agency 2D benchmark suite (Néelz & Pender, 2013,
// "Benchmarking the latest generation of 2D hydraulic modelling packages"). Unlike most of
// that suite — which is scored against a band of commercial codes — these two have a
// mass-balance answer you can compute, so they make clean automated checks for the wetting/
// drying + still-water behaviour the analytical battery (analyticalValidation.test.ts) does
// not cover: water finding its level in depressions, and disconnected ponds staying separate.
import { describe, it, expect } from 'vitest';
import { type InertialGrid, type InertialParams, step, inertialCflDt } from './inertialFlow';

function makeGrid(N: number, z: (x: number, y: number) => number, h: (x: number, y: number) => number): InertialGrid {
  const zz = new Float64Array(N * N);
  const hh = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) { zz[y * N + x] = z(x, y); hh[y * N + x] = h(x, y); }
  }
  return { N, z: zz, h: hh, qx: new Float64Array(N * N), qy: new Float64Array(N * N) };
}
function maxDepth(g: InertialGrid): number { let m = 0; for (const v of g.h) m = Math.max(m, v); return m; }
function totalWater(g: InertialGrid): number { let s = 0; for (const v of g.h) s += v; return s; }

// ── Test 2 (Néelz-Pender): filling of a floodplain depression ─────────────────────────
// A bowl ringed by higher ground; a uniform dump of water drains into it and settles. By
// mass balance the still-water level L solves Σ max(0, L − z) = (dump depth)·N². The model
// must (a) bring every wet cell to that one flat level and (b) put the right volume there.
describe('EA benchmark — filling a floodplain depression (Néelz-Pender Test 2)', () => {
  it('a uniform dump settles to the analytical mass-balance level with a flat surface', () => {
    const N = 40, dx = 10, gravity = 9.81, dumpM = 0.5;
    const cx = (N - 1) / 2, cy = (N - 1) / 2, k = 0.006;
    // Pure paraboloid over the whole domain (no flat rim that would trap dump water away
    // from the bowl): z = 0 at the centre, rising to ~5 m at the corners — everything drains in.
    const bowl = (x: number, y: number): number => k * ((x - cx) ** 2 + (y - cy) ** 2);
    const g = makeGrid(N, bowl, () => 0);
    const p: InertialParams = { dt: 0, gravity, cellSize: dx, manning: 0.04, boundaryOpen: false };

    // Expected still-water level: bisection on Σ max(0, L − z) = dumpM·N² (mass balance).
    const stored = (L: number): number => { let s = 0; for (const z of g.z) s += Math.max(0, L - z); return s; };
    const target = dumpM * N * N;
    let lo = 0, hi = 6; // above the paraboloid's corner height (~4.6 m)
    for (let it = 0; it < 60; it++) { const mid = (lo + hi) / 2; if (stored(mid) < target) lo = mid; else hi = mid; }
    const expectedL = (lo + hi) / 2;

    let t = 0; const tEnd = 9000;
    while (t < tEnd) {
      p.dt = inertialCflDt(dx, gravity, Math.max(maxDepth(g), dumpM));
      step(g, t === 0 ? { ...p, injectDepth: dumpM } : p); // dump once, then let it settle
      t += p.dt;
    }

    // Wet cells should form one flat surface at the mass-balance level.
    let wetMin = Infinity, wetMax = -Infinity, n = 0, sumEta = 0;
    for (let i = 0; i < N * N; i++) {
      if (g.h[i] <= 0.02) continue;
      const eta = g.z[i] + g.h[i];
      wetMin = Math.min(wetMin, eta); wetMax = Math.max(wetMax, eta); sumEta += eta; n++;
    }
    expect(wetMax - wetMin).toBeLessThan(0.05); // flat surface — the pond found its level
    expect(sumEta / n).toBeCloseTo(expectedL, 1); // and it is the mass-balance level (±~0.05 m)
    expect(totalWater(g) * dx * dx).toBeCloseTo(target * dx * dx, 0); // closed: volume conserved
  });
});

// ── Test 1 (Néelz-Pender): flooding a disconnected water body ──────────────────────────
// Two ponds in separate depressions, divided by a ridge that stands above both water levels,
// initialised to DIFFERENT levels. A correct solver keeps them independent — each stays at
// its own level, the ridge stays dry, and nothing leaks across to equalise them.
describe('EA benchmark — disconnected water bodies stay independent (Néelz-Pender Test 1)', () => {
  it('two ponds at different levels behind a ridge neither equalise nor leak across it', () => {
    const N = 40, dx = 10, gravity = 9.81, ridge = 3, levelA = 1.0, levelB = 1.6;
    // West valley centred at x=10, east valley at x=30, ridge crest at x=20 and the edges.
    const bed = (x: number): number => {
      const fa = Math.min(1, Math.abs(x - 10) / 10);
      const fb = Math.min(1, Math.abs(x - 30) / 10);
      return ridge * Math.min(fa, fb);
    };
    const g = makeGrid(N, (x) => bed(x), (x) => Math.max(0, (x < 20 ? levelA : levelB) - bed(x)));
    const p: InertialParams = { dt: 0, gravity, cellSize: dx, manning: 0.03, boundaryOpen: false };
    const startMass = totalWater(g);

    let t = 0; const tEnd = 3000;
    while (t < tEnd) { p.dt = inertialCflDt(dx, gravity, Math.max(maxDepth(g), 0.1)); step(g, p); t += p.dt; }

    const poolEta = (lo: number, hi: number): { mean: number; spread: number } => {
      let mn = Infinity, mx = -Infinity, sum = 0, n = 0;
      for (let y = 0; y < N; y++) {
        for (let x = lo; x < hi; x++) {
          const i = y * N + x;
          if (g.h[i] > 0.02) { const e = g.z[i] + g.h[i]; mn = Math.min(mn, e); mx = Math.max(mx, e); sum += e; n++; }
        }
      }
      return { mean: sum / n, spread: mx - mn };
    };
    const a = poolEta(0, 18), b = poolEta(22, 40);

    expect(a.mean).toBeCloseTo(levelA, 1); // west pond held its level
    expect(b.mean).toBeCloseTo(levelB, 1); // east pond held its (different) level
    expect(a.spread).toBeLessThan(0.05); // each surface stayed flat
    expect(b.spread).toBeLessThan(0.05);
    expect(b.mean - a.mean).toBeGreaterThan(0.4); // did NOT equalise across the ridge
    // The ridge crest (x≈20) never wetted — no leak path between the ponds.
    let ridgeWet = false;
    for (let y = 0; y < N; y++) if (g.h[y * N + 20] > 0.02) ridgeWet = true;
    expect(ridgeWet).toBe(false);
    expect(totalWater(g)).toBeCloseTo(startMass, 6); // closed: mass conserved
  });
});
