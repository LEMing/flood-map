// Runtime reader for the bundled CRUST1.0 global crustal model (see
// scripts/buildCrust1.mjs). Gives, for any lon/lat, the layer-top boundaries
// (sediments → upper/middle/lower crust → Moho) and whether the cell is ocean,
// so the subsurface column is data-driven everywhere on Earth instead of a
// single hardcoded region.

const ROWS = 180;
const COLS = 360;
const CELLS = ROWS * COLS;
const LAYERS = 9;
const HEADER = 4;

// boundary indices
export const L = {
  water: 0, ice: 1, upperSed: 2, midSed: 3, lowSed: 4,
  upperCrust: 5, midCrust: 6, lowerCrust: 7, moho: 8,
} as const;

export interface Crust1Cell {
  isOcean: boolean;
  /** layer-top elevations relative to sea level, metres (+ up). */
  bnd: number[];
  surfaceElevM: number; // bnd[0]
  mohoElevM: number; // bnd[8] (negative = below sea level)
}

let dataPromise: Promise<{ ocean: Uint8Array; bnds: Int16Array } | null> | null = null;

function parse(buf: ArrayBuffer): { ocean: Uint8Array; bnds: Int16Array } | null {
  const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 4));
  if (magic !== 'C1B0') return null;
  const ocean = new Uint8Array(buf, HEADER, CELLS);
  const bnds = new Int16Array(buf, HEADER + CELLS, CELLS * LAYERS);
  return { ocean, bnds };
}

/** Begin loading the bundled model (idempotent). Returns null on failure. */
export function loadCrust1(): Promise<{ ocean: Uint8Array; bnds: Int16Array } | null> {
  if (!dataPromise) {
    const url = `${import.meta.env.BASE_URL}crust1.bin`;
    dataPromise = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(parse)
      .catch(() => null);
  }
  return dataPromise;
}

function cellOffset(lat: number, lon: number): number {
  const lonW = ((((lon + 180) % 360) + 360) % 360) - 180;
  const row = Math.min(ROWS - 1, Math.max(0, Math.floor(89.5 - lat)));
  const col = Math.min(COLS - 1, Math.max(0, Math.floor(lonW + 179.5)));
  return row * COLS + col;
}

/** Look up the crustal cell for a coordinate; null until the asset has loaded. */
export async function getCrust1Cell(lat: number, lon: number): Promise<Crust1Cell | null> {
  const d = await loadCrust1();
  if (!d) return null;
  const cell = cellOffset(lat, lon);
  const base = cell * LAYERS;
  const bnd: number[] = [];
  for (let k = 0; k < LAYERS; k++) bnd.push(d.bnds[base + k] * 10); // decametres → metres
  return {
    isOcean: d.ocean[cell] === 1,
    bnd,
    surfaceElevM: bnd[L.water],
    mohoElevM: bnd[L.moho],
  };
}
