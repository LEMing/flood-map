// Pure-logic tests for the CRUST1.0 runtime reader. The bundled crust1.bin is
// fetched at runtime (IO, untested here), but the binary PARSE and the O(1) cell
// LOOKUP — including the coast ring-snap — are pure. We hand-build a tiny
// synthetic buffer in the exact on-disk layout (see scripts/buildCrust1.mjs)
// and assert the parser reads the right ocean flag + boundary depths, that a
// lon/lat maps to the correct cell index, and that the snap picks an unmasked
// neighbour.

import { describe, it, expect } from 'vitest';
import { parse, lookupCell, L } from './crust1';

const ROWS = 180;
const COLS = 360;
const CELLS = ROWS * COLS; // 64800
const LAYERS = 9;
const HEADER = 4;
const BYTES = HEADER + CELLS + CELLS * LAYERS * 2;

interface CellSpec {
  ocean?: boolean;
  /** 9 layer-top boundaries in METRES (+ up); stored as round(m/10) decametres. */
  bndM?: number[];
}

// Build a buffer in the C1B0 layout. `cells` maps a flat cell index → spec; any
// unspecified cell is land with all-zero boundaries.
function buildBuffer(cells: Record<number, CellSpec>, magic = 'C1B0'): ArrayBuffer {
  const buf = new ArrayBuffer(BYTES);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < Math.min(4, magic.length); i++) u8[i] = magic.charCodeAt(i);

  const ocean = new Uint8Array(buf, HEADER, CELLS);
  const bnds = new Int16Array(buf, HEADER + CELLS, CELLS * LAYERS);
  for (const [k, spec] of Object.entries(cells)) {
    const cell = Number(k);
    ocean[cell] = spec.ocean ? 1 : 0;
    if (spec.bndM) {
      for (let layer = 0; layer < LAYERS; layer++) {
        bnds[cell * LAYERS + layer] = Math.round((spec.bndM[layer] ?? 0) / 10);
      }
    }
  }
  return buf;
}

// CRUST1.0 indexing the module uses: lat → row via floor(89.5 - lat), lon →
// col via floor(lonW + 179.5). Mirrors crust1.ts so tests can target a cell.
function cellIndex(lat: number, lon: number): number {
  const lonW = ((((lon + 180) % 360) + 360) % 360) - 180;
  const row = Math.min(ROWS - 1, Math.max(0, Math.floor(89.5 - lat)));
  const col = Math.floor(lonW + 179.5);
  return row * COLS + (((col % COLS) + COLS) % COLS);
}

describe('parse', () => {
  it('rejects a full-size buffer whose magic is not C1B0', () => {
    expect(parse(buildBuffer({}, 'XXXX'))).toBeNull();
    expect(parse(buildBuffer({}, 'C1B1'))).toBeNull();
    expect(parse(buildBuffer({}, 'c1b0'))).toBeNull(); // case-sensitive
  });

  it('accepts the C1B0 magic and returns views of the right length', () => {
    const d = parse(buildBuffer({}));
    expect(d).not.toBeNull();
    expect(d!.ocean.length).toBe(CELLS);
    expect(d!.bnds.length).toBe(CELLS * LAYERS);
  });

  it('reads the ocean flag and the Int16 boundary array verbatim', () => {
    const cell = cellIndex(0, 0);
    const bndM = [0, 0, 0, -100, -500, -1000, -7000, -15000, -22000];
    const d = parse(buildBuffer({ [cell]: { ocean: true, bndM } }))!;

    expect(d.ocean[cell]).toBe(1);
    // stored as decametres = round(m/10)
    for (let layer = 0; layer < LAYERS; layer++) {
      expect(d.bnds[cell * LAYERS + layer]).toBe(Math.round(bndM[layer] / 10));
    }
    // an untouched neighbour stays land/zero
    expect(d.ocean[cell + 1]).toBe(0);
  });

  it('parses ocean/land mask and bnds at non-trivial little-endian offsets', () => {
    // A negative Int16 (below sea level) round-trips through the typed-array view.
    const cell = cellIndex(-33.9, 18.4); // Cape Town-ish
    const bndM = [50, 50, 50, 0, -200, -800, -12000, -22000, -33000];
    const d = parse(buildBuffer({ [cell]: { ocean: false, bndM } }))!;
    expect(d.ocean[cell]).toBe(0);
    expect(d.bnds[cell * LAYERS + L.moho]).toBe(-3300); // -33000 m → -3300 dam
    expect(d.bnds[cell * LAYERS + L.water]).toBe(5); // 50 m → 5 dam
  });
});

