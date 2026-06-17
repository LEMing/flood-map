// Pure-function tests for the subsurface column builder. These exercise only
// the data-driven, synchronous exports (no CRUST1.0 fetch, no SoilGrids, no
// rendering) by feeding a hand-built Crust1Cell and asserting the structural
// invariants every assembled column must satisfy.

import { describe, it, expect } from 'vitest';
import {
  buildColumns,
  buildRegionalColumns,
  buildMarineRegionalColumns,
  findRegional,
  findRegionalMarine,
  defaultColumns,
  type GeoColumn,
  type GeoLayer,
} from './geology';
import { L, type Crust1Cell } from './crust1';
import { REGIONAL_COLUMNS, type RegionalColumn } from './data/regionalColumns';
import { REGIONAL_MARINE_COLUMNS } from './data/regionalMarineColumns';

// A deterministic land-ish cell. bnd holds layer-top elevations (m, + up),
// indexed by L. surfaceElevM sits above sea level; the boundaries descend
// monotonically so depth() below the surface is positive and increasing.
//   water/ice/sed-top = 100 m (surface), then sediments and crust descend to
//   a Moho at -34 900 m (35 km below the 100 m surface).
function makeLandCell(): Crust1Cell {
  const bnd: number[] = [];
  bnd[L.water] = 100;
  bnd[L.ice] = 100;
  bnd[L.upperSed] = 100; // seabed/sediment top
  bnd[L.midSed] = 50;
  bnd[L.lowSed] = 0;
  bnd[L.upperCrust] = -400; // 500 m below surface
  bnd[L.midCrust] = -11900; // 12 km below surface
  bnd[L.lowerCrust] = -21900; // 22 km
  bnd[L.moho] = -34900; // 35 km
  return { isOcean: false, bnd, surfaceElevM: bnd[L.water], mohoElevM: bnd[L.moho] };
}

// A deterministic ocean cell: surface at sea level, a 4 km water column above
// a seabed at -4000 m, then sediments and crust down to a 9 km-deep Moho.
function makeOceanCell(): Crust1Cell {
  const bnd: number[] = [];
  bnd[L.water] = 0; // sea surface
  bnd[L.ice] = -4000; // top of water column below ice == seabed water base
  bnd[L.upperSed] = -4000; // seabed (top of sediments)
  bnd[L.midSed] = -4200;
  bnd[L.lowSed] = -4400;
  bnd[L.upperCrust] = -4600; // 600 m of sediment below the seabed
  bnd[L.midCrust] = -7000;
  bnd[L.lowerCrust] = -10000;
  bnd[L.moho] = -13000; // 9 km below the seabed
  return { isOcean: true, bnd, surfaceElevM: bnd[L.water], mohoElevM: bnd[L.moho] };
}

const realSoil: GeoLayer[] = [
  { key: 'topsoil', topM: 0, botM: 0.25, hex: 0x111111, source: 'soilgrids' },
  { key: 'subsoil', topM: 0.25, botM: 1.5, hex: 0x222222, source: 'soilgrids' },
];

// The global invariant every assembled column must satisfy: layers start at the
// surface (0), each layer is non-empty (topM < botM), and depths are strictly
// increasing and non-overlapping (each top >= the previous bottom). The single
// junction allowed to be a *step* rather than a perfect abut is the soil→region
// boundary inside buildRegionalColumns, where the region's published top can sit
// below the soil base — hence ">=" here. The stricter "abuts exactly" form is
// asserted separately for the model land column where it genuinely holds.
function expectOrdered(col: GeoColumn): void {
  const { layers } = col;
  expect(layers.length).toBeGreaterThan(0);
  expect(layers[0].topM).toBe(0);
  let prevBot = 0;
  for (const l of layers) {
    expect(l.topM).toBeGreaterThanOrEqual(prevBot); // non-overlapping
    expect(l.botM).toBeGreaterThan(l.topM); // strictly increasing, non-empty
    prevBot = l.botM;
  }
}

// Stricter form: consecutive layers abut with no gap at all. True for the
// CRUST1.0 land/marine columns where every boundary is chained through ordered().
function expectAbutsExactly(col: GeoColumn): void {
  let prevBot = 0;
  for (const l of col.layers) {
    expect(l.topM).toBe(prevBot);
    prevBot = l.botM;
  }
}

