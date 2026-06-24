import { type DrawCtx } from './labShared';
import { LabWorld, W, H, CS } from './LabWorld';

// Top-down cartographic renderer for the shared LabWorld. Instead of a single blurry fill,
// it layers like a real topographic flood map: a dark hypsometric base, crisp terrain
// contour lines (marching squares), a metric geo-grid, and a bright marching-squares
// waterline that traces the flood extent. The soft base reads as watercolor under the ink.
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

const DEPTH_MAX = 1.2; // m — depth mapped to the deepest blue
const WATERLINE = 0.05; // m — the contour traced as the shoreline
const GRID_M = 500; // metric graticule spacing
const CONTOURS = 12; // terrain contour intervals between zLo..zHi

// Marching-squares case table: corner bits tl=8,tr=4,br=2,bl=1; edges top=0,right=1,bottom=2,left=3.
const MS_EDGES: number[][][] = [
  [], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], [[3, 0], [2, 1]], [[0, 2]], [[0, 3]],
  [[0, 3]], [[0, 2]], [[0, 1], [3, 2]], [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], [],
];

/** Iso-contour segments of a scalar field at `level`, as flat [x0,y0,x1,y1,...] in cell coords. */
function marchingSquares(field: Float32Array, level: number): Float32Array {
  const segs: number[] = [];
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const tl = field[y * W + x], tr = field[y * W + x + 1];
      const bl = field[(y + 1) * W + x], br = field[(y + 1) * W + x + 1];
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

export class TopView {
  private readonly ocanvas = document.createElement('canvas');
  private readonly octx: CanvasRenderingContext2D;
  private readonly base: Uint8ClampedArray;
  private readonly work: ImageData;
  private terrainMinor = new Float32Array(0);
  private terrainIndex = new Float32Array(0);
  private ox = 0;
  private oy = 0;
  private scale = 1;

  constructor(private readonly world: LabWorld) {
    this.ocanvas.width = W;
    this.ocanvas.height = H;
    this.octx = this.ocanvas.getContext('2d') as CanvasRenderingContext2D;
    this.work = this.octx.createImageData(W, H);
    this.base = new Uint8ClampedArray(W * H * 4);
    this.buildBase();
    this.buildContours();
  }

  /** Dark hypsometric hillshade: navy lowlands → steel highlands, so cyan water and ink lines pop. */
  private buildBase(): void {
    const { z, zLo, zHi } = this.world;
    const range = zHi - zLo + 1e-3;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const c = j * W + i;
        const t = (z[c] - zLo) / range;
        const left = z[j * W + Math.max(0, i - 1)];
        const right = z[j * W + Math.min(W - 1, i + 1)];
        const up = z[Math.max(0, j - 1) * W + i];
        const down = z[Math.min(H - 1, j + 1) * W + i];
        const shade = Math.max(-0.3, Math.min(0.3, (left - right) * 0.04 + (up - down) * 0.032));
        let r: number;
        let g: number;
        let b: number;
        if (t < 0.5) { const k = t / 0.5; r = lerp(14, 38, k); g = lerp(22, 52, k); b = lerp(30, 62, k); }
        else { const k = (t - 0.5) / 0.5; r = lerp(38, 60, k); g = lerp(52, 74, k); b = lerp(62, 80, k); }
        const lit = 1 + shade;
        const p = c * 4;
        this.base[p] = r * lit; this.base[p + 1] = g * lit; this.base[p + 2] = b * lit; this.base[p + 3] = 255;
      }
    }
  }

  private buildContours(): void {
    const { z, zLo, zHi } = this.world;
    const minor: number[] = [];
    const index: number[] = [];
    for (let i = 1; i < CONTOURS; i++) {
      const segs = marchingSquares(z, zLo + ((zHi - zLo) * i) / CONTOURS);
      const into = i % 3 === 0 ? index : minor;
      for (let k = 0; k < segs.length; k++) into.push(segs[k]);
    }
    this.terrainMinor = new Float32Array(minor);
    this.terrainIndex = new Float32Array(index);
  }

  draw(ctx: CanvasRenderingContext2D, view: DrawCtx): void {
    const { w, h: hpx, phase } = view;
    this.work.data.set(this.base);
    this.tintWater(this.work.data, phase);
    this.octx.putImageData(this.work, 0, 0);

    this.scale = Math.min(w / W, hpx / H);
    this.ox = (w - W * this.scale) / 2;
    this.oy = (hpx - H * this.scale) / 2;
    ctx.fillStyle = '#0a131c';
    ctx.fillRect(0, 0, w, hpx);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.ocanvas, 0, 0, W, H, this.ox, this.oy, W * this.scale, H * this.scale);

    this.strokeSegments(ctx, this.terrainMinor, 'rgba(200,218,236,.14)', 1);
    this.strokeSegments(ctx, this.terrainIndex, 'rgba(216,230,246,.30)', 1.1);
    this.drawGrid(ctx);
    this.drawWaterline(ctx);
    this.drawScaleBar(ctx);
    if (view.raining) this.drawRain(ctx, view);
  }

  private tintWater(d: Uint8ClampedArray, phase: number): void {
    const { h } = this.world;
    for (let c = 0; c < W * H; c++) {
      const depth = h[c];
      if (depth <= 0.02) continue;
      const t = Math.min(1, depth / DEPTH_MAX);
      const a = Math.min(0.88, (0.4 + 0.46 * t) * Math.min(1, (depth - 0.02) / 0.08));
      const shimmer = 0.05 * Math.sin((c % W) * 0.4 + Math.floor(c / W) * 0.3 + phase * Math.PI * 2);
      const p = c * 4;
      d[p] = d[p] * (1 - a) + (lerp(70, 26, t) + shimmer * 60) * a;
      d[p + 1] = d[p + 1] * (1 - a) + (lerp(190, 86, t) + shimmer * 50) * a;
      d[p + 2] = d[p + 2] * (1 - a) + lerp(225, 205, t) * a;
    }
  }

  private sx(i: number): number { return this.ox + i * this.scale; }
  private sy(j: number): number { return this.oy + j * this.scale; }

  private strokeSegments(ctx: CanvasRenderingContext2D, segs: Float32Array, style: string, width: number): void {
    if (segs.length === 0) return;
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i < segs.length; i += 4) {
      ctx.moveTo(this.sx(segs[i]), this.sy(segs[i + 1]));
      ctx.lineTo(this.sx(segs[i + 2]), this.sy(segs[i + 3]));
    }
    ctx.stroke();
  }

  private drawWaterline(ctx: CanvasRenderingContext2D): void {
    const segs = marchingSquares(this.world.h, WATERLINE);
    ctx.save();
    ctx.shadowColor = 'rgba(120,225,255,.5)';
    ctx.shadowBlur = 6;
    this.strokeSegments(ctx, segs, 'rgba(152,232,255,.95)', 1.6);
    ctx.restore();
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const { ox, oy, scale } = this;
    const span = W * scale;
    const tall = H * scale;
    const step = (GRID_M / CS) * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, span, tall);
    ctx.clip();
    ctx.strokeStyle = 'rgba(150,182,214,.085)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ox; x <= ox + span + 0.5; x += step) {
      const px = Math.round(x) + 0.5;
      ctx.moveTo(px, oy);
      ctx.lineTo(px, oy + tall);
    }
    for (let y = oy; y <= oy + tall + 0.5; y += step) {
      const py = Math.round(y) + 0.5;
      ctx.moveTo(ox, py);
      ctx.lineTo(ox + span, py);
    }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(160,190,220,.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, span - 1, tall - 1);
    ctx.font = '600 10px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(196,214,234,.5)';
    ctx.textAlign = 'left';
    ctx.fillText('R I O   D E   J A N E I R O', ox + 9, oy + 17);
  }

  private drawScaleBar(ctx: CanvasRenderingContext2D): void {
    const ry = this.oy + H * this.scale - 13;
    const widthM = W * CS;
    ctx.strokeStyle = 'rgba(214,226,240,.5)';
    ctx.fillStyle = 'rgba(214,226,240,.72)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.sx(0), ry);
    ctx.lineTo(this.sx(W), ry);
    for (let m = 0; m <= widthM; m += GRID_M) {
      const x = this.ox + (m / CS) * this.scale;
      ctx.moveTo(x, ry - 3);
      ctx.lineTo(x, ry);
    }
    ctx.stroke();
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${(widthM / 1000).toFixed(1)} km`, this.sx(W), ry - 5);
    ctx.textAlign = 'left';
  }

  private drawRain(ctx: CanvasRenderingContext2D, view: DrawCtx): void {
    const { w, h: hpx, phase } = view;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.ox, this.oy, W * this.scale, H * this.scale);
    ctx.clip();
    ctx.strokeStyle = 'rgba(182, 216, 255, .24)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let k = 0; k < 92; k++) {
      const x = (((k * 73.3) / w) % 1) * w;
      const y = ((k * 0.097 + phase) % 1) * hpx;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 8, y + 20);
    }
    ctx.stroke();
    ctx.restore();
  }
}
