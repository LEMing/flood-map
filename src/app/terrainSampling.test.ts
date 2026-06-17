import { describe, it, expect } from 'vitest';
import type { Heightmap } from '../geo/heightmap';
import { sampleElevation, sampleDepth } from './terrainSampling';

function makeHeightmap(data: number[], N: number): Heightmap {
  return {
    data: new Float32Array(data),
    N,
    sizeMeters: 1000,
    center: { lat: 0, lon: 0 },
    min: Math.min(...data),
    max: Math.max(...data),
    synthetic: false,
  };
}

describe('sampleElevation', () => {
  // A 2x2 grid: row 0 (south) = [0, 10], row 1 (north) = [20, 30].
  const hm = makeHeightmap([0, 10, 20, 30], 2);

  it('returns the corner values exactly at the corners', () => {
    expect(sampleElevation(hm, 0, 0)).toBe(0);
    expect(sampleElevation(hm, 1, 0)).toBe(10);
    expect(sampleElevation(hm, 0, 1)).toBe(20);
    expect(sampleElevation(hm, 1, 1)).toBe(30);
  });

  it('bilinearly interpolates the centre', () => {
    expect(sampleElevation(hm, 0.5, 0.5)).toBeCloseTo(15, 6);
  });

  it('interpolates along each edge', () => {
    expect(sampleElevation(hm, 0.5, 0)).toBeCloseTo(5, 6);
    expect(sampleElevation(hm, 0, 0.5)).toBeCloseTo(10, 6);
  });

  it('clamps the base cell so u=1 / v=1 do not read out of bounds', () => {
    expect(() => sampleElevation(hm, 1, 1)).not.toThrow();
    expect(Number.isFinite(sampleElevation(hm, 1, 1))).toBe(true);
  });
});

describe('sampleDepth', () => {
  it('reads the red channel of the nearest cell', () => {
    const N = 2;
    // RGBA per cell; depth is channel 0. Cells: (0,0)=1, (1,0)=2, (0,1)=3, (1,1)=4.
    const readback = new Float32Array([
      1, 0, 0, 0, 2, 0, 0, 0,
      3, 0, 0, 0, 4, 0, 0, 0,
    ]);
    expect(sampleDepth(readback, N, 0, 0)).toBe(1);
    expect(sampleDepth(readback, N, 1, 0)).toBe(2);
    expect(sampleDepth(readback, N, 0, 1)).toBe(3);
    expect(sampleDepth(readback, N, 1, 1)).toBe(4);
  });

  it('rounds to the nearest cell', () => {
    const N = 2;
    const readback = new Float32Array([
      1, 0, 0, 0, 2, 0, 0, 0,
      3, 0, 0, 0, 4, 0, 0, 0,
    ]);
    expect(sampleDepth(readback, N, 0.4, 0)).toBe(1);
    expect(sampleDepth(readback, N, 0.6, 0)).toBe(2);
  });
});
