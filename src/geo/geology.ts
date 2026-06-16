// Global, data-driven subsurface column. The deep structure (sediments →
// crust → Moho) comes from the bundled CRUST1.0 model per lon/lat; the real
// top ~2 m on land comes from a live SoilGrids query (soilgrids.ts). Each cell
// is land or ocean, so we build BOTH a land and a marine column and let the
// cross-section blend them per wall column by surface elevation. Layer names
// are generic/scientific so they localize cleanly and read honestly anywhere.

import { L, type Crust1Cell } from './crust1';

export type GeoSource = 'soilgrids' | 'crust1' | 'model';

export interface GeoLayer {
  key: string; // i18n suffix: t('geo.l.' + key)
  topM: number; // depth below the local surface (m); for marine, below the seabed
  botM: number;
  hex: number;
  source: GeoSource;
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

/** Assemble land + marine columns for a CRUST1.0 cell (real soil spliced on land). */
export function buildColumns(cell: Crust1Cell, soil: GeoLayer[] | null): GeoColumns {
  const land = landLayers(cell, soil);
  return {
    land: { layers: land.layers, soilReal: land.soilReal },
    marine: { layers: marineLayers(cell), soilReal: false },
    isOcean: cell.isOcean,
    oceanWaterDepthM: cell.isOcean ? Math.max(0, cell.bnd[L.water] - cell.bnd[L.ice]) : 0,
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
  return buildColumns(GENERIC_CELL, null);
}
