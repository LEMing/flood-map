import type { StormType } from '../config';

// Time-varying rain (hyetograph) instead of flat rainfall. A залповый ливень has
// a short, sharply-peaked intensity that briefly exceeds the storm-sewer
// capacity — that peak is what triggers the flooding. Curves are [minutes, mm/hr]
// anchored to sim time from 0 (reset replays the storm). Tuned to the Krasnodar
// СП 32.13330 design intensities and the observed 2026 events.

interface Curve {
  points: Array<[number, number]>;
}

const STORMS: Record<Exclude<StormType, 'constant'>, Curve> = {
  // ~50 mm over 2 h, peak ~55 mm/hr — the recurring street-flood storm.
  cloudburst: { points: [[0, 4], [15, 12], [30, 38], [40, 55], [50, 40], [65, 18], [90, 7], [120, 0]] },
  // P≈25 yr design storm, higher peak.
  design25yr: { points: [[0, 6], [15, 20], [30, 62], [40, 95], [50, 55], [70, 22], [100, 8], [135, 0]] },
  // Observed 18 May 2026 — 41 mm in ~2 h.
  may2026: { points: [[0, 5], [20, 18], [45, 34], [70, 28], [95, 15], [120, 0]] },
  // Observed 12 Jun 2026 — ~90 mm over the day (long, lower intensity).
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
