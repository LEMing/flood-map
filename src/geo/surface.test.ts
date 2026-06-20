// Unit tests for the pure surface-field logic in surface.ts. Three functions are
// exercised, none of which touch the network/DOM/WebGL (buildSurface, which fetches
// land cover + OSM, is left to integration tests):
//   - classifyInfilRoughness: the land-cover/OSM -> infiltration/Manning-n branch table
//   - computeSurfaceFields:    packs the per-cell RGBA32F surface texture
//   - burnHeights:             mutates the DEM (buildings +5 m, roads -0.15 m)
// We test each in isolation with tiny hand-built rasters and assert the exact values
// the classification rules in surface.ts are meant to produce.

import { describe, it, expect } from 'vitest';
import { computeSurfaceFields, classifyInfilRoughness, burnHeights, computeSewerFields } from './surface';
import type { Heightmap, LatLon } from './heightmap';
import type { LandClass } from './landcover';
import type { OsmRasters } from './osm';
import { lonLatToLocalMeters } from './projection';
import { DEFAULT_PARAMS, type Params } from '../config';

// Mirror of the private constant in surface.ts: mm/hr -> m/s.
const MM_S = 1 / 1000 / 3600;

// Land-cover class codes used by ESA WorldCover (see landcover.ts).
const LC_TREE = 10;
const LC_GRASSLAND = 30;
const LC_CROPLAND = 40;
const LC_BUILT_UP = 50;
const LC_BARE = 60;
const LC_WATER = 80;

const N = 8;
const SIZE_METERS = 70; // step = 10 m between the 8 nodes

// Far from the hard-coded "no storm sewer" zone in surface.ts
// (Музыкальный микрорайон, lat 45.0762 / lon 38.9988), so every urban cell in
// the grid is "served" and receives the full drainage capacity. A test below
// asserts this separation holds for the whole grid.
const CENTER: LatLon = { lat: 48.8566, lon: 2.3522 }; // central Paris

function makeHeightmap(): Heightmap {
  return {
    data: new Float32Array(N * N), // flat — computeSurfaceFields never reads it
    N,
    sizeMeters: SIZE_METERS,
    center: CENTER,
    min: 0,
    max: 0,
    synthetic: true,
  };
}

function emptyOsm(): OsmRasters {
  return {
    building: new Uint8Array(N * N),
    road: new Uint8Array(N * N),
    water: new Uint8Array(N * N),
    green: new Uint8Array(N * N),
    buildings: [],
    counts: { buildings: 0, roads: 0 },
  };
}

function idx(ix: number, iy: number): number {
  return iy * N + ix;
}

// Channel layout of the surface texture (N*N*4): r=infil m/s, g=drain m/s,
// b=Manning n, a=building flag.
function cell(surface: Float32Array, k: number) {
  return {
    infil: surface[k * 4],
    drain: surface[k * 4 + 1],
    manningN: surface[k * 4 + 2],
    building: surface[k * 4 + 3],
  };
}

function withParams(overrides: Partial<Params>): Params {
  return { ...DEFAULT_PARAMS, ...overrides };
}

