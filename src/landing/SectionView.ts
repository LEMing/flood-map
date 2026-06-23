import { type DrawCtx } from './labShared';
import { LabWorld, W, SLICE_ROW } from './LabWorld';

// Side cross-section renderer: a street-level slice of the SAME world along row
// SLICE_ROW. The dashed line on the map is this row; buildings only appear where
// that line intersects solid footprints, and water only fills open street cells.
const STOREY_H = 3.0; // m
const SLAB_H = 0.28; // m
const FOUNDATION_D = 0.85; // m below local grade
const ROOF_H = 0.35; // m

export class SectionView {
  private ox = 0;
  private scale = 1;
  private pad = 0;
  private span = 1;
  private zMin = 0;
  private ch = 1; // canvas height (CSS px) for the current frame

  constructor(private readonly world: LabWorld) {}

  private x(i: number): number { return this.ox + i * this.scale; }
  private y(v: number): number {
    const t = (v - this.zMin) / this.span;
    return this.pad + (1 - t) * (this.ch - this.pad * 1.6);
  }

  draw(ctx: CanvasRenderingContext2D, view: DrawCtx): void {
    const { w, h: hpx, phase, raining } = view;
    this.scale = Math.min(w / W, hpx / 48);
    this.ox = (w - W * this.scale) / 2;
    this.pad = hpx * 0.1;
    this.ch = hpx;
    this.measureSlice();

    this.drawBackdrop(ctx, w, hpx);
    if (raining) this.drawRain(ctx, w, hpx, phase);
    this.drawWater(ctx, hpx);
    this.drawGround(ctx, hpx);
    this.drawBuildings(ctx);
    this.drawSurface(ctx, phase);
  }

  private row(i: number): number { return SLICE_ROW * W + i; }

  private floorCount(i: number): number { return 2 + ((Math.floor(i / 8) + Math.floor(i / 24)) % 2); }
  private roofHeight(i: number): number { return this.floorCount(i) * STOREY_H + ROOF_H; }