describe('geology — depth-ordering invariant', () => {
  it('land + marine columns from buildColumns are ordered and abut exactly', () => {
    const cols = buildColumns(makeLandCell(), realSoil, false);
    expectOrdered(cols.land);
    expectOrdered(cols.marine);
    expectAbutsExactly(cols.land); // model column chains every boundary
    expectAbutsExactly(cols.marine);
  });

  it('defaultColumns (model fallback cell) is ordered', () => {
    const cols = defaultColumns();
    expectOrdered(cols.land);
    expectOrdered(cols.marine);
  });

  it('regional land + marine columns are ordered', () => {
    const cell = makeLandCell();
    const regional = buildRegionalColumns(REGIONAL_COLUMNS[0], realSoil, cell);
    expectOrdered(regional.land);
    expectOrdered(regional.marine);

    const marine = buildMarineRegionalColumns(REGIONAL_MARINE_COLUMNS[0], makeOceanCell());
    expectOrdered(marine.land);
    expectOrdered(marine.marine);
  });
});

describe('geology — buildColumns soil splicing', () => {
  it('splices the real soil layers on top when soil is provided', () => {
    const cols = buildColumns(makeLandCell(), realSoil, false);
    expect(cols.land.soilReal).toBe(true);

    const keys = cols.land.layers.map((l) => l.key);
    expect(keys.slice(0, 2)).toEqual(['topsoil', 'subsoil']);
    expect(cols.land.layers[0].source).toBe('soilgrids');
    expect(cols.land.layers[1].source).toBe('soilgrids');

    // The deep model layers begin exactly at the base of the real soil (1.5 m),
    // not at the model default (2 m).
    const sediments = cols.land.layers.find((l) => l.key === 'sediments');
    expect(sediments?.topM).toBe(realSoil[1].botM);
  });

  it('falls back to model topsoil/subsoil when soil is null', () => {
    const cols = buildColumns(makeLandCell(), null, false);
    expect(cols.land.soilReal).toBe(false);

    const top = cols.land.layers.slice(0, 2);
    expect(top.map((l) => l.key)).toEqual(['topsoil', 'subsoil']);
    expect(top.every((l) => l.source === 'model')).toBe(true);
    expect(top[0].botM).toBe(0.3); // model topsoil base
    expect(top[1].botM).toBe(2); // model subsoil base

    // Deep structure starts where the model subsoil ends.
    const sediments = cols.land.layers.find((l) => l.key === 'sediments');
    expect(sediments?.topM).toBe(2);
  });

  it('treats an empty soil array as "no real soil"', () => {
    const cols = buildColumns(makeLandCell(), [], false);
    expect(cols.land.soilReal).toBe(false);
    expect(cols.land.layers[0].key).toBe('topsoil');
    expect(cols.land.layers[0].source).toBe('model');
  });

  it('always ends the land column with a mantle band below the Moho', () => {
    const cols = buildColumns(makeLandCell(), realSoil, false);
    const last = cols.land.layers[cols.land.layers.length - 1];
    expect(last.key).toBe('mantle');
    // 35 km surface-to-Moho depth, then a 30 km mantle band.
    expect(last.topM).toBeCloseTo(35000, 0);
    expect(last.botM).toBeCloseTo(65000, 0);
  });
});

describe('geology — buildRegionalColumns', () => {
  it('puts soil on top, then the region layers starting at the soil base', () => {
    const region = REGIONAL_COLUMNS[0];
    const cols = buildRegionalColumns(region, realSoil, makeLandCell());

    expect(cols.regionName).toBe(region.name);
    expect(cols.isOcean).toBe(false);
    expect(cols.oceanWaterDepthM).toBe(0);
    expect(cols.land.soilReal).toBe(true);

    // First two layers are the real soil…
    expect(cols.land.layers.slice(0, 2).map((l) => l.key)).toEqual(['topsoil', 'subsoil']);

    // …and the first named region layer immediately follows. Its top is
    // max(published top, soil base): the region is clamped to never overlap the
    // real soil, but if its own published top is deeper it keeps that.
    const firstRegion = cols.land.layers[2];
    const soilBase = realSoil[1].botM;
    expect(firstRegion.source).toBe('regional');
    expect(firstRegion.name).toBe(region.layers[0].name);
    expect(firstRegion.topM).toBe(Math.max(region.layers[0].topM, soilBase));
    expect(firstRegion.topM).toBeGreaterThanOrEqual(soilBase); // never overlaps the soil

    // Every region layer carries its published display name.
    const regionLayers = cols.land.layers.filter((l) => l.source === 'regional');
    expect(regionLayers.length).toBe(region.layers.length);
    expect(regionLayers.map((l) => l.name)).toEqual(region.layers.map((l) => l.name));
  });

  it('uses the model soil when soil is null but still names region layers', () => {
    const region = REGIONAL_COLUMNS[0];
    const cols = buildRegionalColumns(region, null, makeLandCell());
    expect(cols.land.soilReal).toBe(false);
    expect(cols.land.layers.slice(0, 2).every((l) => l.source === 'model')).toBe(true);
    // Region layers start at the model soil base (2 m).
    expect(cols.land.layers[2].topM).toBe(2);
  });
});