describe('computeSurfaceFields', () => {
  it('returns an N*N*4 array of finite values in plausible ranges', () => {
    const hm = makeHeightmap();
    const land: LandClass = new Uint8Array(N * N).fill(LC_GRASSLAND);
    const surface = computeSurfaceFields(hm, land, emptyOsm(), withParams({}));

    expect(surface.length).toBe(N * N * 4);

    for (let k = 0; k < N * N; k++) {
      const c = cell(surface, k);
      expect(Number.isFinite(c.infil)).toBe(true);
      expect(Number.isFinite(c.drain)).toBe(true);
      expect(Number.isFinite(c.manningN)).toBe(true);
      expect(c.infil).toBeGreaterThanOrEqual(0);
      expect(c.drain).toBeGreaterThanOrEqual(0);
      // Manning n is clamped to [0.01, 0.6] in surface.ts
      expect(c.manningN).toBeGreaterThanOrEqual(0.01);
      expect(c.manningN).toBeLessThanOrEqual(0.6);
      // building flag is strictly 0 or 1
      expect(c.building === 0 || c.building === 1).toBe(true);
    }
  });

  it('works with no land cover and no OSM (defaults all cells to grassland)', () => {
    const hm = makeHeightmap();
    const params = withParams({ groundwaterHigh: false, infiltrationMmPerHr: 12 });
    const surface = computeSurfaceFields(hm, null, null, params);

    // lc defaults to 30 (grassland) -> pervious soil infiltration, Manning n 0.20.
    const expectedInfil = 12 * MM_S;
    for (let k = 0; k < N * N; k++) {
      const c = cell(surface, k);
      expect(c.infil).toBeCloseTo(expectedInfil, 12);
      expect(c.manningN).toBeCloseTo(0.20, 6);
      expect(c.drain).toBe(0); // grassland is not urban -> no storm sewer
      expect(c.building).toBe(0);
    }
  });

  it('classifies each land-cover / OSM feature with its expected fields', () => {
    const hm = makeHeightmap();
    const params = withParams({
      groundwaterHigh: false,
      infiltrationMmPerHr: 10,
      drainageCapacityMmPerHr: 8,
    });
    const soilInfil = 10; // groundwaterHigh=false -> no 0.25 scaling

    const land: LandClass = new Uint8Array(N * N).fill(LC_GRASSLAND);
    const osm = emptyOsm();

    const kBuilding = idx(1, 1);
    const kRoad = idx(2, 2);
    const kWaterOsm = idx(3, 3);
    const kBuiltUp = idx(4, 4);
    const kWaterLc = idx(5, 5);
    const kCropland = idx(6, 6);
    const kBare = idx(0, 7);
    const kTree = idx(7, 0);

    osm.building[kBuilding] = 1;
    osm.road[kRoad] = 1;
    osm.water[kWaterOsm] = 1;
    land[kBuiltUp] = LC_BUILT_UP;
    land[kWaterLc] = LC_WATER;
    land[kCropland] = LC_CROPLAND;
    land[kBare] = LC_BARE;
    land[kTree] = LC_TREE;

    const surface = computeSurfaceFields(hm, land, osm, params);

    // Served urban cells get a NONZERO drain (the exact value is now scaled by the
    // synthetic flow-accumulation area weight — see the param-scaling test for that).
    // Building: impervious-ish infil 0.2, paved n 0.013, building flag set, served drain.
    const building = cell(surface, kBuilding);
    expect(building.infil).toBeCloseTo(0.2 * MM_S, 12);
    expect(building.manningN).toBeCloseTo(0.013, 6);
    expect(building.building).toBe(1);
    expect(building.drain).toBeGreaterThan(0);

    // OSM road: infil 0.3, paved n 0.013, urban -> served drain, not a building.
    const road = cell(surface, kRoad);
    expect(road.infil).toBeCloseTo(0.3 * MM_S, 12);
    expect(road.manningN).toBeCloseTo(0.013, 6);
    expect(road.building).toBe(0);
    expect(road.drain).toBeGreaterThan(0);

    // OSM water: no infiltration, low n 0.03, NOT urban -> no drain.
    const waterOsm = cell(surface, kWaterOsm);
    expect(waterOsm.infil).toBe(0);
    expect(waterOsm.manningN).toBeCloseTo(0.03, 6);
    expect(waterOsm.drain).toBe(0);
    expect(waterOsm.building).toBe(0);

    // Built-up land cover (lc=50): infil 0.5, paved n 0.013, urban -> served drain.
    const builtUp = cell(surface, kBuiltUp);
    expect(builtUp.infil).toBeCloseTo(0.5 * MM_S, 12);
    expect(builtUp.manningN).toBeCloseTo(0.013, 6);
    expect(builtUp.drain).toBeGreaterThan(0);
    expect(builtUp.building).toBe(0);

    // Water land cover (lc=80): same no-infiltration behaviour as OSM water.
    const waterLc = cell(surface, kWaterLc);
    expect(waterLc.infil).toBe(0);
    expect(waterLc.manningN).toBeCloseTo(0.03, 6);
    expect(waterLc.drain).toBe(0);

    // Cropland (lc=40): infil = soil * 0.6, cultivated n 0.10, not urban.
    const cropland = cell(surface, kCropland);
    expect(cropland.infil).toBeCloseTo(soilInfil * 0.6 * MM_S, 12);
    expect(cropland.manningN).toBeCloseTo(0.10, 6);
    expect(cropland.drain).toBe(0);

    // Bare (lc=60): infil = soil * 0.4, bare-soil n 0.04, not urban.
    const bare = cell(surface, kBare);
    expect(bare.infil).toBeCloseTo(soilInfil * 0.4 * MM_S, 12);
    expect(bare.manningN).toBeCloseTo(0.04, 6);
    expect(bare.drain).toBe(0);

    // Tree (lc=10): full soil infiltration, woods n 0.40.
    const tree = cell(surface, kTree);
    expect(tree.infil).toBeCloseTo(soilInfil * MM_S, 12);
    expect(tree.manningN).toBeCloseTo(0.40, 6);
    expect(tree.drain).toBe(0);
  });

  it('building flag wins over road/water and stamps the building infil', () => {
    const hm = makeHeightmap();
    const land: LandClass = new Uint8Array(N * N).fill(LC_GRASSLAND);
    const osm = emptyOsm();
    const k = idx(3, 4);

    // Same cell is tagged building AND road AND water: building must win.
    osm.building[k] = 1;
    osm.road[k] = 1;
    osm.water[k] = 1;

    const surface = computeSurfaceFields(hm, land, osm, withParams({}));
    const c = cell(surface, k);
    expect(c.building).toBe(1);
    expect(c.infil).toBeCloseTo(0.2 * MM_S, 12); // building infil, not road(0.3)/water(0)
    expect(c.manningN).toBeCloseTo(0.013, 6);
  });

  it('puts the soil Ks straight into the field — groundwater acts via suction S, not here', () => {
    const hm = makeHeightmap();
    const land: LandClass = new Uint8Array(N * N).fill(LC_GRASSLAND);

    const dry = computeSurfaceFields(
      hm, land, null, withParams({ groundwaterHigh: false, infiltrationMmPerHr: 12 }),
    );
    const wet = computeSurfaceFields(
      hm, land, null, withParams({ groundwaterHigh: true, infiltrationMmPerHr: 12 }),
    );

    const k = idx(0, 0);
    expect(dry[k * 4]).toBeCloseTo(12 * MM_S, 12); // pervious grassland → full Ks
    expect(wet[k * 4]).toBeCloseTo(12 * MM_S, 12); // unchanged: high groundwater no longer cuts Ks here
  });

  it('drainage tracks the storm-sewer capacity param for served urban cells', () => {
    const hm = makeHeightmap();
    const land: LandClass = new Uint8Array(N * N).fill(LC_BUILT_UP); // all urban
    const osm = emptyOsm();

    const low = computeSurfaceFields(hm, land, osm, withParams({ drainageCapacityMmPerHr: 5 }));
    const high = computeSurfaceFields(hm, land, osm, withParams({ drainageCapacityMmPerHr: 20 }));

    // Same cell, same DEM → the synthetic area weight cancels, so the drain scales
    // exactly with the storm-sewer capacity param (20/5 = 4×).
    const k = idx(4, 4);
    expect(low[k * 4 + 1]).toBeGreaterThan(0);
    expect(high[k * 4 + 1]).toBeCloseTo(low[k * 4 + 1] * 4, 9);
    expect(high[k * 4 + 1]).toBeGreaterThan(low[k * 4 + 1]);
  });

  it('water cells never drain even when land cover marks them built-up-adjacent', () => {
    const hm = makeHeightmap();
    // Whole grid is water by land cover; nothing should get a storm sewer.
    const land: LandClass = new Uint8Array(N * N).fill(LC_WATER);
    const surface = computeSurfaceFields(hm, land, null, withParams({ drainageCapacityMmPerHr: 8 }));

    for (let k = 0; k < N * N; k++) {
      const c = cell(surface, k);
      expect(c.infil).toBe(0);
      expect(c.drain).toBe(0);
    }
  });

  it('keeps this synthetic grid entirely outside the hard-coded no-drain zone', () => {
    // Guards the assumption behind every "served drain" assertion above: the
    // Paris-centred grid must be far from Музыкальный микрорайон's no-sewer disc.
    const hm = makeHeightmap();
    const NO_DRAIN_CENTER = { lat: 45.0762, lon: 38.9988 };
    const NO_DRAIN_RADIUS_M = 1300;
    const [mzx, mzy] = lonLatToLocalMeters(hm.center, NO_DRAIN_CENTER.lon, NO_DRAIN_CENTER.lat);
    const half = SIZE_METERS / 2;
    const step = SIZE_METERS / (N - 1);

    for (let iy = 0; iy < N; iy++) {
      const cy = -half + iy * step;
      for (let ix = 0; ix < N; ix++) {
        const cx = -half + ix * step;
        const dist2 = (cx - mzx) ** 2 + (cy - mzy) ** 2;
        expect(dist2).toBeGreaterThan(NO_DRAIN_RADIUS_M ** 2);
      }
    }
  });
});

