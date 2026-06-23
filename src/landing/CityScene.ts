import { type LabScene, type DrawCtx, G } from './labShared';

// 2D top-down shallow-water over a synthetic city block. Buildings are solid (water
// flows AROUND them, down the street grid); the terrain slopes to an open plaza where
// a lake forms. Same local-inertial momentum/continuity as the cross-section, in 2D.
const MANNING = 0.03;
const W = 96;
const H = 60;
const CS = 5; // m per cell
const RAIN_MS = 0.0022;
const DRAIN_WET = 0.0007;
const DRAIN_DRY = 0.0028;
const WET = 0.06;
const PERIOD = 12; // block pitch (cells)
const BLOCK = 9; // building size → 3-cell streets between blocks
const PLAZA_X = W * 0.6; // open low square where the lake forms
const PLAZA_Y = H * 0.72;
const PLAZA_R = 15;

interface Rect { x: number; y: number; w: number; h: number }

export class CityScene implements LabScene {
  private readonly z = new Float32Array(W * H);
  private readonly h = new Float32Array(W * H);
  private readonly qx = new Float32Array((W - 1) * H);
  private readonly qy = new Float32Array(W * (H - 1));
  private readonly solid = new Uint8Array(W * H);
  private rects: Rect[] = [];
  private open = 1;
  private zLo = 0;
  private zHi = 1;
  private readonly ocanvas = document.createElement('canvas');
  private readonly octx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  maxDepth = 0;
  pondedFrac = 0;

  constructor() {
    this.ocanvas.width = W;
    this.ocanvas.height = H;
    this.octx = this.ocanvas.getContext('2d') as CanvasRenderingContext2D;
    this.img = this.octx.createImageData(W, H);
    this.build();
  }

  private build(): void {
    this.buildTerrain();
    this.buildBlocks();
    let open = 0;
    for (let c = 0; c < W * H; c++) if (!this.solid[c]) open++;
    this.open = Math.max(1, open);
  }

  private buildTerrain(): void {
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const slope = 1 + 7 * (1 - j / (H - 1)) + 2.5 * (1 - i / (W - 1));
        const dx = i - PLAZA_X;
        const dy = j - PLAZA_Y;
        const basin = 7 * Math.exp(-(dx * dx + dy * dy) / (2 * PLAZA_R * PLAZA_R));
        const v = slope - basin;
        this.z[j * W + i] = v;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    this.zLo = lo;
    this.zHi = hi;
  }

  private buildBlocks(): void {
    for (let by = 0; by < H; by += PERIOD) {
      for (let bx = 0; bx < W; bx += PERIOD) {
        if (Math.hypot(bx + BLOCK / 2 - PLAZA_X, by + BLOCK / 2 - PLAZA_Y) < PLAZA_R + 4) continue;
        const rw = Math.min(BLOCK, W - bx);
        const rh = Math.min(BLOCK, H - by);
        if (rw < 3 || rh < 3) continue;
        this.rects.push({ x: bx, y: by, w: rw, h: rh });
        for (let j = by; j < by + rh; j++) for (let i = bx; i < bx + rw; i++) this.solid[j * W + i] = 1;
      }
    }
  }

  reset(): void {
    this.h.fill(0);
    this.qx.fill(0);
    this.qy.fill(0);
    this.maxDepth = 0;
    this.pondedFrac = 0;
  }

  peaked(): boolean { return this.pondedFrac > 0.4; }
  drained(): boolean { return this.pondedFrac < 0.04; }

  step(simSeconds: number, raining: boolean): void {
    let remaining = simSeconds;
    let guard = 0;
    while (remaining > 1e-6 && guard < 4000) {
      let hmax = 0.05;
      for (let c = 0; c < W * H; c++) if (this.h[c] > hmax) hmax = this.h[c];
      const dt = Math.min(remaining, (0.42 * CS) / Math.sqrt(G * hmax));
      this.substep(dt, raining);
      remaining -= dt;
      guard++;
    }
    this.measure();
  }

  /** Local-inertial discharge update across the face between cells a and b. */
  private face(a: number, b: number, q: number, dt: number): number {
    const hFlow = Math.max(this.z[a] + this.h[a], this.z[b] + this.h[b]) - Math.max(this.z[a], this.z[b]);
    if (hFlow <= 1e-3) return 0;
    const slope = (this.z[b] + this.h[b] - (this.z[a] + this.h[a])) / CS;
    const fric = 1 + (G * dt * MANNING * MANNING * Math.abs(q)) / Math.pow(hFlow, 7 / 3);
    return (q - G * hFlow * dt * slope) / fric;
  }

