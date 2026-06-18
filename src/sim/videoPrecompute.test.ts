import { describe, it, expect } from 'vitest';
import { captureGrid, videoFrameBudget, downsample, isFullyDrained, scanWater } from './videoPrecompute';

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

describe('isFullyDrained', () => {
  it('is true only when both stored volume and flooded area are <=3% of peak', () => {
    expect(isFullyDrained(2, 100, 0.01, 0.5)).toBe(true); // 2% volume, 2% area
    expect(isFullyDrained(5, 100, 0.01, 0.5)).toBe(false); // 5% volume
    expect(isFullyDrained(2, 100, 0.4, 0.5)).toBe(false); // 80% area still wet
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
});
