// A tiny CPU shallow-water cross-section — the SAME local-inertial scheme the real
// model uses (Bates et al. 2010), in 1D, rendered to a 2D canvas. It lets the landing
// show "water surface η = z + h" live with zero WebGL. Tuned for a DEMO, not a gauge:
// the rain is deliberately fierce and time is accelerated so a clear lake forms in a
// couple of seconds, then recedes — the point is to feel "water finds the low ground".

const G = 9.81;
const MANNING = 0.03; // s·m^(-1/3)
const N = 116; // cells
const DX = 6; // m per cell
const RAIN_MS = 0.005; // m/s while raining — demo-fierce, so the basin fills in a couple of seconds
const DRAIN_WET = 0.0015; // m/s loss while it rains (low, like the model's in-storm evaporation)
const DRAIN_DRY = 0.006; // m/s loss once the rain stops (high tail loss → the lake recedes fast)
const WET = 0.08; // m — counts as "ponded"
const BASE_RATE = 110; // sim-seconds per real second at 1× speed
const SPEED_MULT = [1, 4, 16]; // the Faster button steps logarithmically through these
const DEEP = 5; // m — the auto-demo stops the rain once the lake is this deep…
const SHALLOW = 0.25; // …and restarts it here, so the section breathes fill → drain → fill

/** Gaussian bump, height 1 at x=m, width s (in normalised 0..1 coords). */
function bump(x: number, m: number, s: number): number {
  const t = (x - m) / s;
  return Math.exp(-t * t);
}

export class MiniFlood {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly depthEl: HTMLElement | null;
  private readonly pondedEl: HTMLElement | null;
  private readonly speedEl: HTMLElement | null;
  private readonly rainBtn: HTMLButtonElement | null;
  private readonly z = new Float32Array(N);
  private readonly h = new Float32Array(N);
  private readonly q = new Float32Array(N - 1);
  private zLo = 0;
  private zHi = 1;
  private raining = true;
  private auto = true;
  private speedIdx = 0;
  private maxDepth = 0;
  private phase = 0;
  private running = false;
  private onScreen = false;
  private raf = 0;
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly io: IntersectionObserver;

  constructor(root: HTMLElement) {
    this.canvas = root.querySelector('.lp-lab-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.rainBtn = root.querySelector('[data-lab-act="rain"]');
    this.depthEl = root.querySelector('[data-lab="depth"]');
    this.pondedEl = root.querySelector('[data-lab="ponded"]');
    this.speedEl = root.querySelector('[data-lab="speed"]');
    this.auto = !this.reduced;
    this.raining = !this.reduced;
    this.buildTerrain();
    this.setRain(this.raining);
    this.renderSpeed();
    this.rainBtn?.addEventListener('click', () => this.toggleRain());
    root.querySelector('[data-lab-act="faster"]')?.addEventListener('click', () => this.cycleSpeed());
    root.querySelector('[data-lab-act="reset"]')?.addEventListener('click', () => this.reset());
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => this.sync());
    this.io = new IntersectionObserver(
      (e) => { this.onScreen = e[0].isIntersecting; this.sync(); },
      { threshold: 0.15 },
    );
    this.io.observe(this.canvas);
    this.resize();
  }

