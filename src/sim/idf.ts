// Intensity-duration-frequency design storms. The SP 32.13330.2018 (ex SNiP 2.04.03-85)
// "limiting-intensity" rainfall formula gives the average intensity of a rain of duration
// t and return period P; the Keifer & Chu (1957) alternating-block ("Chicago") method turns
// that IDF curve into a synthetic hyetograph with a realistic central peak. This replaces
// the eyeballed piecewise-linear storm shapes with a method an engineer would recognise.

export interface IdfParams {
  q20: number; // 20-min, P=1yr intensity, l/(s·ha) — SP 32.13330 rainfall-intensity map
  n: number; // duration exponent (regional)
  c: number; // return-period coefficient in the (1 + c·lg P) term (regional)
}

// Krasnodar (southern European Russia zone), SP 32.13330: q20 ≈ 100 l/(s·ha) read off the
// intensity map (published values span ~90–120); n and c are the zone's table values.
export const KRASNODAR_IDF: IdfParams = { q20: 100, n: 0.71, c: 1.54 };

const LS_HA_TO_MM_HR = 0.36; // 1 l/(s·ha) = 0.36 mm/hr

/** Average rainfall intensity (mm/hr) of a rain lasting `tMin` minutes at return period `pYears` (≥1). */
export function idfIntensityMmHr(tMin: number, pYears: number, p: IdfParams): number {
  const t = Math.max(1, tMin);
  const P = Math.max(1, pYears); // the formula is for annual-or-rarer events; P<1 → negative intensity
  const qLsHa = (p.q20 * Math.pow(20, p.n) * (1 + p.c * Math.log10(P))) / Math.pow(t, p.n);
  return qLsHa * LS_HA_TO_MM_HR;
}

/**
 * Keifer & Chu (1957) alternating-block design storm. Slice the total duration into blocks
 * of `dtMin`; the IDF gives the cumulative depth at each k·dt, whose successive differences
 * are the block depths (largest first, since average intensity falls with duration); arrange
 * those blocks with the peak in the centre and the rest alternating outward. Each block is
 * emitted as a flat STEP (its value duplicated at both edges) so the linear interpolation in
 * stormIntensityMmHr reproduces rectangles, not ramps — preserving the block depths exactly.
 * Returns [minute, mm/hr] points consumed by stormIntensityMmHr.
 */
export function alternatingBlockHyetograph(
  pYears: number, durationMin: number, dtMin: number, p: IdfParams,
): Array<[number, number]> {
  const nBlocks = Math.max(1, Math.round(durationMin / dtMin));
  const blockDepthMm: number[] = []; // marginal depth of each successive duration band
  let prevDepth = 0;
  for (let k = 1; k <= nBlocks; k++) {
    const t = k * dtMin;
    const cumDepth = idfIntensityMmHr(t, pYears, p) * (t / 60); // mm over the first t minutes
    blockDepthMm.push(cumDepth - prevDepth);
    prevDepth = cumDepth;
  }

  // Alternating arrangement: most intense band (index 0) at the centre, then right, left, …
  const arranged = new Array<number>(nBlocks);
  let lo = Math.floor((nBlocks - 1) / 2);
  let hi = lo + 1;
  for (let i = 0; i < nBlocks; i++) {
    if (i % 2 === 0) { arranged[lo] = blockDepthMm[i]; lo--; } else { arranged[hi] = blockDepthMm[i]; hi++; }
  }

  const points: Array<[number, number]> = [];
  for (let k = 0; k < nBlocks; k++) {
    const mmHr = (arranged[k] / dtMin) * 60; // block depth (mm over dt) → intensity
    points.push([k * dtMin, mmHr], [(k + 1) * dtMin, mmHr]); // flat step across [k·dt, (k+1)·dt]
  }
  points.push([nBlocks * dtMin, 0]); // storm ends → recession
  return points;
}
