import { describe, it, expect } from 'vitest';
import { tileUrl, samplePatch, type Patch } from './landcover';

describe('tileUrl', () => {
  it('formats the SW corner with N/S + E/W and zero-padding', () => {
    expect(tileUrl(48, 9)).toContain('N48E009_Map.tif');
    expect(tileUrl(0, 0)).toContain('N00E000_Map.tif');
    expect(tileUrl(-34, 18)).toContain('S34E018_Map.tif'); // Cape Town tile
    expect(tileUrl(0, -123)).toContain('N00W123_Map.tif'); // Portland tile
  });

  it('pads latitude to 2 digits and longitude to 3', () => {
    const url = tileUrl(-3, -9);
    expect(url).toContain('S03W009_Map.tif');
  });
});

describe('samplePatch', () => {
  // 2x2 patch covering lon[0,1] x lat[0,1]; row 0 = north (lat=1), row 1 = south (lat=0).
  const patch: Patch = {
    minLon: 0, maxLon: 1, minLat: 0, maxLat: 1,
    w: 2, h: 2,
    data: [10, 20, 30, 40], // (north-row: 10,20) (south-row: 30,40)
  };

  it('returns null outside the patch bbox', () => {
    expect(samplePatch(patch, -0.1, 0.5)).toBeNull();
    expect(samplePatch(patch, 1.1, 0.5)).toBeNull();
    expect(samplePatch(patch, 0.5, -0.1)).toBeNull();
    expect(samplePatch(patch, 0.5, 1.1)).toBeNull();
  });

  it('maps the north edge to row 0 and the south edge to row h-1', () => {
    expect(samplePatch(patch, 0, 1)).toBe(10); // NW
    expect(samplePatch(patch, 1, 1)).toBe(20); // NE
    expect(samplePatch(patch, 0, 0)).toBe(30); // SW
    expect(samplePatch(patch, 1, 0)).toBe(40); // SE
  });

  it('nearest-rounds interior coordinates to a cell', () => {
    expect(samplePatch(patch, 0.4, 0.9)).toBe(10); // rounds to NW
    expect(samplePatch(patch, 0.6, 0.1)).toBe(40); // rounds to SE
  });
});
