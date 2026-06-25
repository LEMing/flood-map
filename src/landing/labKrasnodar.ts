import { W, H, type WorldSpec } from './LabWorld';
import { KRD_CS, decodeKrdShape, decodeKrdRoad } from './labKrasnodarData';

// Flat-city spec from REAL central Krasnodar: the actual (gently sloped) DEM and the real OSM
// STREET network. The streets are the only open conveyance; the blocks between them are solid
// (no flow, no rain, no pooling). So the point lands: the plain is nearly flat, yet the flood is
// routed by the street grid plus a few metres of real relief — not by elevation alone. Relief is
// modestly exaggerated for a watchable sandbox; the street grid and topography stay true to Rio.
const RELIEF = 15; // m — sandbox vertical range the ~9 m of real relief is remapped onto
const BASE_Z = 24; // m — Krasnodar sits ~26–35 m on the Kuban plain

function at(src: Uint8Array, i: number, j: number): number {
  return i >= 0 && i < W && j >= 0 && j < H ? src[j * W + i] : 0;
}

/** Grow the street set by one cell so channels are 2–3 cells wide (clearer, blocks a touch smaller). */
function dilate(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const on = at(src, i, j) + at(src, i - 1, j) + at(src, i + 1, j) + at(src, i, j - 1) + at(src, i, j + 1);
      out[j * W + i] = on > 0 ? 1 : 0;
    }
  }
  return out;
}

export function krasnodarSpec(): WorldSpec {
  const shape = decodeKrdShape();
  const street = dilate(decodeKrdRoad());
  const z = new Float32Array(W * H);
  const solid = new Uint8Array(W * H);
  for (let c = 0; c < W * H; c++) {
    z[c] = BASE_Z + shape[c] * RELIEF;
    solid[c] = street[c] ? 0 : 1; // blocks are solid; the real streets carry the water
  }
  return { z, solid, cs: KRD_CS };
}
