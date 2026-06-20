// Pins the SP 32.13330 IDF behaviour and the Keifer-Chu alternating-block construction:
// intensity falls with duration and rises with return period, the synthetic hyetograph
// peaks in the centre, and its total depth equals the IDF cumulative depth.
import { describe, it, expect } from 'vitest';
import { idfIntensityMmHr, alternatingBlockHyetograph, KRASNODAR_IDF } from './idf';

describe('idf — SP 32.13330 limiting-intensity', () => {
  it('intensity falls with duration and rises with return period', () => {
    const short = idfIntensityMmHr(10, 10, KRASNODAR_IDF);
    const long = idfIntensityMmHr(120, 10, KRASNODAR_IDF);
    expect(short).toBeGreaterThan(long); // a 10-min burst is fiercer than a 2-h average

    const p1 = idfIntensityMmHr(60, 1, KRASNODAR_IDF);
    const p100 = idfIntensityMmHr(60, 100, KRASNODAR_IDF);
    expect(p100).toBeGreaterThan(p1); // rarer storms are more intense
  });

  it('gives a plausible Krasnodar 25-yr, 2-h depth (~60 mm)', () => {
    const depth2h = idfIntensityMmHr(120, 25, KRASNODAR_IDF) * 2; // mm/hr × 2 h
    expect(depth2h).toBeGreaterThan(45);
    expect(depth2h).toBeLessThan(85);
  });
});

describe('idf — alternating-block (Chicago) hyetograph', () => {
  const dt = 10, dur = 120, P = 25;
  const pts = alternatingBlockHyetograph(P, dur, dt, KRASNODAR_IDF);

  it('peaks in the centre, not at the ends', () => {
    const intens = pts.slice(0, -1).map(([, v]) => v); // drop the trailing zero
    const peakIdx = intens.indexOf(Math.max(...intens));
    expect(peakIdx).toBeGreaterThan(0);
    expect(peakIdx).toBeLessThan(intens.length - 1);
    expect(intens[0]).toBeLessThan(intens[peakIdx]); // rises into the peak
    expect(intens[intens.length - 1]).toBeLessThan(intens[peakIdx]); // and falls out of it
  });

  it('the DELIVERED depth (trapezoidal, as the sim reads it) equals the IDF cumulative depth', () => {
    // Integrate the emitted points the same way stormIntensityMmHr does (piecewise-linear),
    // so the test pins the depth the simulation actually delivers — the step emission makes
    // this exact rather than ~1% short (the rectangle-vs-ramp bug the review caught).
    let depthMm = 0;
    for (let i = 1; i < pts.length; i++) {
      const [t0, v0] = pts[i - 1];
      const [t1, v1] = pts[i];
      depthMm += ((v0 + v1) / 2) * ((t1 - t0) / 60); // trapezoid, mm
    }
    const idfDepth = idfIntensityMmHr(dur, P, KRASNODAR_IDF) * (dur / 60);
    expect(depthMm).toBeCloseTo(idfDepth, 6);
  });

  it('ends with a zero-intensity recession point at the storm duration', () => {
    expect(pts[pts.length - 1]).toEqual([dur, 0]);
  });
});