  private buildTerrain(): void {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1);
      // Two big flanking hills around a broad central basin, with a small island that submerges.
      const v = 0.8 + 11 * bump(x, 0.13, 0.16) + 10 * bump(x, 0.87, 0.16) + 3.2 * bump(x, 0.5, 0.06);
      this.z[i] = v;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    this.zLo = lo;
    this.zHi = hi;
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.io.disconnect();
  }

  /** Re-sync the rain button's pressed state after a language swap. */
  refresh(): void {
    this.rainBtn?.classList.toggle('on', this.raining);
  }

  private setRain(on: boolean): void {
    this.raining = on;
    this.rainBtn?.classList.toggle('on', on);
  }

  private cycleSpeed(): void {
    this.speedIdx = (this.speedIdx + 1) % SPEED_MULT.length;
    this.renderSpeed();
  }

  private renderSpeed(): void {
    if (this.speedEl) this.speedEl.textContent = `${SPEED_MULT[this.speedIdx]}×`;
  }

  private toggleRain(): void {
    this.auto = false; // hand control to the visitor
    this.setRain(!this.raining);
    this.sync();
  }

  private reset(): void {
    this.h.fill(0);
    this.q.fill(0);
    this.auto = !this.reduced;
    this.setRain(!this.reduced);
    this.draw();
    this.emitStats();
  }

  private sync(): void {
    const shouldRun = this.onScreen && !document.hidden;
    if (shouldRun && !this.running) {
      this.running = true;
      this.raf = requestAnimationFrame(this.frame);
    } else if (!shouldRun && this.running) {
      this.running = false;
      cancelAnimationFrame(this.raf);
    }
  }

  private readonly frame = (): void => {
    if (!this.running) return;
    this.advance((1 / 60) * BASE_RATE * SPEED_MULT[this.speedIdx]);
    if (this.auto) {
      if (this.raining && this.maxDepth > DEEP) this.setRain(false);
      else if (!this.raining && this.maxDepth < SHALLOW) this.setRain(true);
    }
    this.phase = (this.phase + 0.06) % 1;
    this.draw();
    this.emitStats();
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Advance the sim by `simSeconds`, CFL-substepped for stability. */
  private advance(simSeconds: number): void {
    let remaining = simSeconds;
    let guard = 0;
    while (remaining > 1e-6 && guard < 6000) {
      let hmax = 0.05;
      for (let i = 0; i < N; i++) if (this.h[i] > hmax) hmax = this.h[i];
      const dt = Math.min(remaining, (0.45 * DX) / Math.sqrt(G * hmax));
      this.step(dt);
      remaining -= dt;
      guard++;
    }
  }

  private step(dt: number): void {
    // Momentum on faces: local-inertial update of discharge from the water-surface slope,
    // with Manning friction in the denominator — exactly the model's 1D form.
    for (let f = 0; f < N - 1; f++) {
      const etaL = this.z[f] + this.h[f];
      const etaR = this.z[f + 1] + this.h[f + 1];
      const hFlow = Math.max(etaL, etaR) - Math.max(this.z[f], this.z[f + 1]);
      if (hFlow <= 1e-3) { this.q[f] = 0; continue; }
      const slope = (etaR - etaL) / DX;
      const fric = 1 + (G * dt * MANNING * MANNING * Math.abs(this.q[f])) / Math.pow(hFlow, 7 / 3);
      this.q[f] = (this.q[f] - G * hFlow * dt * slope) / fric;
    }
    const rain = this.raining ? RAIN_MS : 0;
    const drain = this.raining ? DRAIN_WET : DRAIN_DRY; // low loss during the storm, high in the tail
    for (let i = 0; i < N; i++) {
      const qIn = i > 0 ? this.q[i - 1] : 0;
      const qOut = i < N - 1 ? this.q[i] : 0;
      const next = this.h[i] + (dt / DX) * (qIn - qOut) + rain * dt;
      this.h[i] = Math.max(0, next - drain * dt);
    }
  }

  private emitStats(): void {
    let maxDepth = 0;
    let wet = 0;
    for (let i = 0; i < N; i++) {
      if (this.h[i] > maxDepth) maxDepth = this.h[i];
      if (this.h[i] > WET) wet++;
    }
    this.maxDepth = maxDepth;
    if (this.depthEl) this.depthEl.textContent = maxDepth.toFixed(1);
    if (this.pondedEl) this.pondedEl.textContent = String(Math.round((wet / N) * 100));
  }

  private resize(): void {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = this.canvas.clientWidth || 600;
    const hpx = this.canvas.clientHeight || 240;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(hpx * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth || 600;
    const hpx = this.canvas.clientHeight || 240;
    const pad = hpx * 0.1;
    const span = Math.max(1, this.zHi - this.zLo + 1.5);
    const toX = (i: number): number => (i / (N - 1)) * w;
    const toY = (v: number): number => pad + (1 - (v - this.zLo) / span) * (hpx - pad * 1.6);

    const sky = ctx.createLinearGradient(0, 0, 0, hpx);
    sky.addColorStop(0, '#0a141d');
    sky.addColorStop(1, '#0d1a24');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, hpx);
    if (this.raining) this.drawRain(ctx, w, hpx);

    // Water layer between z (bottom) and η (top); zero-area where dry.
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

    // Terrain silhouette.
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

    this.drawSurface(toX, toY);
  }

  /** Bright water-surface line across the runs where the water is meaningfully deep. */
  private drawSurface(toX: (i: number) => number, toY: (v: number) => number): void {
    const ctx = this.ctx;
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

  private drawRain(ctx: CanvasRenderingContext2D, w: number, hpx: number): void {
    ctx.strokeStyle = 'rgba(176,206,240,.34)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let k = 0; k < 70; k++) {
      const x = (((k * 61.7) / w) % 1) * w;
      const y = ((k * 0.143 + this.phase) % 1) * hpx;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 4, y + 13);
    }
    ctx.stroke();
  }
}
