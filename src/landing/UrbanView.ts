import { type DrawCtx } from './labShared';
import { LabWorld, W, H } from './LabWorld';
import { lerp, marchingSquares } from './labDraw';

// Cartographic renderer for the flat-city lab over REAL central Krasnodar (its DEM + OSM street
// grid). Layers like a city flood plan: lighter solid blocks over the darker open streets, faint
// elevation contours (it is NOT perfectly flat), the blocks outlined crisply along the real grid,
// and a bright waterline where rain backs up in the streets — the fabric, not the height, routes it.
const DEPTH_MAX = 0.7; // m — depth mapped to the deepest blue (streets stay shallow)
const WATERLINE = 0.05; // m — the contour traced as the flooded-street edge
const GRID_M = 500; // metric graticule spacing
const CONTOURS = 6; // relief contour intervals (gentle relief — keep it sparse)

export class UrbanView {
  private readonly ocanvas = document.createElement('canvas');
  private readonly octx: CanvasRenderingContext2D;
  private readonly base: Uint8ClampedArray;
  private readonly work: ImageData;
  private contours: Float32Array = new Float32Array(0);
  private blockEdges: Float32Array = new Float32Array(0);
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
    this.buildLines();
  }

  /** Lighter blue-grey blocks over darker open streets, both faintly shaded by the gentle relief. */
  private buildBase(): void {
    const { z, zLo, zHi, solid } = this.world;
    const range = zHi - zLo + 1e-3;
    for (let c = 0; c < W * H; c++) {
      const t = (z[c] - zLo) / range;
      let r: number;
      let g: number;
      let b: number;
      if (solid[c]) { r = lerp(70, 102, t); g = lerp(78, 110, t); b = lerp(88, 122, t); }
      else { r = lerp(26, 42, t); g = lerp(32, 48, t); b = lerp(38, 54, t); }
      const p = c * 4;
      this.base[p] = r; this.base[p + 1] = g; this.base[p + 2] = b; this.base[p + 3] = 255;
    }
  }

  private buildLines(): void {
    const { z, zLo, zHi, solid } = this.world;
    const contour: number[] = [];
    for (let i = 1; i < CONTOURS; i++) {
      const segs = marchingSquares(z, W, H, zLo + ((zHi - zLo) * i) / CONTOURS);
      for (let k = 0; k < segs.length; k++) contour.push(segs[k]);
    }
    this.contours = new Float32Array(contour);
    const sf = new Float32Array(W * H);
    for (let c = 0; c < W * H; c++) sf[c] = solid[c];
    this.blockEdges = marchingSquares(sf, W, H, 0.5);
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

    this.strokeSegments(ctx, this.contours, 'rgba(200,216,234,.10)', 1);
    this.drawGrid(ctx);
    this.drawWaterline(ctx);
    this.strokeSegments(ctx, this.blockEdges, 'rgba(12,17,24,.66)', 1.4);
    this.strokeSegments(ctx, this.blockEdges, 'rgba(196,210,228,.14)', 0.6);
    this.drawFrame(ctx);
    this.drawScaleBar(ctx);
    if (view.raining) this.drawRain(ctx, view);
  }

  private tintWater(d: Uint8ClampedArray, phase: number): void {
    const { h } = this.world;
    for (let c = 0; c < W * H; c++) {
      const depth = h[c];
      if (depth <= 0.02) continue;
      const t = Math.min(1, depth / DEPTH_MAX);
      const a = Math.min(0.9, (0.46 + 0.44 * t) * Math.min(1, (depth - 0.02) / 0.08));
      const shimmer = 0.05 * Math.sin((c % W) * 0.5 + Math.floor(c / W) * 0.4 + phase * Math.PI * 2);
      const p = c * 4;
      d[p] = d[p] * (1 - a) + (lerp(80, 26, t) + shimmer * 60) * a;
      d[p + 1] = d[p + 1] * (1 - a) + (lerp(198, 92, t) + shimmer * 50) * a;
      d[p + 2] = d[p + 2] * (1 - a) + lerp(228, 208, t) * a;
    }
  }

  private strokeSegments(ctx: CanvasRenderingContext2D, segs: Float32Array, style: string, width: number): void {
    if (segs.length === 0) return;
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i < segs.length; i += 4) {
      ctx.moveTo(this.ox + segs[i] * this.scale, this.oy + segs[i + 1] * this.scale);
      ctx.lineTo(this.ox + segs[i + 2] * this.scale, this.oy + segs[i + 3] * this.scale);
    }
    ctx.stroke();
  }

  private drawWaterline(ctx: CanvasRenderingContext2D): void {
    const segs = marchingSquares(this.world.h, W, H, WATERLINE);
    ctx.save();
    ctx.shadowColor = 'rgba(120,225,255,.5)';
    ctx.shadowBlur = 5;
    this.strokeSegments(ctx, segs, 'rgba(152,232,255,.9)', 1.4);
    ctx.restore();
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const { ox, oy, scale } = this;
    const span = W * scale;
    const tall = H * scale;
    const step = (GRID_M / this.world.cs) * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, span, tall);
    ctx.clip();
    ctx.strokeStyle = 'rgba(150,182,214,.07)';
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
  }

  private drawFrame(ctx: CanvasRenderingContext2D): void {
    const { ox, oy, scale } = this;
    ctx.strokeStyle = 'rgba(160,190,220,.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, W * scale - 1, H * scale - 1);
    ctx.font = '600 10px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(196,214,234,.5)';
    ctx.textAlign = 'left';
    ctx.fillText('K R A S N O D A R', ox + 9, oy + 17);
  }

  private drawScaleBar(ctx: CanvasRenderingContext2D): void {
    const ry = this.oy + H * this.scale - 13;
    const widthM = W * this.world.cs;
    ctx.strokeStyle = 'rgba(214,226,240,.5)';
    ctx.fillStyle = 'rgba(214,226,240,.72)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.ox, ry);
    ctx.lineTo(this.ox + W * this.scale, ry);
    for (let m = 0; m <= widthM; m += GRID_M) {
      const x = this.ox + (m / this.world.cs) * this.scale;
      ctx.moveTo(x, ry - 3);
      ctx.lineTo(x, ry);
    }
    ctx.stroke();
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${(widthM / 1000).toFixed(1)} km`, this.ox + W * this.scale, ry - 5);
    ctx.textAlign = 'left';
  }

  private drawRain(ctx: CanvasRenderingContext2D, view: DrawCtx): void {
    const { w, h: hpx, phase } = view;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.ox, this.oy, W * this.scale, H * this.scale);
    ctx.clip();
    ctx.strokeStyle = 'rgba(182, 216, 255, .22)';
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
