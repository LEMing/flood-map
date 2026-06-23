import { type LabScene, type DrawCtx, G, bump } from './labShared';

// 1D shallow-water cross-section: terrain z, water depth h, discharge q on the faces.
// Local-inertial momentum + continuity (Bates et al.) — the same scheme as the real model.
const MANNING = 0.03;
const N = 116;
const DX = 6; // m per cell
const RAIN_MS = 0.005; // fierce demo rain → the basin fills in a couple of seconds
const DRAIN_WET = 0.0015; // low loss while it rains
const DRAIN_DRY = 0.006; // high tail loss once the rain stops → quick recession
const WET = 0.08;
const DEEP = 5;
const SHALLOW = 0.25;

export class CrossScene implements LabScene {
  private readonly z = new Float32Array(N);
  private readonly h = new Float32Array(N);
  private readonly q = new Float32Array(N - 1);
  private zLo = 0;
  private zHi = 1;
  maxDepth = 0;
  pondedFrac = 0;

  constructor() {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1);
      const v = 0.8 + 11 * bump(x, 0.13, 0.16) + 10 * bump(x, 0.87, 0.16) + 3.2 * bump(x, 0.5, 0.06);
      this.z[i] = v;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    this.zLo = lo;
    this.zHi = hi;
  }

  reset(): void {
    this.h.fill(0);
    this.q.fill(0);
    this.maxDepth = 0;
    this.pondedFrac = 0;
  }

  peaked(): boolean { return this.maxDepth > DEEP; }
  drained(): boolean { return this.maxDepth < SHALLOW; }

  step(simSeconds: number, raining: boolean): void {
    let remaining = simSeconds;
    let guard = 0;
    while (remaining > 1e-6 && guard < 6000) {
      let hmax = 0.05;
      for (let i = 0; i < N; i++) if (this.h[i] > hmax) hmax = this.h[i];
      const dt = Math.min(remaining, (0.45 * DX) / Math.sqrt(G * hmax));
      this.substep(dt, raining);
      remaining -= dt;
      guard++;
    }
    this.measure();
  }

  private substep(dt: number, raining: boolean): void {
    for (let f = 0; f < N - 1; f++) {
      const etaL = this.z[f] + this.h[f];
      const etaR = this.z[f + 1] + this.h[f + 1];
      const hFlow = Math.max(etaL, etaR) - Math.max(this.z[f], this.z[f + 1]);
      if (hFlow <= 1e-3) { this.q[f] = 0; continue; }
      const slope = (etaR - etaL) / DX;
      const fric = 1 + (G * dt * MANNING * MANNING * Math.abs(this.q[f])) / Math.pow(hFlow, 7 / 3);
      this.q[f] = (this.q[f] - G * hFlow * dt * slope) / fric;
    }
    const rain = raining ? RAIN_MS : 0;
    const drain = raining ? DRAIN_WET : DRAIN_DRY;
    for (let i = 0; i < N; i++) {
      const qIn = i > 0 ? this.q[i - 1] : 0;
      const qOut = i < N - 1 ? this.q[i] : 0;
      const next = this.h[i] + (dt / DX) * (qIn - qOut) + rain * dt;
      this.h[i] = Math.max(0, next - drain * dt);
    }
  }

  private measure(): void {
    let maxDepth = 0;
    let wet = 0;
    for (let i = 0; i < N; i++) {
      if (this.h[i] > maxDepth) maxDepth = this.h[i];
      if (this.h[i] > WET) wet++;
    }
    this.maxDepth = maxDepth;
    this.pondedFrac = wet / N;
  }

  draw(ctx: CanvasRenderingContext2D, view: DrawCtx): void {
    const { w, h: hpx, phase, raining } = view;
    const pad = hpx * 0.1;
    const span = Math.max(1, this.zHi - this.zLo + 1.5);
    const toX = (i: number): number => (i / (N - 1)) * w;
    const toY = (v: number): number => pad + (1 - (v - this.zLo) / span) * (hpx - pad * 1.6);

    const sky = ctx.createLinearGradient(0, 0, 0, hpx);
    sky.addColorStop(0, '#0a141d');
    sky.addColorStop(1, '#0d1a24');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, hpx);
    if (raining) this.drawRain(ctx, w, hpx, phase);

    ctx.beginPath();
    ctx.moveTo(0, toY(this.z[0] + this.h[0]));
    for (let i = 1; i < N; i++) ctx.lineTo(toX(i), toY(this.z[i] + this.h[i]));
    for (let i = N - 1; i >= 0; i--) ctx.lineTo(toX(i), toY(this.z[i]));
    ctx.closePath();
    const water = ctx.createLinearGradient(0, 0, 0, hpx);
    water.addColorStop(0, 'rgba(96,205,255,.9)');
    water.addColorStop(1, 'rgba(37,99,235,.95)');
    ctx.fillStyle = water;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, toY(this.z[0]));
    for (let i = 1; i < N; i++) ctx.lineTo(toX(i), toY(this.z[i]));
    ctx.lineTo(w, hpx);
    ctx.lineTo(0, hpx);
    ctx.closePath();
    const ground = ctx.createLinearGradient(0, 0, 0, hpx);
    ground.addColorStop(0, '#46535f');
    ground.addColorStop(1, '#28323d');
    ctx.fillStyle = ground;
    ctx.fill();
    ctx.strokeStyle = 'rgba(168,196,228,.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(200,238,255,.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < N; i++) {
      const wet = this.h[i] > WET;
      if (wet) ctx[pen ? 'lineTo' : 'moveTo'](toX(i), toY(this.z[i] + this.h[i]));
      pen = wet;
    }
    ctx.stroke();
  }

  private drawRain(ctx: CanvasRenderingContext2D, w: number, hpx: number, phase: number): void {
    ctx.strokeStyle = 'rgba(176,206,240,.34)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let k = 0; k < 70; k++) {
      const x = (((k * 61.7) / w) % 1) * w;
      const y = ((k * 0.143 + phase) % 1) * hpx;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 4, y + 13);
    }
    ctx.stroke();
  }
}
