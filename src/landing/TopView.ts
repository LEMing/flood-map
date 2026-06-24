import { type DrawCtx } from './labShared';
import { LabWorld, W, H, CS } from './LabWorld';

// Minimal top-down map for the shared LabWorld. The land hillshade is baked once into an
// offscreen W×H buffer; each frame the wet cells are re-tinted with a bright depth ramp and
// the whole buffer is blitted with bilinear smoothing — so the flood reads as a clean, soft
// lake, not a pixel grid. No buildings, no streets: just terrain + water finding the low ground.
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

const DEPTH_MAX = 2.5; // m — depth at which the ramp reaches its deepest blue

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

  /** Static, muted hillshade so the bright water is unmistakably the subject: dark slate in the
   *  basins → pale sage on the ridges, with a soft directional light to read the relief. */
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
        const shade = Math.max(-0.24, Math.min(0.24, (left - right) * 0.035 + (up - down) * 0.026));
        let r: number;
        let g: number;
        let b: number;
        // basin slate → teal-green → warm khaki ridge: warm/green land so cool cyan water pops
        if (t < 0.5) { const k = t / 0.5; r = lerp(28, 52, k); g = lerp(40, 78, k); b = lerp(48, 70, k); }
        else { const k = (t - 0.5) / 0.5; r = lerp(52, 128, k); g = lerp(78, 124, k); b = lerp(70, 90, k); }
        const lit = 1 + shade;
        const p = c * 4;
        this.base[p] = r * lit; this.base[p + 1] = g * lit; this.base[p + 2] = b * lit; this.base[p + 3] = 255;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, view: DrawCtx): void {
    const { w, h: hpx, phase } = view;
    const d = this.work.data;
    d.set(this.base);
    const { h } = this.world;
    for (let c = 0; c < W * H; c++) {
      const depth = h[c];
      if (depth <= 0.02) continue;
      const t = Math.min(1, depth / DEPTH_MAX);
      const a = Math.min(0.96, (0.62 + 0.34 * t) * Math.min(1, (depth - 0.02) / 0.1));
      const shimmer = 0.05 * Math.sin((c % W) * 0.4 + Math.floor(c / W) * 0.3 + phase * Math.PI * 2);
      const p = c * 4;
      d[p] = d[p] * (1 - a) + (lerp(150, 22, t) + shimmer * 70) * a;
      d[p + 1] = d[p + 1] * (1 - a) + (lerp(236, 88, t) + shimmer * 60) * a;
      d[p + 2] = d[p + 2] * (1 - a) + lerp(255, 210, t) * a;
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
    ctx.imageSmoothingEnabled = true; // bilinear upscale → soft shoreline, no pixel grid
    ctx.drawImage(this.ocanvas, 0, 0, W, H, this.ox, this.oy, W * this.scale, H * this.scale);

    this.drawFloodGlow(ctx);
    this.drawScaleBar(ctx);
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
    const r = Math.min(140, (24 + this.world.maxDepth * 20) * this.scale);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, 'rgba(120, 220, 255, .30)');
    glow.addColorStop(0.5, 'rgba(59, 130, 246, .16)');
    glow.addColorStop(1, 'rgba(59, 130, 246, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(this.ox, this.oy, W * this.scale, H * this.scale);
  }

  private drawScaleBar(ctx: CanvasRenderingContext2D): void {
    const { ox, oy, scale } = this;
    const ry = oy + H * scale - 12;
    ctx.strokeStyle = 'rgba(214,226,240,.5)';
    ctx.fillStyle = 'rgba(214,226,240,.72)';
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