describe('classifyInfilRoughness', () => {
  // soilInfil is the only "free" input (the rest are class flags / codes); pick a
  // distinctive value so soil-scaled branches are unambiguous in the assertions.
  const SOIL = 11;

  it('building wins over every other flag — impervious-ish, paved Manning n', () => {
    // Building set together with road, water, green and a built-up code: the first
    // branch must short-circuit so none of the later branches can change the result.
    expect(classifyInfilRoughness(true, true, true, true, LC_BUILT_UP, SOIL)).toEqual({ infil: 0.2, manningN: 0.013 });
  });

  it('water (OSM flag or lc=80) has zero infiltration and low n', () => {
    expect(classifyInfilRoughness(false, false, true, false, LC_GRASSLAND, SOIL))
      .toEqual({ infil: 0.0, manningN: 0.03 });
    expect(classifyInfilRoughness(false, false, false, false, LC_WATER, SOIL)).toEqual({ infil: 0.0, manningN: 0.03 });
  });

  it('water outranks road and green (checked before them)', () => {
    expect(classifyInfilRoughness(false, true, true, true, LC_GRASSLAND, SOIL)).toEqual({ infil: 0.0, manningN: 0.03 });
  });

  it('road (when not a building) is slightly pervious and paved-smooth', () => {
    expect(classifyInfilRoughness(false, true, false, false, LC_GRASSLAND, SOIL))
      .toEqual({ infil: 0.3, manningN: 0.013 });
  });

  it.each([
    ['tree', LC_TREE, 0.40],
    ['shrub', 20, 0.25],
    ['wetland', 90, 0.30],
    ['moss', 100, 0.15],
    ['grassland', LC_GRASSLAND, 0.20],
  ])('vegetation %s passes full soil infiltration with its Engman overland n', (_label, lc, n) => {
    expect(classifyInfilRoughness(false, false, false, false, lc, SOIL)).toEqual({ infil: SOIL, manningN: n });
  });

  it('the OSM green flag forces the grassland branch regardless of land-cover code', () => {
    // lc=60 (bare) would otherwise give soil*0.4 / n 0.04; the green flag overrides it.
    expect(classifyInfilRoughness(false, false, false, true, LC_BARE, SOIL)).toEqual({ infil: SOIL, manningN: 0.20 });
  });

  it('cropland (lc=40) infiltrates at 60% of soil with cultivated n', () => {
    expect(classifyInfilRoughness(false, false, false, false, LC_CROPLAND, SOIL))
      .toEqual({ infil: SOIL * 0.6, manningN: 0.10 });
  });

  it('built-up land cover (lc=50) is impervious with paved n', () => {
    expect(classifyInfilRoughness(false, false, false, false, LC_BUILT_UP, SOIL))
      .toEqual({ infil: 0.5, manningN: 0.013 });
  });

  it('bare ground (lc=60) infiltrates at 40% of soil with mid-range bare-soil n', () => {
    expect(classifyInfilRoughness(false, false, false, false, LC_BARE, SOIL))
      .toEqual({ infil: SOIL * 0.4, manningN: 0.04 });
  });

  it.each([
    ['snow/ice', 70],
    ['mangrove', 95],
    ['nodata/zero', 0],
    ['unknown high code', 255],
  ])('unhandled land-cover code %s falls through to the default (soil*0.5, n 0.10)', (_label, lc) => {
    expect(classifyInfilRoughness(false, false, false, false, lc, SOIL)).toEqual({ infil: SOIL * 0.5, manningN: 0.10 });
  });

  it('infiltration scales linearly with soilInfil on every soil-dependent branch', () => {
    const soilBranches: Array<[number, number]> = [
      [LC_GRASSLAND, 1.0], // pervious vegetation -> soil * 1
      [LC_CROPLAND, 0.6],
      [LC_BARE, 0.4],
      [70, 0.5], // default branch
    ];
    for (const [lc, factor] of soilBranches) {
      const a = classifyInfilRoughness(false, false, false, false, lc, 4);
      const b = classifyInfilRoughness(false, false, false, false, lc, 40);
      expect(a.infil).toBeCloseTo(4 * factor, 12);
      expect(b.infil).toBeCloseTo(40 * factor, 12);
      expect(b.infil).toBeCloseTo(a.infil * 10, 12); // 10x soil -> 10x infil
    }
  });

  it('default branch is reachable through computeSurfaceFields with an exotic land code', () => {
    const hm = makeHeightmap();
    const land: LandClass = new Uint8Array(N * N).fill(70); // snow/ice: no explicit rule
    const params = withParams({ groundwaterHigh: false, infiltrationMmPerHr: 10 });
    const surface = computeSurfaceFields(hm, land, null, params);
    const c = cell(surface, idx(2, 3));
    expect(c.infil).toBeCloseTo(10 * 0.5 * MM_S, 12); // soil * 0.5 from the default branch
    expect(c.manningN).toBeCloseTo(0.10, 6);
    expect(c.drain).toBe(0); // snow/ice is not urban
    expect(c.building).toBe(0);
  });
});