describe('lookupCell — index mapping', () => {
  it('maps the origin (0,0) to the documented cell and scales decametres → metres', () => {
    const cell = cellIndex(0, 0);
    const bndM = [10, 10, 10, -90, -490, -990, -6990, -14990, -21990];
    const d = parse(buildBuffer({ [cell]: { ocean: false, bndM } }))!;

    const out = lookupCell(d, 0, 0);
    expect(out.isOcean).toBe(false);
    expect(out.surfaceElevM).toBe(out.bnd[L.water]);
    expect(out.mohoElevM).toBe(out.bnd[L.moho]);
    // round-trip through round(m/10)*10 keeps multiples of 10 exact
    for (let layer = 0; layer < LAYERS; layer++) {
      expect(out.bnd[layer]).toBe(Math.round(bndM[layer] / 10) * 10);
    }
  });

  it('puts a far-north / far-west point in row 0, col 0', () => {
    // lat just under 90, lon = -179 → row 0, col 0 (floor(-179+179.5)=0) → idx 0.
    const lat = 89.4;
    const lon = -179;
    expect(cellIndex(lat, lon)).toBe(0);
    const d = parse(buildBuffer({ 0: { ocean: true, bndM: [0, 0, 0, 0, 0, -4000, 0, 0, -11000] } }))!;
    const out = lookupCell(d, lat, lon);
    expect(out.isOcean).toBe(true);
    expect(out.bnd[L.moho]).toBe(-11000);
  });

  it('distinguishes adjacent cells one degree of longitude apart', () => {
    const cellA = cellIndex(10, 10);
    const cellB = cellIndex(10, 11);
    expect(cellB).toBe(cellA + 1); // longitude is the inner loop
    const d = parse(
      buildBuffer({
        [cellA]: { ocean: false, bndM: [100, 0, 0, 0, 0, 0, 0, 0, -30000] },
        [cellB]: { ocean: true, bndM: [0, 0, 0, 0, 0, 0, 0, 0, -8000] },
      }),
    )!;
    expect(lookupCell(d, 10, 10).isOcean).toBe(false);
    expect(lookupCell(d, 10, 10).surfaceElevM).toBe(100);
    expect(lookupCell(d, 10, 11).isOcean).toBe(true);
    expect(lookupCell(d, 10, 11).bnd[L.moho]).toBe(-8000);
  });

  it('clamps latitudes beyond the poles into the valid row range', () => {
    // lat = 95 would give a negative row; the module clamps to row 0.
    const cellTop = cellIndex(95, 0);
    const cellBottom = cellIndex(-95, 0);
    expect(Math.floor(cellTop / COLS)).toBe(0);
    expect(Math.floor(cellBottom / COLS)).toBe(ROWS - 1);
    const d = parse(
      buildBuffer({
        [cellTop]: { ocean: true },
        [cellBottom]: { ocean: false, bndM: [200, 0, 0, 0, 0, 0, 0, 0, 0] },
      }),
    )!;
    expect(lookupCell(d, 95, 0).isOcean).toBe(true);
    expect(lookupCell(d, -95, 0).surfaceElevM).toBe(200);
  });

  it('wraps longitude modulo 360 so ±180 hit the same column band', () => {
    // lon 181 normalises to -179; lon -181 normalises to 179. Both resolve via
    // the same modular column math without throwing or reading out of bounds.
    const d = parse(buildBuffer({}))!;
    expect(() => lookupCell(d, 0, 181)).not.toThrow();
    expect(() => lookupCell(d, 0, -181)).not.toThrow();
    expect(() => lookupCell(d, 0, 540)).not.toThrow();
    // 0 and 360 are the same physical meridian → identical cell contents.
    const at0 = lookupCell(d, 0, 0);
    const at360 = lookupCell(d, 0, 360);
    expect(at360.bnd).toEqual(at0.bnd);
  });
});

