// Pure rasterization-geometry invariants for the OSM vector->raster pass.
// These exercise the scanline polygon fill and the disc-stamped polyline
// rasterizer that paint OSM ways onto N*N Uint8 obstacle masks — the part that
// actually shapes the flood obstacles. The Overpass fetch path is network IO
// and is deliberately not tested here. Everything below is number-in/number-out
// over plain typed arrays, so it stays fast, offline and self-contained.

import { describe, it, expect } from 'vitest';
import {
  fillPolygon,
  stampLine,
  roadWidthM,
  isGreen,
  isWater,
  bbox,
} from './osm';
import { lonLatToLocalMeters } from './projection';
import type { LatLon } from './heightmap';

// Helpers to read/inspect the row-major Uint8 mask the rasterizers write into.
function cell(mask: Uint8Array, N: number, x: number, y: number): number {
  return mask[y * N + x];
}
function countSet(mask: Uint8Array): number {
  let n = 0;
  for (const v of mask) if (v) n++;
  return n;
}
// Grid coordinates of every set cell, for connectivity / extent assertions.
function setCells(mask: Uint8Array, N: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) if (mask[y * N + x]) out.push([x, y]);
  }
  return out;
}

describe('fillPolygon — scanline interior fill', () => {
  it('fills the interior of an axis-aligned square and nothing outside it', () => {
    const N = 8;
    const mask = new Uint8Array(N * N);
    // Square with edges at grid x,y = 2..6. With the pixel-centre (y+0.5)
    // sampling and ceil(min-0.5)/floor(max-0.5) span rule, this paints the
    // 4x4 block of cells x,y ∈ [2,5].
    const square = [
      [2, 2],
      [6, 2],
      [6, 6],
      [2, 6],
    ];
    fillPolygon(square, mask, N);

    for (let y = 2; y <= 5; y++) {
      for (let x = 2; x <= 5; x++) {
        expect(cell(mask, N, x, y)).toBe(1);
      }
    }
    // Outside the filled block stays empty (sample a ring of outside cells).
    const outside: Array<[number, number]> = [
      [0, 0],
      [1, 1],
      [6, 6],
      [7, 7],
      [1, 3],
      [6, 3],
      [3, 1],
      [3, 6],
    ];
    for (const [x, y] of outside) expect(cell(mask, N, x, y)).toBe(0);
    expect(countSet(mask)).toBe(16);
  });

  it('is closed by the polygon-wrap edge even when the last point is not repeated', () => {
    // The first/last vertex are bridged by the j = pts.length-1 wrap, so an
    // open ring fills identically to an explicitly closed one.
    const N = 8;
    const open = new Uint8Array(N * N);
    const closed = new Uint8Array(N * N);
    const ring = [
      [2, 2],
      [6, 2],
      [6, 6],
      [2, 6],
    ];
    fillPolygon(ring, open, N);
    fillPolygon([...ring, [2, 2]], closed, N);
    expect([...open]).toEqual([...closed]);
  });

  it('clips a polygon extending past the grid to the valid region', () => {
    const N = 8;
    const mask = new Uint8Array(N * N);
    // Square spanning -3..11 in both axes — entirely covers the 8x8 grid.
    const huge = [
      [-3, -3],
      [11, -3],
      [11, 11],
      [-3, 11],
    ];
    fillPolygon(huge, mask, N);
    // Every cell painted, no out-of-bounds write (length is exactly N*N).
    expect(countSet(mask)).toBe(N * N);
    expect(mask).toHaveLength(N * N);
  });

  it('fills a convex triangle as a contiguous span per row, narrowing upward', () => {
    const N = 16;
    const mask = new Uint8Array(N * N);
    // Wide base at the bottom narrowing to an apex — each scanline must be a
    // single uninterrupted run (no holes), and runs shrink toward the apex.
    const tri = [
      [2, 2],
      [13, 2],
      [7, 12],
    ];
    fillPolygon(tri, mask, N);

    let prevWidth = Infinity;
    let sawAny = false;
    for (let y = 0; y < N; y++) {
      const xsInRow: number[] = [];
      for (let x = 0; x < N; x++) if (cell(mask, N, x, y)) xsInRow.push(x);
      if (xsInRow.length === 0) continue;
      sawAny = true;
      // Contiguous: max-min+1 == count (no interior holes on the scanline).
      expect(xsInRow[xsInRow.length - 1] - xsInRow[0] + 1).toBe(xsInRow.length);
      expect(xsInRow.length).toBeLessThanOrEqual(prevWidth + 1);
      prevWidth = xsInRow.length;
    }
    expect(sawAny).toBe(true);
  });

  it('leaves the mask empty for a degenerate zero-height polygon', () => {
    const N = 8;
    const mask = new Uint8Array(N * N);
    // All points on one scanline: no crossing pair => nothing filled.
    fillPolygon([[1, 3], [6, 3], [3, 3]], mask, N);
    expect(countSet(mask)).toBe(0);
  });
});

