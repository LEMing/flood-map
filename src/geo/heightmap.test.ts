// Unit tests for the pure geo helpers: computeMinMax (a min/max reduction with
// a non-finite fallback) and syntheticHeightmap (deterministic, hash-seeded
// value-noise terrain). Both are pure — no network, no WebGL, no DOM — so they
// are tested directly with known inputs and structural invariants.

import { describe, it, expect } from 'vitest';
import { computeMinMax, type LatLon } from './heightmap';
import { syntheticHeightmap } from './syntheticTerrain';

describe('computeMinMax', () => {
  it('returns the exact min and max of a known array', () => {
    const data = new Float32Array([3, 1, 4, 1, 5, 9, 2, 6]);
    expect(computeMinMax(data)).toEqual({ min: 1, max: 9 });
  });

  it('handles negative values (bathymetry below sea level)', () => {
    const data = new Float32Array([-120.5, -3, 0, 42, -8000, 1500]);
    const { min, max } = computeMinMax(data);
    expect(min).toBe(-8000);
    expect(max).toBe(1500);
  });

  it('returns the value itself for a single-element array', () => {
    expect(computeMinMax(new Float32Array([-273.15]))).toEqual({
      min: Math.fround(-273.15),
      max: Math.fround(-273.15),
    });
  });

  it('returns equal min and max when every value is identical', () => {
    const data = new Float32Array(16).fill(50);
    expect(computeMinMax(data)).toEqual({ min: 50, max: 50 });
  });

  it('falls back to {0, 0} for an empty array (no finite values)', () => {
    expect(computeMinMax(new Float32Array(0))).toEqual({ min: 0, max: 0 });
  });

  it('min <= max holds for arbitrary data', () => {
    const data = new Float32Array([7, -2, 0.5, 100, -100, 3.3]);
    const { min, max } = computeMinMax(data);
    expect(min).toBeLessThanOrEqual(max);
  });
});

describe('syntheticHeightmap', () => {
  const center: LatLon = { lat: 37.7749, lon: -122.4194 };
  const sizeMeters = 4096;
  const N = 24;

  it('produces an N*N Float32Array carrying the requested grid size and metadata', () => {
    const hm = syntheticHeightmap(center, sizeMeters, N);
    expect(hm.data).toBeInstanceOf(Float32Array);
    expect(hm.data.length).toBe(N * N);
    expect(hm.N).toBe(N);
    expect(hm.sizeMeters).toBe(sizeMeters);
    expect(hm.center).toEqual(center);
    expect(hm.synthetic).toBe(true);
  });

  it('respects a different N (grid length scales as N*N)', () => {
    const small = syntheticHeightmap(center, sizeMeters, 8);
    const large = syntheticHeightmap(center, sizeMeters, 33);
    expect(small.data.length).toBe(8 * 8);
    expect(large.data.length).toBe(33 * 33);
    expect(small.N).toBe(8);
    expect(large.N).toBe(33);
  });

  it('respects sizeMeters without altering the sample count', () => {
    const a = syntheticHeightmap(center, 1000, N);
    const b = syntheticHeightmap(center, 9000, N);
    expect(a.sizeMeters).toBe(1000);
    expect(b.sizeMeters).toBe(9000);
    expect(a.data.length).toBe(b.data.length);
  });

  it('has real relief (max strictly greater than min)', () => {
    const hm = syntheticHeightmap(center, sizeMeters, N);
    expect(hm.max).toBeGreaterThan(hm.min);
    expect(hm.max - hm.min).toBeGreaterThan(0);
  });

  it('reports min/max consistent with its own data and produces only finite samples', () => {
    const hm = syntheticHeightmap(center, sizeMeters, N);
    const recomputed = computeMinMax(hm.data);
    expect(hm.min).toBe(recomputed.min);
    expect(hm.max).toBe(recomputed.max);
    for (const v of hm.data) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('is deterministic: identical inputs yield identical grids', () => {
    const first = syntheticHeightmap(center, sizeMeters, N);
    const second = syntheticHeightmap(center, sizeMeters, N);
    expect(Array.from(second.data)).toEqual(Array.from(first.data));
    expect(second.min).toBe(first.min);
    expect(second.max).toBe(first.max);
  });

  it('seeds terrain from the location: different centers give different relief', () => {
    const sf = syntheticHeightmap({ lat: 37.7749, lon: -122.4194 }, sizeMeters, N);
    const nyc = syntheticHeightmap({ lat: 40.7128, lon: -74.006 }, sizeMeters, N);
    expect(Array.from(nyc.data)).not.toEqual(Array.from(sf.data));
  });

  it('forms a basin: the grid centre sits below the four corners', () => {
    const hm = syntheticHeightmap(center, sizeMeters, N);
    const at = (ix: number, iy: number) => hm.data[iy * N + ix];
    const centre = at(N >> 1, N >> 1);
    const corners = [at(0, 0), at(N - 1, 0), at(0, N - 1), at(N - 1, N - 1)];
    const meanCorner = corners.reduce((s, v) => s + v, 0) / corners.length;
    expect(centre).toBeLessThan(meanCorner);
  });
});