describe('burnHeights', () => {
  const BUILDING_RAISE_M = 5;
  const ROAD_LOWER_M = 0.15;

  function flatHeightmap(value: number): Heightmap {
    const hm = makeHeightmap();
    hm.data = new Float32Array(N * N).fill(value);
    return hm;
  }

  it('raises building cells by exactly +5 m and leaves bare ground untouched', () => {
    const hm = flatHeightmap(100);
    const osm = emptyOsm();
    const kBuilding = idx(2, 2);
    const kBare = idx(5, 5);
    osm.building[kBuilding] = 1;

    burnHeights(hm, osm, true);

    expect(hm.data[kBuilding]).toBeCloseTo(100 + BUILDING_RAISE_M, 5);
    expect(hm.data[kBare]).toBe(100); // unaffected
  });

  it('lowers road cells by exactly -0.15 m (curb-to-crown channel)', () => {
    const hm = flatHeightmap(50);
    const osm = emptyOsm();
    const kRoad = idx(3, 4);
    osm.road[kRoad] = 1;

    burnHeights(hm, osm, true);

    expect(hm.data[kRoad]).toBeCloseTo(50 - ROAD_LOWER_M, 5);
  });

  it('building takes precedence over road on the same cell (else-if, no double burn)', () => {
    const hm = flatHeightmap(0);
    const osm = emptyOsm();
    const k = idx(1, 1);
    osm.building[k] = 1;
    osm.road[k] = 1;

    burnHeights(hm, osm, true);

    // Only the building raise applies; the road lowering is in the else branch.
    expect(hm.data[k]).toBeCloseTo(BUILDING_RAISE_M, 5);
  });

  it('with burnBuildings=false, buildings are skipped but a road under them still lowers', () => {
    const hm = flatHeightmap(10);
    const osm = emptyOsm();
    const kBuildingOnly = idx(2, 0);
    const kBuildingAndRoad = idx(4, 4);
    osm.building[kBuildingOnly] = 1;
    osm.building[kBuildingAndRoad] = 1;
    osm.road[kBuildingAndRoad] = 1;

    burnHeights(hm, osm, false);

    // Building-only cell: the building branch is gated off, no road -> unchanged.
    expect(hm.data[kBuildingOnly]).toBe(10);
    // Building+road cell: building gated off means the else-if road branch fires.
    expect(hm.data[kBuildingAndRoad]).toBeCloseTo(10 - ROAD_LOWER_M, 5);
  });

  it('mutates in place and only touches flagged cells', () => {
    const base = 7;
    const hm = flatHeightmap(base);
    const osm = emptyOsm();
    const kB = idx(0, 0);
    const kR = idx(7, 7);
    osm.building[kB] = 1;
    osm.road[kR] = 1;

    const returned = burnHeights(hm, osm, true);
    expect(returned).toBeUndefined(); // mutates, returns nothing

    let changed = 0;
    for (let k = 0; k < N * N; k++) {
      if (hm.data[k] !== base) changed++;
    }
    expect(changed).toBe(2); // exactly the two flagged cells
  });

  it('is additive: total elevation change equals raises minus lowerings', () => {
    const hm = flatHeightmap(0);
    const osm = emptyOsm();
    osm.building[idx(0, 0)] = 1;
    osm.building[idx(1, 0)] = 1; // two buildings -> +2*5
    osm.road[idx(2, 0)] = 1;
    osm.road[idx(3, 0)] = 1;
    osm.road[idx(4, 0)] = 1; // three roads -> -3*0.15

    burnHeights(hm, osm, true);

    let sum = 0;
    for (let k = 0; k < N * N; k++) sum += hm.data[k];
    expect(sum).toBeCloseTo(2 * BUILDING_RAISE_M - 3 * ROAD_LOWER_M, 4);
  });
});

