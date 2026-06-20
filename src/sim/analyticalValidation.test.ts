// VERIFICATION (not calibration): the inertial solver vs closed-form shallow-water
// solutions. The other suite (inertialFlow.test.ts) pins PROPERTIES — mass conserved,
// lake-at-rest, overshoot, finiteness — but a solver can satisfy every one of those and
// still propagate a wave at the wrong celerity. These tests compare the numerical answer
// to a KNOWN analytical answer, so "mirrors Bates et al. 2010 / LISFLOOD-FP" is a
// reproducible result, not an assertion. They run the pure-Float64 CPU reference
// (inertialFlow.ts), which the GPU shaders mirror line-for-line.
//
// Each case is chosen for the regime the local-inertial scheme is valid in (subcritical /
// gradually-varied / gravity-wave) and asserts TIGHTLY there; the one supercritical case
// (dam-break front) is asserted as a CHARACTERISATION of the documented limit (the dropped
// convective-acceleration term), not as tight accuracy — see README "Limitations".
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

// ── 1. Steady overland sheet flow → Manning normal depth ─────────────────────────────
// Uniform rain on a tilted plane reaches a steady kinematic profile where the friction
// slope equals the bed slope, so the unit discharge q(x)=r·x and depth obey Manning's
// law h = (q·n/√S₀)^(3/5). This is the scheme's design regime (subcritical sheet flow),
// the exact physics that drives pluvial routing — so we assert it tightly.
describe('verification — Manning normal depth (steady overland flow)', () => {
  it('a rained-on tilted plane converges to the analytical normal depth (<6%, <2% well-developed)', () => {
    const N = 60, dx = 5, gravity = 9.81, n = 0.03, S0 = 0.01;
    const rain = 100 / 1000 / 3600; // 100 mm/hr → m/s
    const g = makeGrid(N, (x) => (N - 1 - x) * S0 * dx, () => 0); // west high → east low, open outlet
    const p: InertialParams = {
      dt: 0, gravity, cellSize: dx, manning: n, boundaryOpen: true, hMin: 1e-4, rainRate: rain,
    };
    for (let s = 0; s < 6000; s++) { p.dt = inertialCflDt(dx, gravity, Math.max(maxDepth(g), 0.01)); step(g, p); }

    const cy = Math.floor(N / 2); // centre row ≈ 1-D (transverse flow negligible)
    const normalDepth = (q: number): number => Math.pow((q * n) / Math.sqrt(S0), 0.6);
    const ratioAt = (x: number): number => g.h[cy * N + x] / normalDepth(rain * x * dx);
    for (const x of [20, 25, 30, 35]) expect(Math.abs(ratioAt(x) - 1)).toBeLessThan(0.06);
    expect(Math.abs(ratioAt(35) - 1)).toBeLessThan(0.02); // well-developed interior: tight
  }, 30_000); // many sub-steps to steady state — generous ceiling for slow CI runners
});

// ── 2. Gravity-wave celerity → Merian seiche ─────────────────────────────────────────
// A closed flat basin sloshes in its fundamental standing mode with period T₁ = 2L/√(g·H)
// (Merian's formula). This pins the propagation speed √(g·H) directly: a solver can
// conserve mass perfectly and still get this wrong. Measured ratio is 1.000.
describe('verification — Merian seiche (gravity-wave period)', () => {
  it('the fundamental standing-wave period matches 2L/√(gH) to <1.5% and conserves mass', () => {
    const N = 80, dx = 5, gravity = 9.81, H = 3, A = 0.05;
    const L = N * dx;
    const g = makeGrid(N, () => 0, (x) => H + A * Math.cos((Math.PI * (x + 0.5) * dx) / L)); // n=1 mode, at rest
    const p: InertialParams = { dt: 0, gravity, cellSize: dx, manning: 0, boundaryOpen: false, hMin: 1e-5 };
    const T1 = (2 * L) / Math.sqrt(gravity * H);
    const row = Math.floor(N / 2) * N;
    const tilt = (): number => g.h[row + 1] - g.h[row + N - 2]; // standing-mode phase proxy
    const startMass = totalWater(g);

    let t = 0; const tEnd = 4.2 * T1; const crossings: number[] = []; let prev = tilt(), prevT = 0;
    while (t < tEnd) {
      p.dt = Math.min(inertialCflDt(dx, gravity, maxDepth(g)), tEnd - t); step(g, p); t += p.dt;
      const c = tilt();
      if (prev < 0 && c >= 0) crossings.push(prevT + (p.dt * (0 - prev)) / (c - prev)); // upward zero-crossing
      prev = c; prevT = t;
    }
    const periods = crossings.slice(1).map((tc, i) => tc - crossings[i]);
    const meanPeriod = periods.reduce((a, b) => a + b, 0) / periods.length;
    expect(periods.length).toBeGreaterThanOrEqual(3); // it actually oscillated several cycles
    expect(Math.abs(meanPeriod / T1 - 1)).toBeLessThan(0.015); // celerity √(gH) is right
    expect(Math.abs(totalWater(g) - startMass) / startMass).toBeLessThan(1e-9);
  }, 30_000);
});

