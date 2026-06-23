import { G } from './labShared';

// The single source of truth for the physics lab: ONE 2D local-inertial shallow-water
// world over a synthetic urban basin with a gridded neighborhood, a shallow collector
// street and a low plaza. Both the top-down map and the side cross-section are pure renderers
// of THIS world (same z, same h), so the two views are literally the same place. The
// scheme (faces carry discharge q with Manning friction; depth updates by continuity)
// is the same one the full model runs — here on a tiny CPU grid, no WebGL.
export const W = 160;
export const H = 96;
export const CS = 12.5; // m per cell -> a 2000 m x 1200 m neighborhood
export const WET = 0.12; // m — counts as meaningfully ponded
export const SLICE_ROW = 50; // the cross-section cut: a building row beside the flooded collector street

const MANNING = 0.03;
const PERIOD = 8; // block pitch (cells) → 100 m
const BLOCK = 5; // building footprint → 3-cell (37.5 m) streets
const PLAZA_R = 9; // plaza basin radius (cells)
const PLAZA_U = 0.54;
const PLAZA_V = 0.47;
const BASEFLOW = 0.035; // m — thin permanent film in the collector street

export interface Rect { x: number; y: number; w: number; h: number }

const thalweg = (u: number): number => 0.47 + 0.035 * Math.sin(2 * Math.PI * 1.15 * u);

export class LabWorld {
  readonly z = new Float32Array(W * H);
  readonly h = new Float32Array(W * H);
  private readonly qx = new Float32Array((W - 1) * H);
  private readonly qy = new Float32Array(W * (H - 1));
  readonly solid = new Uint8Array(W * H);
  readonly chan = new Uint8Array(W * H); // river-channel cells (excluded from the readout)
  readonly rects: Rect[] = [];
  zLo = 0;
  zHi = 1;
  maxDepth = 0;
  pondedFrac = 0;
  deepestIdx = 0;
  private openCount = 1;
  private rainMs = 0;
  private drainMs = 0;

  constructor() {
    this.buildTerrain();
    this.buildBlocks();
    let open = 0;
    for (let c = 0; c < W * H; c++) if (!this.solid[c] && !this.chan[c]) open++;
    this.openCount = Math.max(1, open);
    this.reset();
  }

  private buildTerrain(): void {
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const u = i / (W - 1);
        const v = j / (H - 1);
        const regionalSlope = 4.2 - 0.55 * u + 0.3 * (v - 0.5);
        const edgeCurb =
          0.7 * Math.exp(-(((u - 0.03) / 0.035) ** 2)) +
          0.55 * Math.exp(-(((u - 0.97) / 0.035) ** 2));
        const cityCrown = 0.9 * ((u - 0.53) ** 2) + 0.65 * ((v - 0.5) ** 2);
        const dr = v - thalweg(u);
        const collector = 0.85 * Math.exp(-(dr * dr) / (2 * 0.035 * 0.035));
        const di = i - PLAZA_U * (W - 1);
        const dj = j - PLAZA_V * (H - 1);
        const plaza = 1.15 * Math.exp(-(di * di + dj * dj) / (2 * PLAZA_R * PLAZA_R));
        const streetTexture = 0.08 * Math.sin(2 * Math.PI * u * 3.2) * Math.cos(2 * Math.PI * v * 2.1);
        const zc = regionalSlope + edgeCurb + cityCrown + streetTexture - collector - plaza;
        this.z[j * W + i] = zc;
        if (collector > 0.5) this.chan[j * W + i] = 1;
        lo = Math.min(lo, zc);
        hi = Math.max(hi, zc);
      }
    }
    this.zLo = lo;
    this.zHi = hi;
  }

  private buildBlocks(): void {
    for (let by = 0; by < H; by += PERIOD) {
      for (let bx = 0; bx < W; bx += PERIOD) {
        if (!this.blockOk(bx, by)) continue;
        const rw = Math.min(BLOCK, W - bx);
        const rh = Math.min(BLOCK, H - by);
        if (rw < 2 || rh < 2) continue;
        this.rects.push({ x: bx, y: by, w: rw, h: rh });
        for (let j = by; j < by + rh; j++) for (let i = bx; i < bx + rw; i++) this.solid[j * W + i] = 1;
      }
    }
  }

  /** Keep blocks on the city bench, off the plaza and out of the river channel. */
  private blockOk(bx: number, by: number): boolean {
    const cx = bx + BLOCK / 2;
    const cy = by + BLOCK / 2;
    const u = cx / (W - 1);
    const v = cy / (H - 1);
    if (u < 0.29 || u > 0.82 || v < 0.2 || v > 0.82) return false;
    const di = cx - PLAZA_U * (W - 1);
    const dj = cy - PLAZA_V * (H - 1);
    if (Math.hypot(di, dj) < PLAZA_R + 3) return false;
    return Math.abs(v - thalweg(u)) >= 0.045;
  }

  reset(): void {
    this.h.fill(0);
    this.qx.fill(0);
    this.qy.fill(0);
    for (let c = 0; c < W * H; c++) if (this.chan[c] && !this.solid[c]) this.h[c] = BASEFLOW;
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

  private continuity(dt: number): void {
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const c = j * W + i;
        if (this.solid[c]) continue;
        const qxIn = i > 0 ? this.qx[j * (W - 1) + i - 1] : 0;
        const qxOut = i < W - 1 ? this.qx[j * (W - 1) + i] : 0;
        const qyIn = j > 0 ? this.qy[(j - 1) * W + i] : 0;
        const qyOut = j < H - 1 ? this.qy[j * W + i] : 0;
        const next = this.h[c] + (dt / CS) * (qxIn - qxOut + qyIn - qyOut) + this.rainMs * dt;
        this.h[c] = Math.max(0, next - this.drainMs * dt);
      }
    }
  }

  /** Readout over OPEN, non-channel cells — the human-meaningful street/plaza flooding. */
  private measure(): void {
    let maxDepth = 0;
    let deepest = 0;
    let wet = 0;
    for (let c = 0; c < W * H; c++) {
      if (this.solid[c] || this.chan[c]) continue;
      if (this.h[c] > maxDepth) { maxDepth = this.h[c]; deepest = c; }
      if (this.h[c] > WET) wet++;
    }
    this.maxDepth = maxDepth;
    this.deepestIdx = deepest;
    this.pondedFrac = wet / this.openCount;
  }
}