describe('stampLine — disc-stamped polyline track', () => {
  it('stamps a connected horizontal track of roughly disc width', () => {
    const N = 24;
    const mask = new Uint8Array(N * N);
    const r = 1.5;
    stampLine([4, 12], [19, 12], r, mask, N);

    // The centre row must be a single contiguous run spanning the segment.
    const centre: number[] = [];
    for (let x = 0; x < N; x++) if (cell(mask, N, x, 12)) centre.push(x);
    expect(centre.length).toBeGreaterThan(0);
    expect(centre[centre.length - 1] - centre[0] + 1).toBe(centre.length);
    expect(centre[0]).toBeLessThanOrEqual(4);
    expect(centre[centre.length - 1]).toBeGreaterThanOrEqual(19);

    // Track is r-wide: rows within radius are painted, rows beyond are not.
    expect(countSet(mask.slice(11 * N, 12 * N))).toBeGreaterThan(0); // y=11
    expect(countSet(mask.slice(13 * N, 14 * N))).toBeGreaterThan(0); // y=13
    // |oy| = 3 > r(=1.5): 3^2=9 > r^2+0.25=2.5 -> never stamped.
    const yFar = 12 + 3;
    for (let x = 0; x < N; x++) expect(cell(mask, N, x, yFar)).toBe(0);
  });

  it('produces a 4-connected (gap-free) track along a 45° diagonal', () => {
    const N = 24;
    const mask = new Uint8Array(N * N);
    stampLine([3, 3], [20, 20], 1.0, mask, N);

    const cells = setCells(mask, N);
    expect(cells.length).toBeGreaterThan(0);

    // Build a set and verify the whole stamp is one 4-connected blob — i.e.
    // the rasterized polyline has no break (a flood obstacle must not leak).
    const key = (x: number, y: number) => y * N + x;
    const present = new Set(cells.map(([x, y]) => key(x, y)));
    const seen = new Set<number>();
    const stack = [cells[0]];
    seen.add(key(cells[0][0], cells[0][1]));
    while (stack.length) {
      const [x, y] = stack.pop()!;
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        const k = key(nx, ny);
        if (present.has(k) && !seen.has(k)) {
          seen.add(k);
          stack.push([nx, ny]);
        }
      }
    }
    expect(seen.size).toBe(cells.length);
  });

  it('clips stamps that fall partly off the grid without overflowing', () => {
    const N = 10;
    const mask = new Uint8Array(N * N);
    // Endpoint past the top-right corner; the disc must clip to the grid.
    stampLine([8, 8], [13, 13], 2.0, mask, N);
    // Corner cell is reached, far interior is untouched, length unchanged.
    expect(cell(mask, N, 9, 9)).toBe(1);
    expect(cell(mask, N, 0, 0)).toBe(0);
    expect(mask).toHaveLength(N * N);
  });

  it('always stamps a single disc even for a zero-length segment', () => {
    const N = 12;
    const mask = new Uint8Array(N * N);
    stampLine([6, 6], [6, 6], 2.0, mask, N);
    // Centre and its near neighbours are painted; the count matches the disc
    // mask {(ox,oy): ox^2+oy^2 <= r^2+0.25} for r=2 -> 13 cells.
    expect(cell(mask, N, 6, 6)).toBe(1);
    expect(cell(mask, N, 8, 6)).toBe(1); // |ox|=2 included
    expect(cell(mask, N, 6, 8)).toBe(1);
    expect(countSet(mask)).toBe(13);
  });

  it('wider radius paints a strictly larger footprint', () => {
    const N = 24;
    const thin = new Uint8Array(N * N);
    const thick = new Uint8Array(N * N);
    stampLine([4, 12], [19, 12], 0.5, thin, N);
    stampLine([4, 12], [19, 12], 3.0, thick, N);
    expect(countSet(thick)).toBeGreaterThan(countSet(thin));
  });
});

