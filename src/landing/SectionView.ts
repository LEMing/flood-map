import { type DrawCtx } from './labShared';
import { LabWorld, W, SLICE_ROW } from './LabWorld';

// Side cross-section renderer: a vertical slice of the SAME world along row SLICE_ROW
// (through the plaza basin). Shows the water surface η = z + h finding the low ground,
// with buildings as silhouette columns so you see water standing in the streets between
// them. Reads the shared z/h, so the section and the map agree frame-for-frame.
const ROOF = 8; // m — stylised constant building height in the profile

export class SectionView {
  private ox = 0;
  private scale = 1;
  private pad = 0;
  private span = 1;
  private ch = 1; // canvas height (CSS px) for the current frame

  constructor(private readonly world: LabWorld) {}

  private x(i: number): number { return this.ox + i * this.scale; }
  private y(v: number): number {
    const t = (v - this.world.zLo) / this.span;
    return this.pad + (1 - t) * (this.ch - this.pad * 1.6);
  }

  draw(ctx: CanvasRenderingContext2D, view: DrawCtx): void {
    const { w, h: hpx, phase, raining } = view;
    this.scale = Math.min(w / W, hpx / 48);
    this.ox = (w - W * this.scale) / 2;
    this.pad = hpx * 0.1;
    this.ch = hpx;
    this.span = this.world.zHi - this.world.zLo + 1.5;

    const sky = ctx.createLinearGradient(0, 0, 0, hpx);
    sky.addColorStop(0, '#0a141d');
    sky.addColorStop(1, '#0d1a24');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, hpx);
    if (raining) this.drawRain(ctx, w, hpx, phase);

    this.drawWater(ctx, hpx);
    this.drawGround(ctx, hpx);
    this.drawBuildings(ctx);
    this.drawSurface(ctx);
  }

  private row(i: number): number { return SLICE_ROW * W + i; }

  private drawWater(ctx: CanvasRenderingContext2D, hpx: number): void {
    const { z, h } = this.world;
    ctx.beginPath();
    ctx.moveTo(this.x(0), this.y(z[this.row(0)] + h[this.row(0)]));
    for (let i = 1; i < W; i++) ctx.lineTo(this.x(i), this.y(z[this.row(i)] + h[this.row(i)]));
    for (let i = W - 1; i >= 0; i--) ctx.lineTo(this.x(i), this.y(z[this.row(i)]));
    ctx.closePath();
    const water = ctx.createLinearGradient(0, 0, 0, hpx);
    water.addColorStop(0, 'rgba(96,205,255,.9)');
    water.addColorStop(1, 'rgba(37,99,235,.95)');
    ctx.fillStyle = water;
    ctx.fill();
  }

  private drawGround(ctx: CanvasRenderingContext2D, hpx: number): void {
    const { z } = this.world;
    ctx.beginPath();
    ctx.moveTo(this.x(0), this.y(z[this.row(0)]));
    for (let i = 1; i < W; i++) ctx.lineTo(this.x(i), this.y(z[this.row(i)]));
    ctx.lineTo(this.x(W - 1), hpx);
    ctx.lineTo(this.x(0), hpx);
    ctx.closePath();
    const ground = ctx.createLinearGradient(0, 0, 0, hpx);
    ground.addColorStop(0, '#46535f');
    ground.addColorStop(1, '#28323d');
    ctx.fillStyle = ground;
    ctx.fill();
    ctx.strokeStyle = 'rgba(168,196,228,.55)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  private drawBuildings(ctx: CanvasRenderingContext2D): void {
    const { z, solid } = this.world;
    let start = -1;
    for (let i = 0; i <= W; i++) {
      const isSolid = i < W && solid[this.row(i)] === 1;
      if (isSolid && start < 0) start = i;
      else if (!isSolid && start >= 0) {
        const zTop = z[this.row(start)] + ROOF;
        const x0 = this.x(start);
        const x1 = this.x(i);
        ctx.fillStyle = '#7c8694';
        ctx.fillRect(x0, this.y(zTop), x1 - x0, this.y(z[this.row(start)]) - this.y(zTop));
        ctx.fillStyle = 'rgba(255,255,255,.12)';
        ctx.fillRect(x0, this.y(zTop), x1 - x0, 3);
        ctx.strokeStyle = 'rgba(10,16,22,.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, this.y(zTop) + 0.5, x1 - x0 - 1, this.y(z[this.row(start)]) - this.y(zTop) - 1);
        start = -1;
      }
    }
  }

  private drawSurface(ctx: CanvasRenderingContext2D): void {
    const { z, h } = this.world;
    ctx.strokeStyle = 'rgba(200,238,255,.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < W; i++) {
      const wet = h[this.row(i)] > 0.06 && this.world.solid[this.row(i)] === 0;
      if (wet) ctx[pen ? 'lineTo' : 'moveTo'](this.x(i), this.y(z[this.row(i)] + h[this.row(i)]));
      pen = wet;
    }
    ctx.stroke();
  }

  private drawRain(ctx: CanvasRenderingContext2D, w: number, hpx: number, phase: number): void {
    ctx.strokeStyle = 'rgba(176,206,240,.32)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let k = 0; k < 70; k++) {
      const x = (((k * 61.7) / w) % 1) * w;
      const yy = ((k * 0.143 + phase) % 1) * hpx;
      ctx.moveTo(x, yy);
      ctx.lineTo(x - 4, yy + 13);
    }
    ctx.stroke();
  }
}
