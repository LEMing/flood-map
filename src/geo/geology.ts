// Global, data-driven subsurface column. The deep structure (sediments →
// crust → Moho) comes from the bundled CRUST1.0 model per lon/lat; the real
// top ~2 m on land comes from a live SoilGrids query (soilgrids.ts). Each cell
// is land or ocean, so we build BOTH a land and a marine column and let the
// cross-section blend them per wall column by surface elevation. Layer names
// are generic/scientific so they localize cleanly and read honestly anywhere.

import { L, type Crust1Cell } from './crust1';
import { REGIONAL_COLUMNS, type RegionalColumn } from './data/regionalColumns';
import { REGIONAL_MARINE_COLUMNS } from './data/regionalMarineColumns';

export type GeoSource = 'soilgrids' | 'crust1' | 'regional' | 'model';

export interface GeoLayer {
  key: string; // i18n suffix: t('geo.l.' + key)
  topM: number; // depth below the local surface (m); for marine, below the seabed
  botM: number;
  hex: number;
  source: GeoSource;
  name?: string; // explicit display name (regional layers carry their published name)
}

export interface GeoColumn {
  layers: GeoLayer[];
  soilReal: boolean;
}

export interface GeoColumns {
  land: GeoColumn;
  marine: GeoColumn;
  isOcean: boolean; // the map-centre cell type (for the legend default)
  oceanWaterDepthM: number; // CRUST1.0 water thickness, used where the land DEM is flat over sea
  regionName?: string; // set when a published regional column is used instead of CRUST1.0
}

export const SEA_WATER_HEX = 0x1f5b86;
// No single global aquiclude; the highlight toggle no-ops unless a layer uses this key.
export const AQUICLUDE_KEY = '__aquiclude__';

const HEX = {
  topsoil: 0x3b2a1a, subsoil: 0x6b4f2a, sediments: 0xb9a06a,
  upperCrust: 0x8a7d86, midCrust: 0x6d6a72, lowerCrust: 0x544a55, mantle: 0x2e2230,
  marineMud: 0x5a5347, consolidatedSediment: 0x8a7e5e, oceanicCrust2: 0x33302f, oceanicCrust3: 0x4a4642,
};

const MANTLE_SHOWN_M = 30000; // how far below the Moho the mantle band extends

function ordered(...layers: GeoLayer[]): GeoLayer[] {
  // guarantee strictly increasing, non-overlapping depths
  let prev = 0;
  for (const l of layers) {
    l.topM = Math.max(l.topM, prev);
    l.botM = Math.max(l.botM, l.topM + 1);
    prev = l.botM;
  }
  return layers;
}

function landLayers(cell: Crust1Cell, soil: GeoLayer[] | null): { layers: GeoLayer[]; soilReal: boolean } {
  const s = cell.surfaceElevM;
  const depth = (elevIdx: number): number => Math.max(0, s - cell.bnd[elevIdx]);
  const top: GeoLayer[] = soil && soil.length
    ? soil
    : [
      { key: 'topsoil', topM: 0, botM: 0.3, hex: HEX.topsoil, source: 'model' },
      { key: 'subsoil', topM: 0.3, botM: 2, hex: HEX.subsoil, source: 'model' },
    ];
  const soilBase = top[top.length - 1].botM;
  const deep = ordered(
    { key: 'sediments', topM: soilBase, botM: depth(L.upperCrust), hex: HEX.sediments, source: 'crust1' },
    { key: 'upperCrust', topM: depth(L.upperCrust), botM: depth(L.midCrust), hex: HEX.upperCrust, source: 'crust1' },
    { key: 'midCrust', topM: depth(L.midCrust), botM: depth(L.lowerCrust), hex: HEX.midCrust, source: 'crust1' },
    { key: 'lowerCrust', topM: depth(L.lowerCrust), botM: depth(L.moho), hex: HEX.lowerCrust, source: 'crust1' },
  );
  const mohoD = deep[deep.length - 1].botM;
  deep.push({ key: 'mantle', topM: mohoD, botM: mohoD + MANTLE_SHOWN_M, hex: HEX.mantle, source: 'crust1' });
  return { layers: [...top, ...deep], soilReal: !!(soil && soil.length) };
}

