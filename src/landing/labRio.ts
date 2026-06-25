import { W, H, type WorldSpec } from './LabWorld';
import { decodeRioShape } from './labRioData';

// Rio de Janeiro topography spec: the baked real DEM shape remapped onto a gentle sandbox
// relief so rain ponds and the toy solver stays stable, while the topographic SHAPE (the
// contour lines) stays true to Rio. No buildings — this lab is about relief-driven flooding.
const RELIEF = 46; // m — sandbox vertical range the real shape is remapped onto
const BASE_Z = 6; // m — keeps elevations positive

export function rioSpec(): WorldSpec {
  const shape = decodeRioShape();
  const z = new Float32Array(W * H);
  for (let c = 0; c < W * H; c++) z[c] = BASE_Z + shape[c] * RELIEF;
  return { z, solid: new Uint8Array(W * H), rects: [] };
}
