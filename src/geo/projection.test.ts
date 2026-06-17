// Geometric invariants of the projection helpers. proj4 is exercised for real
// (no mock): these are pure number-in/number-out functions, so the test stays
// self-contained, fast and deterministic with no network/WebGL/DOM.

import { describe, it, expect } from 'vitest';
import proj4 from 'proj4';
import {
  projectGrid,
  lonLatToLocalMeters,
  localMetersToLonLat,
  lonLatToPixel,
  chooseZoom,
  chooseSatelliteZoom,
} from './projection';
import type { LatLon } from './heightmap';

// Metric span of the square Web-Mercator world, derived (not hardcoded) the
// same way the module does — by projecting lon=180 at the equator. This lets
// the tests reproduce the module's ground-resolution maths independently.
const WORLD_SIZE = proj4('EPSG:4326', 'EPSG:3857', [180, 0])[0] * 2;

// A spread of latitudes: equator (lon-scale = 1), mid-latitude, and high
// latitude where meridian convergence is severe. proj4's AEQD is metric and
// undistorted at the centre regardless, so the invariants must hold at all.
const CENTERS: Array<{ name: string; center: LatLon }> = [
  { name: 'equator', center: { lat: 0, lon: 0 } },
  { name: 'mid-latitude', center: { lat: 45.5231, lon: -122.6765 } }, // Portland
  { name: 'high-latitude', center: { lat: 70.0, lon: 25.0 } },
];

// Geodesic ground distance between two lon/lat points via a local AEQD frame.
// We avoid hardcoding an Earth radius (project rule) by reusing the same metric
// projection the module relies on and measuring chord length in its plane.
function groundMeters(a: LatLon, b: LatLon): number {
  const [bx, by] = lonLatToLocalMeters(a, b.lon, b.lat);
  return Math.hypot(bx, by);
}

describe('projectGrid', () => {
  describe.each(CENTERS)('$name', ({ center }) => {
    const sizeMeters = 4000;

    it('places the centre node exactly on the input lon/lat (odd N)', () => {
      const N = 65; // odd -> there is a true centre node
      const { lon, lat } = projectGrid(center, sizeMeters, N);
      const mid = Math.floor(N / 2);
      const k = mid * N + mid;
      expect(lon[k]).toBeCloseTo(center.lon, 9);
      expect(lat[k]).toBeCloseTo(center.lat, 9);
    });

    it('is symmetric about the centre: east edge mirrors west edge in lon', () => {
      const N = 65;
      const mid = Math.floor(N / 2);
      const { lon } = projectGrid(center, sizeMeters, N);
      const westLon = lon[mid * N + 0];
      const eastLon = lon[mid * N + (N - 1)];
      // Distances east and west of the meridian must match.
      const dWest = Math.abs(center.lon - westLon);
      const dEast = Math.abs(eastLon - center.lon);
      expect(dEast).toBeCloseTo(dWest, 6);
      expect(westLon).toBeLessThan(center.lon);
      expect(eastLon).toBeGreaterThan(center.lon);
    });

    it('spans ±sizeMeters/2 metrically: corner-to-corner ≈ sizeMeters*√2', () => {
      const N = 65;
      const { lon, lat } = projectGrid(center, sizeMeters, N);
      const sw: LatLon = { lon: lon[0], lat: lat[0] };
      const se: LatLon = { lon: lon[N - 1], lat: lat[N - 1] };
      const nw: LatLon = { lon: lon[(N - 1) * N], lat: lat[(N - 1) * N] };
      const ne: LatLon = { lon: lon[(N - 1) * N + (N - 1)], lat: lat[(N - 1) * N + (N - 1)] };

      // South and north edge lengths span the full width.
      expect(groundMeters(sw, se)).toBeCloseTo(sizeMeters, 0);
      expect(groundMeters(nw, ne)).toBeCloseTo(sizeMeters, 0);
      // West and east edge lengths span the full height.
      expect(groundMeters(sw, nw)).toBeCloseTo(sizeMeters, 0);
      expect(groundMeters(se, ne)).toBeCloseTo(sizeMeters, 0);
      // Diagonal of a square of side sizeMeters.
      const diag = groundMeters(sw, ne);
      expect(diag).toBeCloseTo(sizeMeters * Math.SQRT2, -1);
    });

    it('rows run south→north and columns run west→east', () => {
      const N = 9;
      const { lat, lon } = projectGrid(center, sizeMeters, N);
      // Latitude increases as the row index grows (south edge first).
      expect(lat[(N - 1) * N + 4]).toBeGreaterThan(lat[0 * N + 4]);
      // Longitude increases as the column index grows along a row.
      expect(lon[4 * N + (N - 1)]).toBeGreaterThan(lon[4 * N + 0]);
    });
  });

  it('degenerates for N=1 to the single south-west corner node', () => {
    // With N=1 the step collapses to 0 but the grid still starts at -half,
    // so the lone node sits sizeMeters/2 to the south and west of centre.
    const center: LatLon = { lat: 12, lon: 34 };
    const sizeMeters = 1000;
    const { lon, lat } = projectGrid(center, sizeMeters, 1);
    expect(lon).toHaveLength(1);
    expect(lat).toHaveLength(1);
    const [x, y] = lonLatToLocalMeters(center, lon[0], lat[0]);
    expect(x).toBeCloseTo(-sizeMeters / 2, 3);
    expect(y).toBeCloseTo(-sizeMeters / 2, 3);
  });
});

