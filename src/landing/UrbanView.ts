import { type DrawCtx } from './labShared';
import { LabWorld, W, H, CS } from './LabWorld';
import { lerp, marchingSquares } from './labDraw';

// Top-down renderer for the flat-city lab. The ground is a near-flat street plain; rain pools
// only in the OPEN street cells (buildings are solid), so the flood reads as a grid of flooded
// streets backing up around dry blocks — the urban fabric, not elevation, routing the water.
const DEPTH_MAX = 0.9; // m — depth mapped to the deepest blue (streets stay shallow)
const WATERLINE = 0.05; // m — the contour traced as the flooded-street edge
const GRID_M = 500; // metric graticule spacing

export class UrbanView {
  private readonly ocanvas = document.createElement('canvas');
  private readonly octx: CanvasRenderingContext2D;
  private readonly base: Uint8ClampedArray;
  private readonly work: ImageData;
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
  }

  /** Street-plain ground, faintly shaded by the micro-relief so the low corridor reads. */
  private buildBase(): void {
    const { z, zLo, zHi } = this.world;
    const range = zHi - zLo + 1e-3;
    for (let c = 0; c < W * H; c++) {
      const t = (z[c] - zLo) / range;
      const p = c * 4;
      this.base[p] = lerp(34, 56, t);
      this.base[p + 1] = lerp(38, 59, t);
      this.base[p + 2] = lerp(44, 64, t);
      this.base[p + 3] = 255;
    }
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

    this.drawGrid(ctx);
    this.drawWaterline(ctx);
    this.drawBuildings(ctx);
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
      const a = Math.min(0.9, (0.45 + 0.45 * t) * Math.min(1, (depth - 0.02) / 0.08));
      const shimmer = 0.05 * Math.sin((c % W) * 0.5 + Math.floor(c / W) * 0.4 + phase * Math.PI * 2);
      const p = c * 4;
      d[p] = d[p] * (1 - a) + (lerp(78, 26, t) + shimmer * 60) * a;
      d[p + 1] = d[p + 1] * (1 - a) + (lerp(196, 92, t) + shimmer * 50) * a;
      d[p + 2] = d[p + 2] * (1 - a) + lerp(228, 208, t) * a;
    }
  }

  private drawBuildings(ctx: CanvasRenderingContext2D): void {
    const sh = Math.max(1, Math.round(this.scale * 0.5));
    for (const b of this.world.rects) {
      const x = Math.round(this.ox + b.x * this.scale);
      const y = Math.round(this.oy + b.y * this.scale);
      const bw = Math.round(b.w * this.scale);
      const bh = Math.round(b.h * this.scale);
      const tone = 96 + (((b.x * 7 + b.y * 13) % 5) - 2) * 5;
      ctx.fillStyle = 'rgba(4,8,13,.36)';
      ctx.fillRect(x + sh, y + sh, bw, bh);
      ctx.fillStyle = `rgb(${tone},${tone + 6},${tone + 12})`;
      ctx.fillRect(x, y, bw, bh);
      ctx.fillStyle = 'rgba(255,255,255,.10)';
      ctx.fillRect(x, y, bw, Math.max(1, Math.round(bh * 0.16)));
      ctx.strokeStyle = 'rgba(8,12,18,.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
    }
  }

  private drawWaterline(ctx: CanvasRenderingContext2D): void {
    const segs = marchingSquares(this.world.h, W, H, WATERLINE);
    if (segs.length === 0) return;
    ctx.save();
    ctx.shadowColor = 'rgba(120,225,255,.5)';
    ctx.shadowBlur = 5;
    ctx.strokeStyle = 'rgba(152,232,255,.9)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < segs.length; i += 4) {
      ctx.moveTo(this.ox + segs[i] * this.scale, this.oy + segs[i + 1] * this.scale);
      ctx.lineTo(this.ox + segs[i + 2] * this.scale, this.oy + segs[i + 3] * this.scale);
    }
    ctx.stroke();
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
    ctx.strokeStyle = 'rgba(150,182,214,.075)';
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
    const widthM = W * CS;
    ctx.strokeStyle = 'rgba(214,226,240,.5)';
    ctx.fillStyle = 'rgba(214,226,240,.72)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.ox, ry);
    ctx.lineTo(this.ox + W * this.scale, ry);
    for (let m = 0; m <= widthM; m += GRID_M) {
      const x = this.ox + (m / CS) * this.scale;
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
