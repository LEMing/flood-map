// Verifies the Saxton–Rawls (2006) pedotransfer against the textbook behaviour: a sandy
// soil drains fast with little capillary pull; a clay soil drains slowly with a strong
// wetting-front suction; porosity/field-capacity land in physical ranges. These are the
// orderings any pedotransfer must reproduce, so they double as a correctness pin.
import { describe, it, expect } from 'vitest';
import { soilHydraulics, greenAmptSorptivityM, type SoilTextureInput } from './pedotransfer';

const SAND: SoilTextureInput = { sandFrac: 0.88, clayFrac: 0.05, omPct: 0.5 };
const LOAM: SoilTextureInput = { sandFrac: 0.40, clayFrac: 0.20, omPct: 1.5 };
const CLAY: SoilTextureInput = { sandFrac: 0.15, clayFrac: 0.55, omPct: 1.5 };

describe('pedotransfer — Saxton-Rawls soil hydraulics', () => {
  const sand = soilHydraulics(SAND);
  const loam = soilHydraulics(LOAM);
  const clay = soilHydraulics(CLAY);

  it('porosity (θs) and field capacity land in physical ranges', () => {
    for (const h of [sand, loam, clay]) {
      expect(h.thetaS).toBeGreaterThan(0.35);
      expect(h.thetaS).toBeLessThan(0.6); // representative soils (swelling clays can exceed this)
      expect(h.theta33).toBeGreaterThan(h.theta1500); // field capacity above wilting point
      expect(h.thetaS).toBeGreaterThan(h.theta33); // saturation above field capacity
    }
  });

  it('stays finite for a pure-sand / zero-organic topsoil (the θ-regression NaN trap)', () => {
    const pureSand = soilHydraulics({ sandFrac: 0.97, clayFrac: 0, omPct: 0 });
    expect(Number.isFinite(pureSand.ksMmPerHr)).toBe(true);
    expect(Number.isFinite(pureSand.greenAmptSuctionM)).toBe(true);
    expect(pureSand.ksMmPerHr).toBeGreaterThan(0);
    expect(greenAmptSorptivityM(pureSand, false)).toBeGreaterThanOrEqual(0);
  });

  it('field capacity rises from sand → loam → clay', () => {
    expect(sand.theta33).toBeLessThan(loam.theta33);
    expect(loam.theta33).toBeLessThan(clay.theta33);
  });

  it('saturated conductivity falls sharply from sand → loam → clay', () => {
    expect(sand.ksMmPerHr).toBeGreaterThan(loam.ksMmPerHr);
    expect(loam.ksMmPerHr).toBeGreaterThan(clay.ksMmPerHr);
    expect(sand.ksMmPerHr).toBeGreaterThan(50); // sand gulps water
    expect(clay.ksMmPerHr).toBeLessThan(10); // clay barely conducts
  });

  it('Green-Ampt suction sits in the Rawls (1983) envelope and is lowest for sand', () => {
    for (const h of [sand, loam, clay]) {
      expect(h.greenAmptSuctionM).toBeGreaterThanOrEqual(0.05);
      expect(h.greenAmptSuctionM).toBeLessThanOrEqual(0.35);
    }
    expect(sand.greenAmptSuctionM).toBeLessThan(loam.greenAmptSuctionM); // sand pulls least
    expect(sand.greenAmptSuctionM).toBeLessThanOrEqual(clay.greenAmptSuctionM);
  });

  it('high groundwater shrinks the suction-deficit S (less room before saturation)', () => {
    for (const h of [sand, loam, clay]) {
      const normal = greenAmptSorptivityM(h, false);
      const high = greenAmptSorptivityM(h, true);
      expect(high).toBeLessThan(normal);
      expect(high).toBeGreaterThanOrEqual(0);
    }
  });
});