  private measureSlice(): void {
    const { z, h, solid } = this.world;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < W; i++) {
      const c = this.row(i);
      const ground = z[c];
      lo = Math.min(lo, ground - FOUNDATION_D);
      hi = Math.max(hi, ground + h[c]);
      if (solid[c]) hi = Math.max(hi, ground + this.roofHeight(i));
    }
    this.zMin = lo - 0.35;
    this.span = Math.max(14, hi - this.zMin + 0.75);
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D, w: number, hpx: number): void {
    const sky = ctx.createLinearGradient(0, 0, 0, hpx);
    sky.addColorStop(0, '#08121a');
    sky.addColorStop(0.56, '#0c1720');
    sky.addColorStop(1, '#071017');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, hpx);

    ctx.strokeStyle = 'rgba(190, 214, 240, .045)';
    ctx.lineWidth = 1;
    for (let y = hpx * 0.16; y < hpx * 0.9; y += 34) {
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
      ctx.stroke();
    }
  }

  private drawWater(ctx: CanvasRenderingContext2D, hpx: number): void {
    const water = ctx.createLinearGradient(0, 0, 0, hpx);
    water.addColorStop(0, 'rgba(96,205,255,.9)');
    water.addColorStop(0.58, 'rgba(45,142,235,.92)');
    water.addColorStop(1, 'rgba(24,79,190,.96)');
    ctx.save();
    ctx.shadowColor = 'rgba(80, 190, 255, .32)';
    ctx.shadowBlur = 22;
    ctx.fillStyle = water;
    let start = -1;
    for (let i = 0; i <= W; i++) {
      const wet = i < W && this.world.solid[this.row(i)] === 0 && this.world.h[this.row(i)] > 0.055;
      if (wet && start < 0) start = i;
      else if (!wet && start >= 0) {
        this.drawWaterSegment(ctx, start, i - 1);
        start = -1;
      }
    }
    ctx.restore();
  }

  private drawWaterSegment(ctx: CanvasRenderingContext2D, start: number, end: number): void {
    const { z, h } = this.world;
    ctx.beginPath();
    ctx.moveTo(this.x(start), this.y(z[this.row(start)] + h[this.row(start)]));
    for (let i = start + 1; i <= end; i++) ctx.lineTo(this.x(i), this.y(z[this.row(i)] + h[this.row(i)]));
    for (let i = end; i >= start; i--) ctx.lineTo(this.x(i), this.y(z[this.row(i)]));
    ctx.closePath();
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
    ground.addColorStop(0, '#485662');
    ground.addColorStop(0.58, '#33404a');
    ground.addColorStop(1, '#202b35');
    ctx.fillStyle = ground;
    ctx.fill();

    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(230, 238, 248, .055)';
    ctx.lineWidth = 1;
    for (let y = this.pad * 1.8; y < hpx; y += 22) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.x(W), y + Math.sin(y * 0.04) * 12);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(180,210,240,.62)';
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
        const mid = Math.floor((start + i - 1) / 2);
        const base = z[this.row(mid)];
        const floors = this.floorCount(mid);
        const zTop = base + this.roofHeight(mid);
        const x0 = this.x(start);
        const x1 = this.x(i);
        const yTop = this.y(zTop);
        const yBase = this.y(base);
        const yFoot = this.y(base - FOUNDATION_D);
        const w = x1 - x0;
        const side = Math.min(4, Math.max(1.4, w * 0.12));

        ctx.fillStyle = 'rgba(0,0,0,.24)';
        ctx.fillRect(x0 + 3.5, yTop + 4.5, w, yFoot - yTop);

        // Cut foundation below grade: footing + stem wall.
        ctx.fillStyle = '#586472';
        ctx.fillRect(x0 - 1, yBase, w + 2, yFoot - yBase);
        ctx.fillStyle = '#6f7c8a';
        ctx.fillRect(x0 - 3, yFoot - 3, w + 6, 3);
        this.drawConcreteHatch(ctx, { x: x0 - 1, y: yBase, w: w + 2, h: yFoot - yBase });

        // Structural shell above grade: side walls, floors, roof slab.
        ctx.fillStyle = '#9aa4b1';
        ctx.fillRect(x0, yTop, w, yBase - yTop);
        ctx.fillStyle = '#c0c8d2';
        ctx.fillRect(x0 + side, yTop + 1, Math.max(1, w - side * 2), yBase - yTop - 1);
        ctx.fillStyle = '#7f8b99';
        ctx.fillRect(x0, yTop, w, Math.max(2, this.y(zTop - ROOF_H) - yTop));
        ctx.fillRect(x0, this.y(base + SLAB_H), w, Math.max(2, yBase - this.y(base + SLAB_H)));

        ctx.strokeStyle = 'rgba(20,27,36,.72)';
        ctx.lineWidth = 1;
        for (let f = 1; f < floors; f++) {
          const yFloor = this.y(base + f * STOREY_H);
          ctx.beginPath();
          ctx.moveTo(x0 + side, yFloor);
          ctx.lineTo(x1 - side, yFloor);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(6,10,16,.72)';
        ctx.strokeRect(x0 + 0.5, yTop + 0.5, w - 1, yFoot - yTop - 1);
        start = -1;
      }
    }
  }

  private drawConcreteHatch(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }): void {
    const { x, y, w, h } = rect;
    if (w < 5 || h < 5) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(218,228,240,.18)';
    ctx.lineWidth = 1;
    for (let xx = x - h; xx < x + w + h; xx += 7) {
      ctx.beginPath();
      ctx.moveTo(xx, y + h);
      ctx.lineTo(xx + h, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawSurface(ctx: CanvasRenderingContext2D, phase: number): void {
    const { z, h } = this.world;
    ctx.save();
    ctx.shadowColor = 'rgba(160, 230, 255, .44)';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = 'rgba(200,238,255,.95)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < W; i++) {
      const wet = h[this.row(i)] > 0.06 && this.world.solid[this.row(i)] === 0;
      if (wet) ctx[pen ? 'lineTo' : 'moveTo'](this.x(i), this.y(z[this.row(i)] + h[this.row(i)]));
      pen = wet;
    }
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < W; i += 7) {
      const wet = h[this.row(i)] > 0.18 && this.world.solid[this.row(i)] === 0;
      if (!wet) continue;
      const x = this.x(i);
      const y = this.y(z[this.row(i)] + h[this.row(i)]) + Math.sin(i * 0.7 + phase * Math.PI * 2) * 1.2;
      ctx.moveTo(x - 6, y);
      ctx.lineTo(x + 6, y);
    }
    ctx.stroke();
  }

  private drawRain(ctx: CanvasRenderingContext2D, w: number, hpx: number, phase: number): void {
    ctx.strokeStyle = 'rgba(176,206,240,.34)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let k = 0; k < 90; k++) {
      const x = (((k * 61.7) / w) % 1) * w;
      const yy = ((k * 0.143 + phase) % 1) * hpx;
      ctx.moveTo(x, yy);
      ctx.lineTo(x - 6, yy + 18);
    }
    ctx.stroke();
  }
}