describe('lookupCell — coast ring-snap', () => {
  it('returns the base cell when its type already matches `want`', () => {
    const cell = cellIndex(20, 20);
    const d = parse(buildBuffer({ [cell]: { ocean: true, bndM: [0, 0, 0, 0, 0, 0, 0, 0, -7000] } }))!;
    const out = lookupCell(d, 20, 20, 'ocean');
    expect(out.isOcean).toBe(true);
    expect(out.bnd[L.moho]).toBe(-7000);
  });

  it('returns the base cell unchanged when no `want` is given', () => {
    const cell = cellIndex(20, 20);
    const d = parse(buildBuffer({ [cell]: { ocean: true } }))!;
    expect(lookupCell(d, 20, 20).isOcean).toBe(true); // ocean base, no snap requested
  });

  // Default cells are land (ocean=0). To exercise the snap deterministically we
  // flood a block around the base with the OPPOSITE type, leaving one neighbour
  // of the wanted type, so the ring search must pick exactly that cell.
  const lat = 0;
  const lon = 0;
  const base = cellIndex(lat, lon);
  const east = base + 1; // dr=0, dc=+1 → ring radius 1

  function blockAround(center: number, ocean: boolean, radius: number): Record<number, CellSpec> {
    const out: Record<number, CellSpec> = {};
    const r0 = Math.floor(center / COLS);
    const c0 = center % COLS;
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const r = r0 + dr;
        if (r < 0 || r >= ROWS) continue;
        const c = (((c0 + dc) % COLS) + COLS) % COLS;
        out[r * COLS + c] = { ocean };
      }
    }
    return out;
  }

  it('snaps from an ocean base to an adjacent land cell when want="land"', () => {
    const cells = blockAround(base, true, 2); // ocean everywhere nearby
    cells[base] = { ocean: true, bndM: [0, 0, 0, 0, 0, 0, 0, 0, -8000] };
    cells[east] = { ocean: false, bndM: [300, 0, 0, 0, 0, 0, 0, 0, -32000] }; // lone land
    const d = parse(buildBuffer(cells))!;

    expect(lookupCell(d, lat, lon).isOcean).toBe(true); // no snap → ocean base
    const land = lookupCell(d, lat, lon, 'land');
    expect(land.isOcean).toBe(false);
    expect(land.surfaceElevM).toBe(300);
    expect(land.mohoElevM).toBe(-32000);
  });

  it('snaps from a land base to an adjacent ocean cell when want="ocean"', () => {
    const cells = blockAround(base, false, 2); // land everywhere nearby
    cells[base] = { ocean: false, bndM: [120, 0, 0, 0, 0, 0, 0, 0, -34000] };
    cells[east] = { ocean: true, bndM: [0, 0, 0, 0, 0, 0, 0, 0, -7000] }; // lone ocean
    const d = parse(buildBuffer(cells))!;

    const ocean = lookupCell(d, lat, lon, 'ocean');
    expect(ocean.isOcean).toBe(true);
    expect(ocean.mohoElevM).toBe(-7000);
  });

  it('falls back to the base cell when no neighbour within radius 6 matches', () => {
    // Whole buffer is land; asking for ocean finds nothing → returns land base.
    const cell = cellIndex(40, -100); // continental interior
    const d = parse(buildBuffer({ [cell]: { ocean: false, bndM: [500, 0, 0, 0, 0, 0, 0, 0, -40000] } }))!;
    const out = lookupCell(d, 40, -100, 'ocean');
    expect(out.isOcean).toBe(false); // fell back to base
    expect(out.surfaceElevM).toBe(500);
  });

  it('prefers a nearer ring over a farther one', () => {
    const base = cellIndex(30, 30);
    const near = base + 1; // radius 1 (east)
    const far = base + 3; // radius 3 (also east, on a later ring)
    const d = parse(
      buildBuffer({
        [base]: { ocean: false },
        [near]: { ocean: true, bndM: [0, 0, 0, 0, 0, 0, 0, 0, -6000] },
        [far]: { ocean: true, bndM: [0, 0, 0, 0, 0, 0, 0, 0, -9000] },
      }),
    )!;
    const out = lookupCell(d, 30, 30, 'ocean');
    expect(out.bnd[L.moho]).toBe(-6000); // the radius-1 neighbour wins
  });
});