describe('roadWidthM — width resolution priority', () => {
  it('prefers an explicit numeric width tag over everything else', () => {
    expect(roadWidthM({ width: '12.5', lanes: '8', highway: 'motorway' })).toBe(12.5);
  });

  it('falls back to lanes * 3.25 + 1.5 when width is absent/non-numeric', () => {
    expect(roadWidthM({ lanes: '2', highway: 'residential' })).toBeCloseTo(2 * 3.25 + 1.5, 9);
    expect(roadWidthM({ width: 'wide', lanes: '4' })).toBeCloseTo(4 * 3.25 + 1.5, 9);
  });

  it('clamps lanes to at least one lane', () => {
    expect(roadWidthM({ lanes: '0' })).toBeCloseTo(1 * 3.25 + 1.5, 9);
  });

  it('uses the per-highway-class table when no width/lanes given', () => {
    expect(roadWidthM({ highway: 'motorway' })).toBe(16);
    expect(roadWidthM({ highway: 'footway' })).toBe(2.5);
  });

  it('defaults to 5 m for an unknown highway class with no hints', () => {
    expect(roadWidthM({ highway: 'something_new' })).toBe(5);
    expect(roadWidthM({})).toBe(5);
  });
});

describe('isGreen / isWater classification', () => {
  it('classifies vegetated land uses, leisure and natural tags as green', () => {
    expect(isGreen({ landuse: 'forest' })).toBe(true);
    expect(isGreen({ leisure: 'park' })).toBe(true);
    expect(isGreen({ natural: 'wood' })).toBe(true);
  });

  it('does not classify buildings/roads or empty tags as green', () => {
    expect(isGreen({ building: 'yes' })).toBe(false);
    expect(isGreen({ landuse: 'industrial' })).toBe(false);
    expect(isGreen({})).toBe(false);
  });

  it('uses anchored matches so substrings do not leak through', () => {
    // 'forestry' must NOT match the anchored 'forest' alternative.
    expect(isGreen({ landuse: 'forestry' })).toBe(false);
    expect(isGreen({ leisure: 'parking' })).toBe(false);
  });

  it('recognizes the several ways OSM marks open water', () => {
    expect(isWater({ natural: 'water' })).toBe(true);
    expect(isWater({ landuse: 'reservoir' })).toBe(true);
    expect(isWater({ waterway: 'riverbank' })).toBe(true);
    expect(isWater({ water: 'lake' })).toBe(true);
    // The `water` key presence alone is enough, even with an empty value.
    expect(isWater({ water: '' })).toBe(true);
  });

  it('treats a flowing waterway (no area tag) as not open water', () => {
    expect(isWater({ waterway: 'river' })).toBe(false);
    expect(isWater({ highway: 'residential' })).toBe(false);
  });
});

describe('bbox — geographic bounding box around a centre', () => {
  const center: LatLon = { lat: 45.0355, lon: 38.975 }; // Krasnodar
  const sizeMeters = 2000;

  it('returns [south, west, north, east] ordered correctly', () => {
    const [s, w, n, e] = bbox(center, sizeMeters);
    expect(s).toBeLessThan(n);
    expect(w).toBeLessThan(e);
    expect(center.lat).toBeGreaterThan(s);
    expect(center.lat).toBeLessThan(n);
    expect(center.lon).toBeGreaterThan(w);
    expect(center.lon).toBeLessThan(e);
  });

  it('spans about sizeMeters on each side (within projection tolerance)', () => {
    const [s, w, n, e] = bbox(center, sizeMeters);
    // North-south extent along the centre meridian.
    const [, north] = lonLatToLocalMeters(center, center.lon, n);
    const [, south] = lonLatToLocalMeters(center, center.lon, s);
    expect(north - south).toBeCloseTo(sizeMeters, -1);
    // East-west extent along the centre parallel.
    const [east] = lonLatToLocalMeters(center, e, center.lat);
    const [west] = lonLatToLocalMeters(center, w, center.lat);
    expect(east - west).toBeCloseTo(sizeMeters, -1);
  });

  it('grows monotonically with the requested size', () => {
    const [s1, w1, n1, e1] = bbox(center, 1000);
    const [s2, w2, n2, e2] = bbox(center, 4000);
    expect(n2 - s2).toBeGreaterThan(n1 - s1);
    expect(e2 - w2).toBeGreaterThan(e1 - w1);
  });
});

describe('fill vs stamp grid-coordinate mapping', () => {
  it('writes only within bounds for both rasterizers (no index escape)', () => {
    const N = 32;
    const fill = new Uint8Array(N * N);
    const stamp = new Uint8Array(N * N);
    fillPolygon(
      [
        [-5, -5],
        [40, -5],
        [40, 40],
        [-5, 40],
      ],
      fill,
      N,
    );
    stampLine([-5, 16], [40, 16], 4, stamp, N);
    // Neither write past the typed-array bounds (Uint8Array would silently
    // ignore OOB writes, but length staying N*N + non-empty result is the
    // contract we assert).
    expect(fill).toHaveLength(N * N);
    expect(stamp).toHaveLength(N * N);
    expect(countSet(fill)).toBe(N * N);
    expect(countSet(stamp)).toBeGreaterThan(0);
  });
});