  private substep(dt: number, raining: boolean): void {
    this.faceX(dt);
    this.faceY(dt);
    this.continuity(dt, raining);
  }

  private faceX(dt: number): void {
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W - 1; i++) {
        const a = j * W + i;
        const f = j * (W - 1) + i;
        this.qx[f] = this.solid[a] || this.solid[a + 1] ? 0 : this.face(a, a + 1, this.qx[f], dt);
      }
    }
  }

  private faceY(dt: number): void {
    for (let j = 0; j < H - 1; j++) {
      for (let i = 0; i < W; i++) {
        const a = j * W + i;
        const f = j * W + i;
        this.qy[f] = this.solid[a] || this.solid[a + W] ? 0 : this.face(a, a + W, this.qy[f], dt);
      }
    }
  }

  private continuity(dt: number, raining: boolean): void {
    const rain = raining ? RAIN_MS : 0;
    const drain = raining ? DRAIN_WET : DRAIN_DRY;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const c = j * W + i;
        if (this.solid[c]) continue;
        const qxIn = i > 0 ? this.qx[j * (W - 1) + i - 1] : 0;
        const qxOut = i < W - 1 ? this.qx[j * (W - 1) + i] : 0;
        const qyIn = j > 0 ? this.qy[(j - 1) * W + i] : 0;
        const qyOut = j < H - 1 ? this.qy[j * W + i] : 0;
        const next = this.h[c] + (dt / CS) * (qxIn - qxOut + qyIn - qyOut) + rain * dt;
        this.h[c] = Math.max(0, next - drain * dt);
      }
    }
  }

  private measure(): void {
    let maxDepth = 0;
    let wet = 0;
    for (let c = 0; c < W * H; c++) {
      if (this.solid[c]) continue;
      if (this.h[c] > maxDepth) maxDepth = this.h[c];
      if (this.h[c] > WET) wet++;
    }
    this.maxDepth = maxDepth;
    this.pondedFrac = wet / this.open;
  }

  draw(ctx: CanvasRenderingContext2D, view: DrawCtx): void {
    const { w, h: hpx, phase, raining } = view;
    const d = this.img.data;
    const range = this.zHi - this.zLo + 1e-3;
    for (let c = 0; c < W * H; c++) {
      let r: number;
      let g: number;
      let b: number;
      if (this.solid[c]) { r = 64; g = 72; b = 82; } else {
        const t = (this.z[c] - this.zLo) / range;
        r = 48 + 14 * t; g = 56 + 14 * t; b = 66 + 16 * t;
        const depth = this.h[c];
        if (depth > 0.02) {
          const a = Math.min(0.9, 0.28 + depth * 0.6);
          r = r * (1 - a) + 46 * a; g = g * (1 - a) + 142 * a; b = b * (1 - a) + 228 * a;
        }
      }
      const p = c * 4;
      d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
    }
    this.octx.putImageData(this.img, 0, 0);

    const scale = Math.max(w / W, hpx / H); // cover, preserve square cells
    const ox = (w - W * scale) / 2;
    const oy = (hpx - H * scale) / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.ocanvas, 0, 0, W, H, ox, oy, W * scale, H * scale);

    for (const bld of this.rects) {
      const x = ox + bld.x * scale;
      const y = oy + bld.y * scale;
      const bw = bld.w * scale;
      const bh = bld.h * scale;
      ctx.fillStyle = '#7c8694';
      ctx.fillRect(x, y, bw, bh);
      ctx.fillStyle = 'rgba(255,255,255,.1)';
      ctx.fillRect(x, y, bw, Math.max(1, bh * 0.16));
      ctx.strokeStyle = 'rgba(10,16,22,.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
    }
    if (raining) this.drawRain(ctx, w, hpx, phase);
  }

  private drawRain(ctx: CanvasRenderingContext2D, w: number, hpx: number, phase: number): void {
    ctx.strokeStyle = 'rgba(176,206,240,.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < 90; k++) {
      const x = (((k * 47.3) / w) % 1) * w;
      const y = ((k * 0.111 + phase) % 1) * hpx;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 2, y + 8);
    }
    ctx.stroke();
  }
}