// ── 3. Moving wet/dry shoreline → Thacker parabolic bowl ──────────────────────────────
// Frictionless sloshing in a parabolic basin: the shoreline runs up and down, drying and
// re-wetting cells every cycle. The hard requirements there are dynamic well-balancedness
// (mass conserved exactly) and positivity (no negative depth at the moving front). We do
// NOT assert the period: at this large amplitude the shoreline fully dries, which is the
// regime the scheme is least accurate in — so this case guards robustness, while case 2
// pins celerity in the always-wet regime.
describe('verification — Thacker bowl (dynamic wet/dry well-balancedness)', () => {
  it('sloshes and dries the shoreline while conserving mass exactly and keeping depth ≥ 0', () => {
    const N = 80, dx = 4, gravity = 9.81, D0 = 2, a = (N * dx) / 2;
    const cx = (N * dx) / 2, bed = (xm: number): number => D0 * ((xm - cx) / a) ** 2;
    const H = D0 * 1.3, tilt0 = 0.01; // large enough to dry the shoreline each cycle
    const g = makeGrid(N, (x) => bed(x * dx), (x) => Math.max(0, H + tilt0 * (x * dx - cx) - bed(x * dx)));
    const p: InertialParams = { dt: 0, gravity, cellSize: dx, manning: 0, boundaryOpen: false, hMin: 1e-4 };
    const T1 = (2 * Math.PI * a) / Math.sqrt(2 * gravity * D0);
    const row = Math.floor(N / 2) * N;
    const com = (): number => {
      let m = 0, mx = 0;
      for (let x = 0; x < N; x++) { const hh = g.h[row + x]; m += hh; mx += hh * x; }
      return mx / m;
    };
    const startMass = totalWater(g);

    let t = 0; const tEnd = 2.2 * T1; let sign = Math.sign(com() - cx / dx), flips = 0, dried = false, anyNeg = false;
    while (t < tEnd) {
      p.dt = Math.min(inertialCflDt(dx, gravity, Math.max(maxDepth(g), 0.1)), tEnd - t); step(g, p); t += p.dt;
      for (const v of g.h) { if (v < 0) anyNeg = true; if (v < 1e-6) dried = true; } // plain scan, no hot-loop expect
      const s = Math.sign(com() - cx / dx);
      if (s !== 0 && s !== sign) { flips++; sign = s; }
    }
    expect(anyNeg).toBe(false); // positivity held at the moving shoreline
    expect(flips).toBeGreaterThanOrEqual(3); // gravity restoring force → it oscillates
    expect(dried).toBe(true); // the shoreline genuinely ran dry (the hard wet/dry case)
    expect(Math.abs(totalWater(g) - startMass) / startMass).toBeLessThan(1e-9); // exact mass
  }, 30_000);
});

// ── 4. Dam-break vs Ritter (characterising the documented supercritical limit) ────────
// Dry-bed dam-break, frictionless. Ritter's exact solution: the upstream rarefaction head
// retreats at −√(g·h₀) and the wetting front advances at +2√(g·h₀). The local-inertial
// scheme (no convective acceleration) captures the SUBcritical rarefaction head well but
// UNDER-propagates the SUPERcritical front — exactly the limitation README documents. This
// test asserts both: the head is accurate, the front is honestly bounded by the inviscid
// front (and clearly lags it). It is a characterisation, not a tight-accuracy claim.
describe('verification — Ritter dam-break (documented supercritical limit)', () => {
  it('captures the rarefaction head but under-propagates the supercritical front, conserving mass', () => {
    const N = 120, dx = 1, gravity = 9.81, h0 = 1, dam = 40;
    const g = makeGrid(N, () => 0, (x) => (x < dam ? h0 : 0));
    const p: InertialParams = { dt: 0, gravity, cellSize: dx, manning: 0, boundaryOpen: false, hMin: 1e-4 };
    const c0 = Math.sqrt(gravity * h0);
    const startMass = totalWater(g);

    let t = 0; const tEnd = 6;
    while (t < tEnd) { p.dt = Math.min(inertialCflDt(dx, gravity, maxDepth(g)), tEnd - t); step(g, p); t += p.dt; }

    const row = Math.floor(N / 2) * N;
    let front = dam; for (let x = dam; x < N; x++) if (g.h[row + x] > 0.01) front = x;
    let head = dam; for (let x = dam; x >= 0; x--) { if (g.h[row + x] < 0.99 * h0) head = x; else break; }
    const frontAnalytic = dam + 2 * c0 * t; // inviscid Ritter wetting front
    const headAnalytic = dam - c0 * t; // inviscid rarefaction head

    let finitePositive = true;
    for (const v of g.h) if (!Number.isFinite(v) || v < 0) finitePositive = false;

    expect(Math.abs(head - headAnalytic)).toBeLessThan(4); // subcritical head: accurate (~2 cells)
    expect(front).toBeGreaterThan(dam + 5); // the wave did propagate downstream
    expect(front).toBeLessThan(frontAnalytic); // supercritical front lags the inviscid one (documented)
    expect(finitePositive).toBe(true);
    expect(Math.abs(totalWater(g) - startMass) / startMass).toBeLessThan(1e-9); // closed: mass conserved
  });
});
