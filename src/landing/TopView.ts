import { type DrawCtx } from './labShared';
import { LabWorld, W, H, CS, SLICE_ROW } from './LabWorld';

// Top-down map renderer for the shared LabWorld. The static hillshade is computed once
// (elevation never changes); per frame only the wet cells are re-tinted. Contain-fit with
// nearest-neighbour keeps the 2 km city crisp and un-stretched in the canvas.
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

export class TopView {
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

  /** Static hypsometric hillshade: low channel/plaza dark teal → bench slate → ridges grey-green. */
  private buildBase(): void {
    const { z, zLo, zHi, chan } = this.world;
    const range = zHi - zLo + 1e-3;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const c = j * W + i;
        const t = (z[c] - zLo) / range;
        const left = z[j * W + Math.max(0, i - 1)];
        const right = z[j * W + Math.min(W - 1, i + 1)];
        const up = z[Math.max(0, j - 1) * W + i];
        const down = z[Math.min(H - 1, j + 1) * W + i];
        const shade = Math.max(-0.22, Math.min(0.24, (left - right) * 0.035 + (up - down) * 0.025));
        let r: number;
        let g: number;
        let b: number;
        if (t < 0.48) { const k = t / 0.48; r = lerp(25, 58, k); g = lerp(44, 76, k); b = lerp(54, 82, k); }
        else { const k = (t - 0.48) / 0.52; r = lerp(58, 120, k); g = lerp(76, 127, k); b = lerp(82, 108, k); }
        const lit = 1 + shade;
        r *= lit; g *= lit; b *= lit;
        if (chan[c]) { r *= 0.55; g *= 0.76; b = Math.min(255, b * 1.18); } // keep the river ribbon legible
        const p = c * 4;
        this.base[p] = r; this.base[p + 1] = g; this.base[p + 2] = b; this.base[p + 3] = 255;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, view: DrawCtx): void {
    const { w, h: hpx, phase } = view;
    const d = this.work.data;
    d.set(this.base);
    const { h, solid } = this.world;
    for (let c = 0; c < W * H; c++) {
      if (solid[c] || h[c] <= 0.06) continue;
      const a = Math.min(0.88, 0.24 + h[c] * 0.62);
      const shimmer = 0.055 * Math.sin((c % W) * 0.42 + Math.floor(c / W) * 0.31 + phase * Math.PI * 2);
      const p = c * 4;
      d[p] = d[p] * (1 - a) + (38 + shimmer * 60) * a;
      d[p + 1] = d[p + 1] * (1 - a) + (139 + shimmer * 70) * a;
      d[p + 2] = d[p + 2] * (1 - a) + 232 * a;
    }
    this.octx.putImageData(this.work, 0, 0);

    this.scale = Math.min(w / W, hpx / H); // contain — square cells, no stretch
    this.ox = (w - W * this.scale) / 2;
    this.oy = (hpx - H * this.scale) / 2;
    const sky = ctx.createLinearGradient(0, 0, 0, hpx);
    sky.addColorStop(0, '#0a141d');
    sky.addColorStop(1, '#0d1a24');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, hpx);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.ocanvas, 0, 0, W, H, this.ox, this.oy, W * this.scale, H * this.scale);
    ctx.imageSmoothingEnabled = true;

    this.drawFloodGlow(ctx);
    this.drawStreetGrid(ctx);
    this.drawBuildings(ctx);
    this.drawOverlays(ctx);
    if (view.raining) this.drawRain(ctx, view);
  }

  private sx(i: number): number { return this.ox + i * this.scale; }
  private sy(j: number): number { return this.oy + j * this.scale; }

  private drawFloodGlow(ctx: CanvasRenderingContext2D): void {
    if (this.world.maxDepth <= 0.08) return;
    const i = this.world.deepestIdx % W;
    const j = Math.floor(this.world.deepestIdx / W);
    const x = this.sx(i + 0.5);
    const y = this.sy(j + 0.5);
    const r = Math.min(120, (20 + this.world.maxDepth * 18) * this.scale);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, 'rgba(95, 205, 255, .34)');
    glow.addColorStop(0.45, 'rgba(59, 130, 246, .18)');
    glow.addColorStop(1, 'rgba(59, 130, 246, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(this.ox, this.oy, W * this.scale, H * this.scale);
  }

  private drawStreetGrid(ctx: CanvasRenderingContext2D): void {
    const x0 = Math.round(this.sx(W * 0.28)) + 0.5;
    const x1 = Math.round(this.sx(W * 0.76)) + 0.5;
    const y0 = Math.round(this.sy(H * 0.16)) + 0.5;
    const y1 = Math.round(this.sy(H * 0.84)) + 0.5;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.clip();
    ctx.strokeStyle = 'rgba(213, 226, 241, .08)';
    ctx.lineWidth = 1;
    for (let i = Math.floor(W * 0.28); i <= W * 0.76; i += 8) {
      const x = Math.round(this.sx(i)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();
    }
    for (let j = Math.floor(H * 0.16); j <= H * 0.84; j += 8) {
      const y = Math.round(this.sy(j)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawBuildings(ctx: CanvasRenderingContext2D): void {
    for (const bld of this.world.rects) {
      const x = Math.round(this.ox + bld.x * this.scale);
      const y = Math.round(this.oy + bld.y * this.scale);
      const bw = Math.round(bld.w * this.scale);
      const bh = Math.round(bld.h * this.scale);
      const shadow = Math.max(1, Math.round(this.scale * 0.45));
      ctx.fillStyle = 'rgba(0, 0, 0, .28)';
      ctx.fillRect(x + shadow, y + shadow, bw, bh);
      ctx.fillStyle = '#828c99';
      ctx.fillRect(x, y, bw, bh);
      ctx.fillStyle = 'rgba(255,255,255,.16)';
      ctx.fillRect(x, y, bw, Math.max(1, bh * 0.18));
      ctx.strokeStyle = 'rgba(7,12,18,.62)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
    }
  }

  private drawOverlays(ctx: CanvasRenderingContext2D): void {
    const { ox, oy, scale } = this;
    // Dashed cut line — where the cross-section is taken.
    ctx.strokeStyle = 'rgba(120,200,255,.7)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    const sy = oy + SLICE_ROW * scale;
    ctx.beginPath();
    ctx.moveTo(ox, sy);
    ctx.lineTo(ox + W * scale, sy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Scale ruler along the bottom.
    const ry = this.oy + H * scale - 10;
    ctx.strokeStyle = 'rgba(214,226,240,.5)';
    ctx.fillStyle = 'rgba(214,226,240,.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox, ry);
    ctx.lineTo(ox + W * scale, ry);
    const widthM = W * CS;
    for (let m = 0; m <= widthM; m += 500) {
      const x = ox + (m / CS) * scale;
      ctx.moveTo(x, ry - 3);
      ctx.lineTo(x, ry);
    }
    ctx.stroke();
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${(widthM / 1000).toFixed(1)} km`, ox + W * scale, ry - 5);
    ctx.textAlign = 'left';
  }

  private drawRain(ctx: CanvasRenderingContext2D, view: DrawCtx): void {
    const { w, h: hpx, phase } = view;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.ox, this.oy, W * this.scale, H * this.scale);
    ctx.clip();
    ctx.strokeStyle = 'rgba(182, 216, 255, .26)';
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
