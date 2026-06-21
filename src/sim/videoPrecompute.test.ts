import { describe, it, expect } from 'vitest';
import { captureGrid, videoFrameBudget, downsample, isStabilized, tailStepSec, scanWater } from './videoPrecompute';

describe('captureGrid', () => {
  it('keeps small grids as-is and downsamples large ones to <=512 with an integer ratio', () => {
    expect(captureGrid(256)).toEqual({ captureN: 256, factor: 1 });
    expect(captureGrid(512)).toEqual({ captureN: 512, factor: 1 });
    expect(captureGrid(1024)).toEqual({ captureN: 512, factor: 2 });
    expect(captureGrid(2048)).toEqual({ captureN: 512, factor: 4 });
  });

  it('captureN * factor always reconstructs the source grid', () => {
    for (const N of [256, 512, 1024, 2048]) {
      const { captureN, factor } = captureGrid(N);
      expect(captureN * factor).toBe(N);
    }
  });
});

describe('videoFrameBudget', () => {
  it('bounds frames so RAM stays ~<=300 MB and never starves the storm phase', () => {
    // 512² → 4.19 MB/frame; clamped to [48, 72].
    expect(videoFrameBudget(512)).toBe(72);
    expect(videoFrameBudget(256)).toBe(72);
    expect(videoFrameBudget(512) * 512 * 512 * 16).toBeLessThan(320e6);
  });
});

describe('downsample', () => {
  it('box-averages a 4×4 rgba frame down to 2×2 (factor 2)', () => {
    const N = 4, M = 2, factor = 2;
    const src = new Float32Array(N * N * 4);
    // depth channel = cell index; other channels = 0
    for (let i = 0; i < N * N; i++) src[i * 4] = i;
    const dst = new Float32Array(M * M * 4);
    downsample(src, dst, M, factor);
    // top-left 2×2 block = cells 0,1,4,5 → avg 2.5
    expect(dst[0]).toBeCloseTo((0 + 1 + 4 + 5) / 4);
    // top-right block = cells 2,3,6,7 → avg 4.5
    expect(dst[4]).toBeCloseTo((2 + 3 + 6 + 7) / 4);
    // bottom-left block = cells 8,9,12,13 → avg 10.5
    expect(dst[8]).toBeCloseTo((8 + 9 + 12 + 13) / 4);
  });
});

describe('isStabilized', () => {
  it('is true when the water has fully drained (<=2% of peak volume AND area)', () => {
    expect(isStabilized(1, 1, 100, 0.005, 0.5)).toBe(true); // 1% vol & area, flat → drained
    expect(isStabilized(5, 40, 100, 0.005, 0.5)).toBe(false); // 5% vol, still dropping fast
    expect(isStabilized(1, 40, 100, 0.4, 0.5)).toBe(false); // tiny vol but 80% area wet, still dropping
  });

  it('is true for a steady residual pool: receded past 60% and no longer changing', () => {
    expect(isStabilized(50, 50.2, 100, 0.3, 0.5)).toBe(true); // 50% of peak, ~flat frame-to-frame
    expect(isStabilized(50, 70, 100, 0.3, 0.5)).toBe(false); // still dropping fast → not settled
    expect(isStabilized(80, 80.1, 100, 0.4, 0.5)).toBe(false); // flat but only 80% of peak (not receded)
  });
});

describe('tailStepSec', () => {
  it('grows geometrically across recession frames so the long tail fits the budget', () => {
    expect(tailStepSec(0)).toBeLessThan(tailStepSec(1));
    expect(tailStepSec(10)).toBeGreaterThan(tailStepSec(0) * 5);
  });
});

describe('scanWater', () => {
  it('sums depth, counts flooded cells (>5cm), and tracks maxima', () => {
    const buf = new Float32Array([0.1, 2, 0, 0, 0.01, 1, 0, 0, 0.3, 5, 0, 0]);
    const s = scanWater(buf, 3);
    expect(s.stored).toBeCloseTo(0.41);
    expect(s.flooded).toBe(2); // 0.1 and 0.3 exceed 0.05
    expect(s.maxNow).toBeCloseTo(0.3);
    expect(s.maxEver).toBe(5);
  });

  it('tracks peak flow speed over wet cells only (for the velocity-aware CFL)', () => {
    // rgba = depth, maxDepth, vx, vy. A fast but dry cell must NOT raise maxVel.
    const buf = new Float32Array([
      0.5, 0.5, 3, 4, // wet: |v| = 5
      0.01, 0.01, 50, 0, // dry (<5cm): ignored despite |v| = 50
      0.2, 0.2, 0, 6, // wet: |v| = 6
    ]);
    const s = scanWater(buf, 3);
    expect(s.maxVel).toBeCloseTo(6); // the dry cell's 50 is excluded
  });
});