describe('computeSewerFields', () => {
  // Elevation falls due east (-x), so every cell drains east; the east edge has no
  // lower neighbour (boundary pits), and one carved interior hole is a closed pit.
  function tiltedHeightmap(): Heightmap {
    const data = new Float32Array(N * N);
    for (let k = 0; k < N * N; k++) data[k] = -(k % N);
    data[idx(4, 4)] = -100; // a deep interior pit
    return { ...makeHeightmap(), data };
  }

  function sewerCell(sewer: Float32Array, k: number) {
    return { cap: sewer[k * 4], dirX: sewer[k * 4 + 1], dirY: sewer[k * 4 + 2], outfall: sewer[k * 4 + 3] };
  }

  const sewer = computeSewerFields(tiltedHeightmap(), emptyOsm(), new Float32Array(N * N * 4));

  it('routes an interior cell to its D8 downstream neighbour, never an outfall', () => {
    const c = sewerCell(sewer, idx(2, 1));
    expect([c.dirX, c.dirY]).toEqual([1, 0]); // due east
    expect(c.outfall).toBe(0);
  });

  it('discharges at a boundary pit — an edge cell with no lower neighbour', () => {
    const c = sewerCell(sewer, idx(N - 1, 3));
    expect([c.dirX, c.dirY]).toEqual([0, 0]);
    expect(c.outfall).toBe(1);
  });

  it('routes an edge cell inward when it still has a downstream, instead of dumping off-map', () => {
    const c = sewerCell(sewer, idx(3, 0)); // north edge, drains east into the domain
    expect([c.dirX, c.dirY]).toEqual([1, 0]);
    expect(c.outfall).toBe(0);
  });

  it('surcharges an interior pit in place — dir 0, no outfall', () => {
    const c = sewerCell(sewer, idx(4, 4));
    expect([c.dirX, c.dirY]).toEqual([0, 0]);
    expect(c.outfall).toBe(0);
  });

  it('encodes every routing direction as a unit D8 step', () => {
    for (let k = 0; k < N * N; k++) {
      const c = sewerCell(sewer, k);
      expect(Math.abs(c.dirX)).toBeLessThanOrEqual(1);
      expect(Math.abs(c.dirY)).toBeLessThanOrEqual(1);
    }
  });
});
