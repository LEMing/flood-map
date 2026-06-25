// Shared drawing helpers for the lab renderers: a linear blend and a marching-squares
// iso-contour extractor (used for terrain contour lines and the crisp flood waterline).
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

// Marching-squares case table: corner bits tl=8,tr=4,br=2,bl=1; edges top=0,right=1,bottom=2,left=3.
const MS_EDGES: number[][][] = [
  [], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], [[3, 0], [2, 1]], [[0, 2]], [[0, 3]],
  [[0, 3]], [[0, 2]], [[0, 1], [3, 2]], [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], [],
];

/** Iso-contour segments of a scalar field at `level`, as flat [x0,y0,x1,y1,...] in cell coords. */
export function marchingSquares(field: Float32Array, w: number, h: number, level: number): Float32Array {
  const segs: number[] = [];
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const tl = field[y * w + x], tr = field[y * w + x + 1];
      const bl = field[(y + 1) * w + x], br = field[(y + 1) * w + x + 1];
      const code = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
      const pairs = MS_EDGES[code];
      if (pairs.length === 0) continue;
      const pt = (e: number): [number, number] => {
        if (e === 0) return [x + (level - tl) / (tr - tl), y];
        if (e === 1) return [x + 1, y + (level - tr) / (br - tr)];
        if (e === 2) return [x + (level - bl) / (br - bl), y + 1];
        return [x, y + (level - tl) / (bl - tl)];
      };
      for (const [a, b] of pairs) { const pa = pt(a), pb = pt(b); segs.push(pa[0], pa[1], pb[0], pb[1]); }
    }
  }
  return new Float32Array(segs);
}
