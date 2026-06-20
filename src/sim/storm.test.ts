// Behavioural tests for the storm hyetograph. The module turns a named storm
// into a time-varying rain intensity (mm/hr) anchored to sim time. We assert
// the shape of each curve (low before/after, a peak in the middle) and that the
// piecewise-linear curve integrates to roughly the depth its name advertises.

import { describe, it, expect } from 'vitest';
import type { StormType } from '../config';
import { stormIntensityMmHr, stormDurationSec } from './storm';

const TIME_VARYING: Array<Exclude<StormType, 'constant'>> = [
  'cloudburst',
  'design25yr',
  'may2026',
  'jun2026',
];

// Trapezoidal integral of intensity over sim time → total depth in mm.
// Intensity is mm/hr, so each minute-step contributes (mmhr * dtMin / 60) mm.
function accumulatedDepthMm(type: StormType, constantMmHr: number): number {
  const stepSec = 5;
  const endSec = stormDurationSec(type);
  let depthMm = 0;
  for (let t = 0; t < endSec; t += stepSec) {
    const i0 = stormIntensityMmHr(type, t, constantMmHr);
    const i1 = stormIntensityMmHr(type, t + stepSec, constantMmHr);
    depthMm += ((i0 + i1) / 2) * (stepSec / 3600);
  }
  return depthMm;
}

function peakIntensity(type: StormType): { mmHr: number; atSec: number } {
  const endSec = stormDurationSec(type);
  let mmHr = -Infinity;
  let atSec = 0;
  for (let t = 0; t <= endSec; t += 5) {
    const v = stormIntensityMmHr(type, t, 0);
    if (v > mmHr) {
      mmHr = v;
      atSec = t;
    }
  }
  return { mmHr, atSec };
}

describe('stormIntensityMmHr — constant', () => {
  it('returns the manual mm/hr verbatim, independent of sim time', () => {
    const manual = 23.5;
    for (const t of [0, 60, 3600, 86_400]) {
      expect(stormIntensityMmHr('constant', t, manual)).toBe(manual);
    }
  });

  it('ignores the curve table entirely (zero manual = zero rain forever)', () => {
    expect(stormIntensityMmHr('constant', 1800, 0)).toBe(0);
  });
});

describe('stormIntensityMmHr — time-varying events', () => {
  it('starts at the curve head value at t=0 (not the constant arg)', () => {
    // t=0 must use the first curve point, not the constantMmHr passed in.
    // Eyeballed presets have a known head; design25yr is IDF-generated, so just assert
    // it comes from the curve (a positive value), not the constant arg.
    const heads: Partial<Record<Exclude<StormType, 'constant'>, number>> = {
      cloudburst: 4,
      may2026: 5,
      jun2026: 3,
    };
    for (const type of TIME_VARYING) {
      const v = stormIntensityMmHr(type, 0, 999);
      expect(v).not.toBe(999); // uses the curve head, not the constant arg
      if (heads[type] !== undefined) expect(v).toBe(heads[type]);
      else expect(v).toBeGreaterThan(0); // design25yr (IDF Chicago storm)
    }
  });

  it.each(TIME_VARYING)('%s peaks somewhere in the interior of the window', (type) => {
    const endSec = stormDurationSec(type);
    const { mmHr, atSec } = peakIntensity(type);
    const start = stormIntensityMmHr(type, 0, 0);
    const end = stormIntensityMmHr(type, endSec, 0);

    expect(mmHr).toBeGreaterThan(start);
    expect(mmHr).toBeGreaterThan(end);
    // The peak is in the middle of the event, not pinned to either boundary.
    expect(atSec).toBeGreaterThan(0);
    expect(atSec).toBeLessThan(endSec);
  });

  it.each(TIME_VARYING)('%s recedes to zero once the storm has ended', (type) => {
    const endSec = stormDurationSec(type);
    // Just past the duration the rain is off (the step-profile IDF storm holds its last
    // block right up to the boundary instant, so check strictly after it has ended).
    expect(stormIntensityMmHr(type, endSec + 60, 0)).toBe(0);
    // Well past the end stays at zero (drainage/recession), never re-rains.
    expect(stormIntensityMmHr(type, endSec + 3600, 0)).toBe(0);
    expect(stormIntensityMmHr(type, endSec * 5, 0)).toBe(0);
  });

  it('interpolates linearly between two curve points', () => {
    // cloudburst: [30 min, 38 mm/hr] → [40 min, 55 mm/hr]. Midpoint 35 min.
    const midSec = 35 * 60;
    const expected = (38 + 55) / 2;
    expect(stormIntensityMmHr('cloudburst', midSec, 0)).toBeCloseTo(expected, 6);
  });

  it('intensity is non-negative across the whole window', () => {
    for (const type of TIME_VARYING) {
      const endSec = stormDurationSec(type);
      for (let t = 0; t <= endSec; t += 30) {
        expect(stormIntensityMmHr(type, t, 0)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('stormIntensityMmHr — accumulated depth matches the named amount', () => {
  // Each storm's comment advertises a total depth; the integral should land near it.
  const cases: Array<{ type: Exclude<StormType, 'constant'>; depthMm: number; tolMm: number }> = [
    { type: 'cloudburst', depthMm: 50, tolMm: 12 },
    { type: 'may2026', depthMm: 41, tolMm: 12 },
    { type: 'jun2026', depthMm: 90, tolMm: 25 },
  ];

  it.each(cases)('$type integrates to ~$depthMm mm', ({ type, depthMm, tolMm }) => {
    const total = accumulatedDepthMm(type, 0);
    expect(total).toBeGreaterThan(depthMm - tolMm);
    expect(total).toBeLessThan(depthMm + tolMm);
  });

  it('design25yr accumulates more depth than the recurring cloudburst', () => {
    // A 25-yr design storm is heavier than the everyday street-flood storm.
    expect(accumulatedDepthMm('design25yr', 0)).toBeGreaterThan(
      accumulatedDepthMm('cloudburst', 0),
    );
  });

  it('the constant manual value does not leak into time-varying depth', () => {
    expect(accumulatedDepthMm('cloudburst', 0)).toBeCloseTo(
      accumulatedDepthMm('cloudburst', 500),
      6,
    );
  });
});

describe('stormDurationSec', () => {
  it('returns the last curve point (in seconds) for each event', () => {
    const lastMin: Record<Exclude<StormType, 'constant'>, number> = {
      cloudburst: 120,
      design25yr: 120, // IDF Chicago storm: 120-min duration
      may2026: 120,
      jun2026: 1440,
    };
    for (const type of TIME_VARYING) {
      expect(stormDurationSec(type)).toBe(lastMin[type] * 60);
    }
  });

  it('a constant storm never ends', () => {
    expect(stormDurationSec('constant')).toBe(Infinity);
  });
});
