import { G } from './labShared';

// The single source of truth for the physics lab: ONE 2D local-inertial shallow-water world
// over a SMOOTH, abstract landscape — a few gentle hills and basins, no buildings. Rendered
// top-down so you watch rain pool in the low ground into clear lakes, then drain. The scheme
// (faces carry discharge q with Manning friction; depth updates by continuity) is the same one
// the full model runs — here on a tiny CPU grid, no WebGL.
export const W = 144;
export const H = 92;
export const CS = 17; // m per cell → a ~2.5 km × 1.6 km basin
export const WET = 0.1; // m — counts as meaningfully ponded

const MANNING = 0.03;

export class LabWorld {
  readonly z = new Float32Array(W * H);
  readonly h = new Float32Array(W * H);
  private readonly qx = new Float32Array((W - 1) * H);
  private readonly qy = new Float32Array(W * (H - 1));
  zLo = 0;
  zHi = 1;
  maxDepth = 0;
  pondedFrac = 0;
  deepestIdx = 0;
  private rainMs = 0;
  private drainMs = 0;

  constructor() {
    this.buildTerrain();
    this.measure();
  }

  /** Smooth elevation: a couple of broad hills and a few rounded basins where water collects. */
  private terrainZ(u: number, v: number): number {
    const g = (cx: number, cy: number, s: number): number =>
      Math.exp(-(((u - cx) ** 2) + ((v - cy) ** 2)) / (2 * s * s));
    return 11
      + 6.0 * g(0.24, 0.32, 0.19) + 5.0 * g(0.79, 0.28, 0.17) // hills
      - 7.5 * g(0.50, 0.60, 0.15) - 5.5 * g(0.20, 0.70, 0.11) // basins
      - 5.5 * g(0.82, 0.71, 0.12) - 3.8 * g(0.52, 0.24, 0.10)
      + 0.9 * Math.sin(u * 5.0) * Math.cos(v * 4.0); // gentle texture
  }

  private buildTerrain(): void {
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const zc = this.terrainZ(i / (W - 1), j / (H - 1));
        this.z[j * W + i] = zc;
        if (zc < lo) lo = zc;
        if (zc > hi) hi = zc;
      }
    }
    this.zLo = lo;
    this.zHi = hi;
  }

  reset(): void {
    this.h.fill(0);
    this.qx.fill(0);
    this.qy.fill(0);
    this.measure();
  }

  step(simSeconds: number, rainMs: number, drainMs: number): void {
    this.rainMs = rainMs;
    this.drainMs = drainMs;
    let remaining = simSeconds;
    let guard = 0;
    while (remaining > 1e-6 && guard < 5000) {
      let hmax = 0.05;
      for (let c = 0; c < W * H; c++) if (this.h[c] > hmax) hmax = this.h[c];
      const dt = Math.min(remaining, (0.42 * CS) / Math.sqrt(G * hmax));
      this.faceX(dt);
      this.faceY(dt);
      this.continuity(dt);
      remaining -= dt;
      guard++;
    }
    this.measure();
  }

  private face(a: number, b: number, q: number, dt: number): number {
    const hFlow = Math.max(this.z[a] + this.h[a], this.z[b] + this.h[b]) - Math.max(this.z[a], this.z[b]);
    if (hFlow <= 1e-3) return 0;
    const slope = (this.z[b] + this.h[b] - (this.z[a] + this.h[a])) / CS;
    const fric = 1 + (G * dt * MANNING * MANNING * Math.abs(q)) / Math.pow(hFlow, 7 / 3);
    return (q - G * hFlow * dt * slope) / fric;
  }

  private faceX(dt: number): void {
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W - 1; i++) {
        const a = j * W + i;
        const f = j * (W - 1) + i;
        this.qx[f] = this.face(a, a + 1, this.qx[f], dt);
      }
    }
  }

  private faceY(dt: number): void {
    for (let j = 0; j < H - 1; j++) {
      for (let i = 0; i < W; i++) {
        const a = j * W + i;
        const f = j * W + i;
        this.qy[f] = this.face(a, a + W, this.qy[f], dt);
      }
    }
  }

  private continuity(dt: number): void {
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const c = j * W + i;
        const qxIn = i > 0 ? this.qx[j * (W - 1) + i - 1] : 0;
        const qxOut = i < W - 1 ? this.qx[j * (W - 1) + i] : 0;
        const qyIn = j > 0 ? this.qy[(j - 1) * W + i] : 0;
        const qyOut = j < H - 1 ? this.qy[j * W + i] : 0;
        const next = this.h[c] + (dt / CS) * (qxIn - qxOut + qyIn - qyOut) + this.rainMs * dt;
        this.h[c] = Math.max(0, next - this.drainMs * dt);
      }
    }
  }

  private measure(): void {
    let maxDepth = 0;
    let deepest = 0;
    let wet = 0;
    for (let c = 0; c < W * H; c++) {
      if (this.h[c] > maxDepth) { maxDepth = this.h[c]; deepest = c; }
      if (this.h[c] > WET) wet++;
    }
    this.maxDepth = maxDepth;
    this.deepestIdx = deepest;
    this.pondedFrac = wet / (W * H);
  }
}