function marineLayers(cell: Crust1Cell): GeoLayer[] {
  // depth below the seabed (top of sediments)
  const sb = cell.bnd[L.upperSed];
  const depth = (elevIdx: number): number => Math.max(0, sb - cell.bnd[elevIdx]);
  const sedBase = Math.max(1, depth(L.upperCrust));
  const mudBase = Math.min(500, Math.max(20, sedBase * 0.25));
  const layers = ordered(
    { key: 'marineMud', topM: 0, botM: mudBase, hex: HEX.marineMud, source: 'model' },
    { key: 'consolidatedSediment', topM: mudBase, botM: sedBase, hex: HEX.consolidatedSediment, source: 'crust1' },
    { key: 'oceanicCrust2', topM: sedBase, botM: depth(L.midCrust), hex: HEX.oceanicCrust2, source: 'crust1' },
    { key: 'oceanicCrust3', topM: depth(L.midCrust), botM: depth(L.moho), hex: HEX.oceanicCrust3, source: 'crust1' },
  );
  const mohoD = layers[layers.length - 1].botM;
  layers.push({ key: 'mantle', topM: mohoD, botM: mohoD + MANTLE_SHOWN_M, hex: HEX.mantle, source: 'crust1' });
  return layers;
}

/**
 * Assemble land + marine columns for a CRUST1.0 cell (real soil spliced on land).
 * `isOcean` is the authoritative land/ocean call from the fine DEM + land-cover —
 * NOT the coarse 1° cell flag, which mis-classifies coastal cells.
 */
export function buildColumns(cell: Crust1Cell, soil: GeoLayer[] | null, isOcean: boolean): GeoColumns {
  const land = landLayers(cell, soil);
  return {
    land: { layers: land.layers, soilReal: land.soilReal },
    marine: { layers: marineLayers(cell), soilReal: false },
    isOcean,
    oceanWaterDepthM: isOcean ? Math.max(0, cell.bnd[L.water] - cell.bnd[L.ice]) : 0,
  };
}

function lookupColumn(cols: RegionalColumn[], lat: number, lon: number): RegionalColumn | null {
  for (const c of cols) {
    const [s, n, w, e] = c.bbox;
    if (lat >= s && lat <= n && lon >= w && lon <= e) return c;
  }
  return null;
}

/** Published land stratigraphy for this coordinate, if any (smallest bbox wins). */
export function findRegional(lat: number, lon: number): RegionalColumn | null {
  return lookupColumn(REGIONAL_COLUMNS, lat, lon);
}

/** Published sub-seabed stratigraphy for this coordinate, if any (smallest bbox wins). */
export function findRegionalMarine(lat: number, lon: number): RegionalColumn | null {
  return lookupColumn(REGIONAL_MARINE_COLUMNS, lat, lon);
}

/**
 * Assemble columns from a real published regional column (real soil on top,
 * the region's named layers below) instead of the coarse CRUST1.0 cell. The
 * marine column still comes from CRUST1.0 (only used for genuinely ocean cells).
 */
export function buildRegionalColumns(region: RegionalColumn, soil: GeoLayer[] | null, cell: Crust1Cell): GeoColumns {
  const top: GeoLayer[] = soil && soil.length
    ? soil
    : [
      { key: 'topsoil', topM: 0, botM: 0.3, hex: HEX.topsoil, source: 'model' },
      { key: 'subsoil', topM: 0.3, botM: 2, hex: HEX.subsoil, source: 'model' },
    ];
  const soilBase = top[top.length - 1].botM;
  const reg: GeoLayer[] = region.layers.map((l, i) => ({
    key: `r${i}`,
    name: l.name,
    topM: Math.max(l.topM, i === 0 ? soilBase : 0),
    botM: l.botM,
    hex: l.hex,
    source: 'regional',
  }));
  return {
    land: { layers: [...top, ...ordered(...reg)], soilReal: !!(soil && soil.length) },
    marine: { layers: marineLayers(cell), soilReal: false },
    isOcean: false,
    oceanWaterDepthM: 0,
    regionName: region.name,
  };
}

/**
 * Assemble columns for an ocean centre using a real published sub-seabed
 * column (the sea's named units below the seabed) instead of the generic
 * CRUST1.0 marine template. The land column is kept as a CRUST1.0 fallback
 * for any coastal wall cells; the legend shows the marine column.
 */
export function buildMarineRegionalColumns(region: RegionalColumn, cell: Crust1Cell): GeoColumns {
  const reg: GeoLayer[] = region.layers.map((l, i) => ({
    key: `m${i}`,
    name: l.name,
    topM: l.topM,
    botM: l.botM,
    hex: l.hex,
    source: 'regional',
  }));
  const land = landLayers(cell, null);
  return {
    land: { layers: land.layers, soilReal: false },
    marine: { layers: ordered(...reg), soilReal: false },
    isOcean: true,
    oceanWaterDepthM: Math.max(0, cell.bnd[L.water] - cell.bnd[L.ice]),
    regionName: region.name,
  };
}

// Neutral generic columns used until the CRUST1.0 asset and SoilGrids resolve.
const GENERIC_CELL: Crust1Cell = {
  isOcean: false,
  bnd: [0, 0, 0, -1000, -1000, -2000, -12000, -22000, -35000],
  surfaceElevM: 0,
  mohoElevM: -35000,
};

export function defaultColumns(): GeoColumns {
  return buildColumns(GENERIC_CELL, null, false);
}
