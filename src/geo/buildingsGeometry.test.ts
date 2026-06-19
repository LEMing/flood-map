import { describe, it, expect } from 'vitest';
import { extrudeBuildings, BUILDING_RAISE_M } from './buildingsGeometry';
import type { Heightmap } from './heightmap';
import type { BuildingShape } from './osm';

const SEAT_M = 1.5;
const MIN_HEIGHT_M = BUILDING_RAISE_M + 1;

function flatHeightmap(N: number, elevation: number): Heightmap {
  return {
    data: new Float32Array(N * N).fill(elevation),
    N,
    sizeMeters: 700,
    center: { lat: 0, lon: 0 },
    min: elevation,
    max: elevation,
    synthetic: false,
  };
}

function ys(pos: Float32Array): number[] {
  const out: number[] = [];
  for (let i = 1; i < pos.length; i += 3) out.push(pos[i]);
  return out;
}

describe('extrudeBuildings', () => {
  const N = 8;
  const square: BuildingShape = { ring: [[1, 1], [3, 1], [3, 3], [1, 3]], height: 12 };

  it('emits a roof (2 tris) + 4 wall quads = 30 vertices for a square footprint', () => {
    const g = extrudeBuildings([square], flatHeightmap(N, 100), new Uint8Array(N * N), 0);
    expect(g.position.length).toBe(30 * 3);
    expect(g.color.length).toBe(30 * 3);
    expect(g.ground.length).toBe(30);
  });

  it('seats the base SEAT_M below ground and the roof at the real height', () => {
    const g = extrudeBuildings([square], flatHeightmap(N, 100), new Uint8Array(N * N), 0);
    const y = ys(g.position);
    expect(Math.min(...y)).toBeCloseTo(100 - SEAT_M, 5);
    expect(Math.max(...y)).toBeCloseTo(100 + 12, 5);
  });

  it('records each vertex true ground elevation in aGround', () => {
    const g = extrudeBuildings([square], flatHeightmap(N, 100), new Uint8Array(N * N), 0);
    expect(Array.from(g.ground).every((v) => v === 100)).toBe(true);
  });

  it('un-burns the sim building raise so the base sits on TRUE ground', () => {
    const burned = flatHeightmap(N, 100 + BUILDING_RAISE_M); // DEM already raised by the sim
    const g = extrudeBuildings([square], burned, new Uint8Array(N * N).fill(1), BUILDING_RAISE_M);
    expect(Array.from(g.ground).every((v) => v === 100)).toBe(true);
    expect(Math.max(...ys(g.position))).toBeCloseTo(112, 5);
  });

  it('lifts a too-short building to the minimum clearance height', () => {
    const short: BuildingShape = { ring: [[1, 1], [3, 1], [3, 3], [1, 3]], height: 2 };
    const g = extrudeBuildings([short], flatHeightmap(N, 100), new Uint8Array(N * N), 0);
    expect(Math.max(...ys(g.position))).toBeCloseTo(100 + MIN_HEIGHT_M, 5);
  });

  it('skips a degenerate ring (<3 points)', () => {
    const g = extrudeBuildings(
      [{ ring: [[1, 1], [2, 2]], height: 9 }], flatHeightmap(N, 100), new Uint8Array(N * N), 0,
    );
    expect(g.position.length).toBe(0);
  });
});
