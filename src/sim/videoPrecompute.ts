// Pure helpers for the "until-dry" video precompute (kept out of SimDriver to
// hold its line/complexity budget): capture-grid sizing, frame downsampling, the
// per-frame water scan, and the dryness predicate.

export const STORM_FRAMES = 30; // samples over the storm/flood build (≈ first half)
export const STEP_TAIL_SEC = 240; // first recession frame; the step then GROWS (see TAIL_GROWTH)
export const TAIL_GROWTH = 1.22; // recession step grows per frame, so even a slow-draining pool
// reaches its steady state within the frame budget (the timelapse compresses the long tail).
export const MAX_CAPTURE_SIM_SECONDS = 60 * 24 * 3600; // backstop: weeks of sim-time for slow pools
// Phased evaporation: ~0 while it's raining so the flood actually pools, then high during the
// recession so the city dries to a stable state within the clip. Capture-only; live sim unaffected.
export const STORM_EVAP_PER_HR = 0.05;
export const TAIL_EVAP_PER_HR = 3.0;
const DRY_FRACTION = 0.02; // "essentially gone" = 2% of the peak
const SETTLE_FRACTION = 0.015; // per-frame stored change this small (vs peak) ⇒ the water has settled
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

export interface WaterScan { stored: number; flooded: number; maxNow: number; maxEver: number; maxVel: number }

/** Single O(n) pass over an rgba water buffer: depth sum, flooded cells, maxima, peak speed. */
export function scanWater(buf: Float32Array, count: number): WaterScan {
  let stored = 0, flooded = 0, maxNow = 0, maxEver = 0, maxVel = 0;
  for (let i = 0; i < count; i++) {
    const d = buf[i * 4];
    const m = buf[i * 4 + 1];
    stored += d;
    if (d > 0.05) {
      flooded++;
      const vx = buf[i * 4 + 2];
      const vy = buf[i * 4 + 3];
      const v = Math.sqrt(vx * vx + vy * vy);
      if (v > maxVel) maxVel = v; // for the velocity-aware CFL (supercritical flow)
    }
    if (d > maxNow) maxNow = d;
    if (m > maxEver) maxEver = m;
  }
  return { stored, flooded, maxNow, maxEver, maxVel };
}

/** Water has receded to <=2% of its observed peak (volume AND area). */
function isFullyDrained(stored: number, peakStored: number, floodedFrac: number, peakFlooded: number): boolean {
  return stored <= DRY_FRACTION * peakStored
    && floodedFrac <= DRY_FRACTION * Math.max(peakFlooded, 1e-6);
}

/** Receded past 60% of peak AND no longer changing frame-to-frame (a steady residual pool). */
function hasSettled(stored: number, prevStored: number, peakStored: number): boolean {
  return stored <= 0.6 * peakStored
    && Math.abs(prevStored - stored) <= SETTLE_FRACTION * Math.max(peakStored, 1e-6);
}

/** The recession step for tail frame k — grows geometrically so the long tail fits the budget. */
export function tailStepSec(tailFrame: number): number {
  return STEP_TAIL_SEC * Math.pow(TAIL_GROWTH, tailFrame);
}

/** Past its peak the water has STABILIZED: fully drained, or settled to a steady residual pool.
 *  This is what the timelapse ends on — a settled frame, never mid-drain. */
export function isStabilized(
  stored: number, prevStored: number, peakStored: number, floodedFrac: number, peakFlooded: number,
): boolean {
  return isFullyDrained(stored, peakStored, floodedFrac, peakFlooded)
    || hasSettled(stored, prevStored, peakStored);
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
