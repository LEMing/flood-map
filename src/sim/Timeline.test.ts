// The precomputed-storm scrub buffer: frame indexing + the linear interpolation
// that lets a coarse capture play back smoothly across a 30 s video. DataTexture
// is CPU-side (a Float32Array), so this runs without a GPU.
import { describe, it, expect } from 'vitest';
import { Timeline } from './Timeline';

function frame(N: number, fill: number): Float32Array {
  return new Float32Array(N * N * 4).fill(fill);
}

describe('Timeline', () => {
  const N = 2;

  it('is not ready until finished with more than one frame', () => {
    const tl = new Timeline(N);
    expect(tl.ready).toBe(false);
    tl.begin();
    tl.capture(frame(N, 1), 0);
    expect(tl.ready).toBe(false); // still computing
    tl.capture(frame(N, 2), 100);
    tl.finish();
    expect(tl.ready).toBe(true);
    expect(tl.count).toBe(2);
    expect(tl.progress).toBe(1);
  });

  it('indexAt clamps to [0,1] and rounds to the nearest frame', () => {
    const tl = new Timeline(N);
    tl.begin();
    for (let i = 0; i < 5; i++) tl.capture(frame(N, i), i);
    tl.finish();
    expect(tl.indexAt(0)).toBe(0);
    expect(tl.indexAt(1)).toBe(4);
    expect(tl.indexAt(0.5)).toBe(2);
    expect(tl.indexAt(-1)).toBe(0); // clamped low
    expect(tl.indexAt(2)).toBe(4); // clamped high
  });

  it('showAt returns the exact captured frame and uploads it to the texture', () => {
    const tl = new Timeline(N);
    tl.begin();
    tl.capture(frame(N, 7), 10);
    tl.capture(frame(N, 9), 20);
    tl.finish();
    const r = tl.showAt(1);
    expect(r?.time).toBe(20);
    expect(Array.from(tl.tex.image.data as Float32Array).every((v) => v === 9)).toBe(true);
  });

  it('sampleAt linearly interpolates rgba AND time between the two nearest frames', () => {
    const tl = new Timeline(N);
    tl.begin();
    tl.capture(frame(N, 0), 0);
    tl.capture(frame(N, 10), 100);
    tl.finish();
    const r = tl.sampleAt(0.5);
    expect(r?.time).toBeCloseTo(50, 5);
    expect((tl.tex.image.data as Float32Array).every((v) => Math.abs(v - 5) < 1e-5)).toBe(true);
  });

  it('sampleAt returns the endpoints exactly at pos 0 and 1', () => {
    const tl = new Timeline(N);
    tl.begin();
    tl.capture(frame(N, 2), 0);
    tl.capture(frame(N, 8), 60);
    tl.finish();
    expect(tl.sampleAt(0)?.time).toBeCloseTo(0, 5);
    expect(tl.sampleAt(1)?.time).toBeCloseTo(60, 5);
  });

  it('sampleAt handles a single frame and rejects an empty timeline', () => {
    const tl = new Timeline(N);
    expect(tl.sampleAt(0.5)).toBeNull();
    tl.begin();
    tl.capture(frame(N, 3), 42);
    expect(tl.sampleAt(0.5)?.time).toBe(42);
  });

  it('configure resizes the scrub texture to the capture grid', () => {
    const tl = new Timeline(4);
    expect(tl.tex.image.width).toBe(4);
    tl.configure(8);
    expect(tl.tex.image.width).toBe(8);
  });
});