describe('geology — buildMarineRegionalColumns', () => {
  it('puts the published sub-seabed units in the marine column from depth 0', () => {
    const region = REGIONAL_MARINE_COLUMNS[0];
    const cell = makeOceanCell();
    const cols = buildMarineRegionalColumns(region, cell);

    expect(cols.regionName).toBe(region.name);
    expect(cols.isOcean).toBe(true);
    expect(cols.marine.layers[0].topM).toBe(0);
    expect(cols.marine.layers.every((l) => l.source === 'regional')).toBe(true);
    expect(cols.marine.layers.map((l) => l.name)).toEqual(region.layers.map((l) => l.name));

    // Land column is the CRUST1.0 fallback (model soil, not real).
    expect(cols.land.soilReal).toBe(false);
    expect(cols.land.layers[0].source).toBe('model');

    // Ocean water depth = water-top minus ice-top of the cell (4 km here).
    expect(cols.oceanWaterDepthM).toBe(cell.bnd[L.water] - cell.bnd[L.ice]);
    expect(cols.oceanWaterDepthM).toBe(4000);
  });
});

describe('geology — isOcean / oceanWaterDepthM', () => {
  it('reports no water depth for a land centre', () => {
    const cols = buildColumns(makeOceanCell(), realSoil, false);
    expect(cols.isOcean).toBe(false);
    expect(cols.oceanWaterDepthM).toBe(0); // land centre => no water, regardless of cell water column
  });

  it('reports the CRUST1.0 water thickness for an ocean centre', () => {
    const cell = makeOceanCell();
    const cols = buildColumns(cell, null, true);
    expect(cols.isOcean).toBe(true);
    expect(cols.oceanWaterDepthM).toBe(cell.bnd[L.water] - cell.bnd[L.ice]);
    expect(cols.oceanWaterDepthM).toBe(4000);
  });

  it('clamps a negative water column to zero', () => {
    const cell = makeLandCell(); // water-top == ice-top => zero thickness
    const cols = buildColumns(cell, null, true);
    expect(cols.oceanWaterDepthM).toBe(0);
  });
});

describe('geology — findRegional / findRegionalMarine (smallest bbox wins)', () => {
  const bboxArea = (b: RegionalColumn['bbox']): number => (b[1] - b[0]) * (b[3] - b[2]);
  const contains = (b: RegionalColumn['bbox'], lat: number, lon: number): boolean =>
    lat >= b[0] && lat <= b[1] && lon >= b[2] && lon <= b[3];

  it('returns the smaller bbox when a point lies inside two overlapping land regions', () => {
    // (12.55, 78.75) is inside both Cauvery Basin (area ~9.4) and the larger
    // Eastern Dharwar Craton (area ~26); the smaller, more specific one wins.
    const lat = 12.55;
    const lon = 78.75;
    const cauvery = REGIONAL_COLUMNS.find((c) => c.name === 'Cauvery Basin');
    const dharwar = REGIONAL_COLUMNS.find(
      (c) => c.name === 'Eastern Dharwar Craton' && bboxArea(c.bbox) > 20,
    );
    expect(cauvery && contains(cauvery.bbox, lat, lon)).toBe(true);
    expect(dharwar && contains(dharwar.bbox, lat, lon)).toBe(true);
    expect(bboxArea(cauvery!.bbox)).toBeLessThan(bboxArea(dharwar!.bbox));

    const hit = findRegional(lat, lon);
    expect(hit?.name).toBe('Cauvery Basin');
  });

  it('returns the smaller bbox for an overlapping marine point', () => {
    // (35.35, 139.7) is inside both Tokyo Bay & Sagami (small) and the much
    // larger Sea of Japan box; the bay wins.
    const lat = 35.35;
    const lon = 139.7;
    const hit = findRegionalMarine(lat, lon);
    expect(hit?.name).toBe('Tokyo Bay & Sagami');
  });

  it('the data is sorted smallest-bbox-first so first-match == smallest-match', () => {
    // The whole "smallest wins" guarantee rests on this ordering of the array,
    // since lookup returns the first box that contains the point.
    const verifySorted = (cols: RegionalColumn[]): void => {
      for (let i = 1; i < cols.length; i++) {
        expect(bboxArea(cols[i].bbox)).toBeGreaterThanOrEqual(bboxArea(cols[i - 1].bbox));
      }
    };
    verifySorted(REGIONAL_COLUMNS);
    verifySorted(REGIONAL_MARINE_COLUMNS);
  });

  it('returns null for a point outside every region', () => {
    // Mid–South Pacific: no published land or marine column covers it.
    expect(findRegional(-40, -150)).toBeNull();
    expect(findRegionalMarine(-40, -150)).toBeNull();
  });
});
