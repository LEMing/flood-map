import { type DrawCtx } from './labShared';
import { LabWorld, W, H, CS, SLICE_ROW } from './LabWorld';

// Top-down map renderer for the shared LabWorld. The static hillshade is computed once
// (elevation never changes); per frame only the wet cells are re-tinted. Contain-fit with
// nearest-neighbour keeps the 2.5 km city crisp and un-stretched in the wide-short canvas.
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
    for (let c = 0; c < W * H; c++) {
      const t = (z[c] - zLo) / range;
      let r: number;
      let g: number;
      let b: number;
      if (t < 0.5) { const k = t * 2; r = lerp(32, 60, k); g = lerp(52, 74, k); b = lerp(64, 86, k); }
      else { const k = (t - 0.5) * 2; r = lerp(60, 120, k); g = lerp(74, 128, k); b = lerp(86, 120, k); }
      if (chan[c]) { r *= 0.7; g *= 0.82; b = Math.min(255, b * 1.05); } // keep the river ribbon legible
      const p = c * 4;
      this.base[p] = r; this.base[p + 1] = g; this.base[p + 2] = b; this.base[p + 3] = 255;
    }
  }

  draw(ctx: CanvasRenderingContext2D, view: DrawCtx): void {
    const { w, h: hpx } = view;
    const d = this.work.data;
    d.set(this.base);
    const { h, solid } = this.world;
    for (let c = 0; c < W * H; c++) {
      if (solid[c] || h[c] <= 0.02) continue;
      const a = Math.min(0.92, 0.3 + h[c] * 0.55);
      const p = c * 4;
      d[p] = d[p] * (1 - a) + 46 * a;
      d[p + 1] = d[p + 1] * (1 - a) + 142 * a;
      d[p + 2] = d[p + 2] * (1 - a) + 228 * a;
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

    this.drawBuildings(ctx);
    this.drawOverlays(ctx, view);
  }

  private drawBuildings(ctx: CanvasRenderingContext2D): void {
    for (const bld of this.world.rects) {
      const x = Math.round(this.ox + bld.x * this.scale);
      const y = Math.round(this.oy + bld.y * this.scale);
      const bw = Math.round(bld.w * this.scale);
      const bh = Math.round(bld.h * this.scale);
      ctx.fillStyle = '#7c8694';
      ctx.fillRect(x, y, bw, bh);
      ctx.fillStyle = 'rgba(255,255,255,.1)';
      ctx.fillRect(x, y, bw, Math.max(1, bh * 0.18));
      ctx.strokeStyle = 'rgba(10,16,22,.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
    }
  }

  private drawOverlays(ctx: CanvasRenderingContext2D, view: DrawCtx): void {
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

    // Scale ruler along the bottom: a 2500 m span with 500 m ticks.
    const ry = view.h - 8;
    ctx.strokeStyle = 'rgba(214,226,240,.5)';
    ctx.fillStyle = 'rgba(214,226,240,.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox, ry);
    ctx.lineTo(ox + W * scale, ry);
    for (let m = 0; m <= 2500; m += 500) {
      const x = ox + (m / CS) * scale;
      ctx.moveTo(x, ry - 3);
      ctx.lineTo(x, ry);
    }
    ctx.stroke();
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText('2.5 km', ox + W * scale, ry - 5);
    ctx.textAlign = 'left';
  }
}
