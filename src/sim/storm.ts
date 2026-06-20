import type { StormType } from '../config';
import { alternatingBlockHyetograph, KRASNODAR_IDF } from './idf';

// Time-varying rain (hyetograph) instead of flat rainfall. A cloudburst has a
// short, sharply-peaked intensity that briefly exceeds the storm-sewer capacity —
// that peak is what triggers the flooding. Curves are [minutes, mm/hr] anchored to
// sim time from 0 (reset replays the storm).
//
// `design25yr` is a proper Keifer & Chu (1957) alternating-block ("Chicago") design
// storm synthesised from the Krasnodar СП 32.13330.2018 IDF (see idf.ts). The other
// three are REPRESENTATIVE profiles (eyeballed piecewise-linear shapes scaled to a
// reported total depth) — NOT design storms or gauge records, and the "2026" curves
// are not validated against any observed flood extent. Each label states its own
// integral depth so the number is honest.

interface Curve {
  points: Array<[number, number]>;
}

const STORMS: Record<Exclude<StormType, 'constant'>, Curve> = {
  // Cloudburst: peak ~55 mm/hr, ~38 mm over 2 h (trapezoidal) — the street-flood shape.
  cloudburst: { points: [[0, 4], [15, 12], [30, 38], [40, 55], [50, 40], [65, 18], [90, 7], [120, 0]] },
  // Heavy storm: 25-yr Chicago design storm from the Krasnodar IDF — ~64 mm over 2 h,
  // sharp central peak (much fiercer short-duration intensity than the eyeballed shapes).
  design25yr: { points: alternatingBlockHyetograph(25, 120, 10, KRASNODAR_IDF) },
  // 18 May 2026 profile: ~40 mm over 2 h (representative shape, not a gauge trace).
  may2026: { points: [[0, 5], [20, 18], [45, 34], [70, 28], [95, 15], [120, 0]] },
  // 12 Jun 2026 profile: ~100 mm over the day, long & low-intensity (representative shape).
  jun2026: { points: [[0, 3], [60, 7], [180, 9], [360, 7], [600, 5], [900, 3], [1440, 0]] },
};

/** Current rain intensity (mm/hr) for the storm at `simTimeSec`. */
export function stormIntensityMmHr(type: StormType, simTimeSec: number, constantMmHr: number): number {
  if (type === 'constant') return constantMmHr;
  const pts = STORMS[type].points;
  const min = simTimeSec / 60;
  if (min <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (min <= pts[i][0]) {
      const [m0, v0] = pts[i - 1];
      const [m1, v1] = pts[i];
      return v0 + (v1 - v0) * ((min - m0) / (m1 - m0));
    }
  }
  return 0; // storm has ended → drainage/recession
}

export function stormDurationSec(type: StormType): number {
  if (type === 'constant') return Infinity;
  const pts = STORMS[type].points;
  return pts[pts.length - 1][0] * 60;
}