describe('localMetersToLonLat ∘ lonLatToLocalMeters round-trips', () => {
  describe.each(CENTERS)('$name', ({ center }) => {
    // Sample offsets up to ~2.5 km from centre in both axes.
    const offsets: Array<[number, number]> = [
      [0, 0],
      [1500, 0],
      [0, -2300],
      [-1234.5, 987.6],
      [2500, 2500],
    ];

    it.each(offsets)('(%d, %d) m survives lon/lat ↔ metres', (x, y) => {
      const [lon, lat] = localMetersToLonLat(center, x, y);
      const [x2, y2] = lonLatToLocalMeters(center, lon, lat);
      expect(x2).toBeCloseTo(x, 3);
      expect(y2).toBeCloseTo(y, 3);
    });

    it('the centre maps to the origin (0, 0) metres', () => {
      const [x, y] = lonLatToLocalMeters(center, center.lon, center.lat);
      expect(x).toBeCloseTo(0, 6);
      expect(y).toBeCloseTo(0, 6);
    });
  });
});

describe('lonLatToPixel', () => {
  const z = 12;

  it('is strictly increasing in longitude (west → east → larger gx)', () => {
    const lat = 40;
    const a = lonLatToPixel(-100, lat, z);
    const b = lonLatToPixel(-50, lat, z);
    const c = lonLatToPixel(0, lat, z);
    const d = lonLatToPixel(80, lat, z);
    expect(a.gx).toBeLessThan(b.gx);
    expect(b.gx).toBeLessThan(c.gx);
    expect(c.gx).toBeLessThan(d.gx);
  });

  it('is strictly decreasing in latitude (north → south → larger gy, slippy)', () => {
    const lon = 10;
    const north = lonLatToPixel(lon, 60, z);
    const mid = lonLatToPixel(lon, 30, z);
    const equator = lonLatToPixel(lon, 0, z);
    const south = lonLatToPixel(lon, -30, z);
    expect(north.gy).toBeLessThan(mid.gy);
    expect(mid.gy).toBeLessThan(equator.gy);
    expect(equator.gy).toBeLessThan(south.gy);
  });

  it('puts (lon=0, lat=0) at the centre of the world pixel plane', () => {
    const worldPixels = 256 * Math.pow(2, z);
    const { gx, gy } = lonLatToPixel(0, 0, z);
    expect(gx).toBeCloseTo(worldPixels / 2, 6);
    expect(gy).toBeCloseTo(worldPixels / 2, 6);
  });

  it('keeps relative offsets but doubles pixel coordinates each zoom step', () => {
    const lo = lonLatToPixel(25, 25, 5);
    const hi = lonLatToPixel(25, 25, 6);
    expect(hi.gx).toBeCloseTo(lo.gx * 2, 6);
    expect(hi.gy).toBeCloseTo(lo.gy * 2, 6);
  });
});

describe('chooseZoom', () => {
  describe.each(CENTERS)('$name', ({ center }) => {
    const sizeMeters = 4000;
    const N = 512;
    const cellSize = sizeMeters / N;

    it('picks a zoom whose ground resolution is at least as fine as a cell', () => {
      const maxZoom = 22; // high cap so the resolution constraint, not the cap, decides
      const z = chooseZoom(center, sizeMeters, N, maxZoom);
      // Ground metres covered by one source pixel at this zoom and latitude.
      const latScale = Math.cos((center.lat * Math.PI) / 180);
      const groundPerPixel = ((WORLD_SIZE / Math.pow(2, z)) * latScale) / 256;
      expect(groundPerPixel).toBeLessThanOrEqual(cellSize + 1e-6);
    });

    it('never returns less than one zoom level below what is needed', () => {
      const maxZoom = 22;
      const z = chooseZoom(center, sizeMeters, N, maxZoom);
      const latScale = Math.cos((center.lat * Math.PI) / 180);
      const groundPerPixelOneLess = ((WORLD_SIZE / Math.pow(2, z - 1)) * latScale) / 256;
      // One zoom coarser would have been too coarse, so we did not over-shoot.
      expect(groundPerPixelOneLess).toBeGreaterThan(cellSize - 1e-6);
    });

    it('honours the maxZoom cap', () => {
      const maxZoom = 8;
      const z = chooseZoom(center, sizeMeters, N, maxZoom);
      expect(z).toBeLessThanOrEqual(maxZoom);
      expect(z).toBeGreaterThanOrEqual(0);
    });

    it('finer cells (more nodes) demand a higher or equal zoom', () => {
      const coarse = chooseZoom(center, sizeMeters, 256, 22);
      const fine = chooseZoom(center, sizeMeters, 2048, 22);
      expect(fine).toBeGreaterThanOrEqual(coarse);
    });
  });
});

describe('chooseSatelliteZoom', () => {
  describe.each(CENTERS)('$name', ({ center }) => {
    it('stays within the requested tile budget at the chosen zoom', () => {
      const sizeMeters = 4000;
      const maxTiles = 100;
      const maxZoom = 18;
      const minZoom = 12;
      const z = chooseSatelliteZoom(center, sizeMeters, maxTiles, maxZoom, minZoom);

      expect(z).toBeGreaterThanOrEqual(minZoom);
      expect(z).toBeLessThanOrEqual(maxZoom);

      const latScale = Math.cos((center.lat * Math.PI) / 180);
      const groundPerTile = (WORLD_SIZE / Math.pow(2, z)) * latScale;
      const perSide = Math.ceil(sizeMeters / groundPerTile) + 1;
      // Either we are within budget, or we bottomed out at minZoom.
      expect(perSide * perSide <= maxTiles || z === minZoom).toBe(true);
    });

    it('a larger area needs a coarser (lower or equal) zoom for the same budget', () => {
      const small = chooseSatelliteZoom(center, 2000, 100, 18, 8);
      const large = chooseSatelliteZoom(center, 20000, 100, 18, 8);
      expect(large).toBeLessThanOrEqual(small);
    });
  });
});
