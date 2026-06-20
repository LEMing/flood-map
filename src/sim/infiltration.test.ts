import { describe, it, expect } from 'vitest';
import { greenAmptRate, stepGreenAmpt, F_MIN } from './infiltration';

const KS = 3.3e-6; // ~12 mm/hr saturated conductivity
const S = 0.06; // suction × moisture deficit (m)

describe('greenAmptRate', () => {
  it('is far above Ks for dry soil and decays toward Ks as F grows', () => {
    const dry = greenAmptRate(F_MIN, KS, S); // bone dry
    const wetting = greenAmptRate(0.05, KS, S);
    const nearSat = greenAmptRate(5.0, KS, S);
    expect(dry).toBeGreaterThan(KS * 10); // gulps early
    expect(wetting).toBeLessThan(dry);
    expect(nearSat).toBeGreaterThan(KS);
    expect(nearSat).toBeCloseTo(KS, 7); // → Ks asymptote
  });

  it('decreases monotonically with cumulative infiltration', () => {
    let prev = Infinity;
    for (const F of [F_MIN, 0.01, 0.05, 0.2, 1, 5]) {
      const r = greenAmptRate(F, KS, S);
      expect(r).toBeLessThan(prev);
      prev = r;
    }
  });

  it('floors F at F_MIN so the initial rate is finite (no ÷0 at F=0)', () => {
    expect(greenAmptRate(0, KS, S)).toBe(greenAmptRate(F_MIN, KS, S));
    expect(Number.isFinite(greenAmptRate(0, KS, S))).toBe(true);
  });

  it('is zero on impervious ground (Ks = 0)', () => {
    expect(greenAmptRate(0, 0, S)).toBe(0);
    expect(greenAmptRate(1, 0, S)).toBe(0);
  });
});

describe('stepGreenAmpt', () => {
  it('infiltrates min(available water, capacity·dt) and accumulates F', () => {
    const dt = 1;
    // Only a sliver of water present (< capacity·dt) → water-limited.
    const water = 5e-5;
    const shallow = stepGreenAmpt(F_MIN, water, KS, S, dt);
    expect(shallow.infiltrated).toBeCloseTo(water, 12); // all of it soaks in
    expect(shallow.newF).toBeCloseTo(F_MIN + water, 12);

    // Deep ponding → limited by the capacity rate, not the water.
    const deep = stepGreenAmpt(0.1, 5, KS, S, dt);
    expect(deep.infiltrated).toBeCloseTo(greenAmptRate(0.1, KS, S) * dt, 12);
    expect(deep.infiltrated).toBeLessThan(5);
    expect(deep.newF).toBeCloseTo(0.1 + deep.infiltrated, 12);
  });

  it('never infiltrates on impervious ground and leaves F unchanged', () => {
    const r = stepGreenAmpt(0.5, 3, 0, S, 10);
    expect(r.infiltrated).toBe(0);
    expect(r.newF).toBe(0.5);
  });

  it('over a long ponded run the rate decays toward Ks (the wetting front deepens)', () => {
    let F = 0;
    const dt = 5;
    let firstRate = 0, lastRate = 0;
    for (let s = 0; s < 2000; s++) {
      const rate = greenAmptRate(F, KS, S);
      if (s === 0) firstRate = rate;
      lastRate = rate;
      F = stepGreenAmpt(F, 100, KS, S, dt).newF; // effectively unlimited water
    }
    expect(firstRate).toBeGreaterThan(KS * 10);
    expect(lastRate).toBeLessThan(firstRate / 10); // decayed by more than 10×
    expect(lastRate).toBeGreaterThan(KS); // approaches but never drops below Ks
    expect(lastRate / KS).toBeLessThan(2); // well on its way to the saturated asymptote
  });
});
