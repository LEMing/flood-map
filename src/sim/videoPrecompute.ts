// Pure helpers for the "until-dry" video precompute (kept out of SimDriver to
// hold its line/complexity budget): capture-grid sizing, frame downsampling, the
// per-frame water scan, and the dryness predicate.

export const STORM_FRAMES = 30; // samples over the storm/flood build (≈ first half)
export const STEP_TAIL_SEC = 300; // 5 sim-min per recession frame (drying gets ≈ half)
export const MAX_CAPTURE_SIM_SECONDS = 6 * 3600; // hard sim-time backstop
// Phased evaporation: ~0 while it's raining so the flood actually pools, then high
// during the recession so the city dries fully + fast within the 30 s clip (the
// user wants flood → bone-dry in 30 s). Capture-only; the live sim is unaffected.
export const STORM_EVAP_PER_HR = 0.05;
export const TAIL_EVAP_PER_HR = 1.5;
const DRY_FRACTION = 0.03; // "essentially gone" = 3% of the peak
const VIDEO_CAPTURE_N = 512; // downsample snapshots to this so RAM stays bounded

/** Capture grid for a sim of size N: <=VIDEO_CAPTURE_N with an integer ratio. */
export function captureGrid(N: number): { captureN: number; factor: number } {
  const factor = Math.max(1, Math.round(N / Math.min(N, VIDEO_CAPTURE_N)));
  return { captureN: Math.round(N / factor), factor };
}

/** Max retained frames so the timeline stays within ~300 MB (bumped pool). */
export function videoFrameBudget(captureN: number): number {
  return Math.min(72, Math.max(48, Math.floor(320e6 / (captureN * captureN * 16))));
}

export interface WaterScan { stored: number; flooded: number; maxNow: number; maxEver: number }

/** Single O(n) pass over an rgba water buffer: depth sum, flooded cells, maxima. */
export function scanWater(buf: Float32Array, count: number): WaterScan {
  let stored = 0, flooded = 0, maxNow = 0, maxEver = 0;
  for (let i = 0; i < count; i++) {
    const d = buf[i * 4];
    const m = buf[i * 4 + 1];
    stored += d;
    if (d > 0.05) flooded++;
    if (d > maxNow) maxNow = d;
    if (m > maxEver) maxEver = m;
  }
  return { stored, flooded, maxNow, maxEver };
}

/** Water has receded to <=3% of its observed peak (volume AND area). */
export function isFullyDrained(stored: number, peakStored: number, floodedFrac: number, peakFlooded: number): boolean {
  return stored <= DRY_FRACTION * peakStored
    && floodedFrac <= DRY_FRACTION * Math.max(peakFlooded, 1e-6);
}

/** The snapshot to store: downsampled when the sim grid is large (RAM bound), else the readback. */
export function captureFrame(
  buf: Float32Array, captureBuf: Float32Array | undefined, captureN: number, factor: number,
): Float32Array {
  if (factor <= 1 || !captureBuf) return buf;
  downsample(buf, captureBuf, captureN, factor);
  return captureBuf;
}

/** Box-average an (M·factor)² ×4 float frame down to M² ×4. */
export function downsample(src: Float32Array, dst: Float32Array, M: number, factor: number): void {
  const N = M * factor;
  const inv = 1 / (factor * factor);
  for (let oy = 0; oy < M; oy++) {
    for (let ox = 0; ox < M; ox++) {
      let c0 = 0, c1 = 0, c2 = 0, c3 = 0;
      const by = oy * factor;
      const bx = ox * factor;
      for (let dy = 0; dy < factor; dy++) {
        let k = ((by + dy) * N + bx) * 4;
        for (let dx = 0; dx < factor; dx++) {
          c0 += src[k]; c1 += src[k + 1]; c2 += src[k + 2]; c3 += src[k + 3];
          k += 4;
        }
      }
      const o = (oy * M + ox) * 4;
      dst[o] = c0 * inv;
      dst[o + 1] = c1 * inv;
      dst[o + 2] = c2 * inv;
      dst[o + 3] = c3 * inv;
    }
  }
}
