import type { StormType } from '../config';

// Time-varying rain (hyetograph) instead of flat rainfall. A cloudburst has a
// short, sharply-peaked intensity that briefly exceeds the storm-sewer capacity —
// that peak is what triggers the flooding. Curves are [minutes, mm/hr] anchored to
// sim time from 0 (reset replays the storm).
//
// NOTE: these are REPRESENTATIVE rainfall profiles (eyeballed piecewise-linear
// shapes scaled to a reported total depth) — they are NOT fitted IDF / alternating-
// block design storms (Keifer & Chu 1957) nor gauge records, and the "2026" curves
// are not validated against any observed flood extent. Each preset's label states
// its own trapezoidal-integral depth so the number is honest. A proper version
// would synthesize a Chicago storm from Krasnodar СП 32.13330.2018 IDF parameters.

interface Curve {
  points: Array<[number, number]>;
}

const STORMS: Record<Exclude<StormType, 'constant'>, Curve> = {
  // Cloudburst: peak ~55 mm/hr, ~38 mm over 2 h (trapezoidal) — the street-flood shape.
  cloudburst: { points: [[0, 4], [15, 12], [30, 38], [40, 55], [50, 40], [65, 18], [90, 7], [120, 0]] },
  // Heavy storm: higher peak ~95 mm/hr, ~62 mm over ~2 h (design-type shape, not an IDF fit).
  design25yr: { points: [[0, 6], [15, 20], [30, 62], [40, 95], [50, 55], [70, 22], [100, 8], [135, 0]] },
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
