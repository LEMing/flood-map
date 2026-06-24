import { G } from './labShared';
import { decodeCity, CITY_W, CITY_H, CITY_SIZE_M } from './labCityData';

// The single source of truth for the physics lab: ONE 2D local-inertial shallow-water world
// over a REAL place — a baked Copernicus GLO-30 DEM + OpenStreetMap buildings for one of the
// demo cities (see labCityData). Both the top-down map and the side cross-section are pure
// renderers of THIS world (same z, same h), so the two views are literally the same city. The
// scheme (faces carry discharge q with Manning friction; depth updates by continuity) is the
// same one the full model runs — here on a tiny CPU grid baked to static data, no WebGL.
export const W = CITY_W;
export const H = CITY_H;
export const CS = CITY_SIZE_M / CITY_W; // m per cell (square cells; the bake window is W:H proportioned)
export const WET = 0.12; // m — counts as meaningfully ponded
export const SLICE_ROW = 76; // the cross-section cut: a street row that crosses Boulder Creek (the low ground)

const MANNING = 0.03;
const TARGET_RELIEF = 18; // m — the real DEM is normalised to this relief so a few m of flood stays visible
const BASEFLOW = 0.04; // m — thin permanent film in the real watercourse (Boulder Creek)

export interface Rect { x: number; y: number; w: number; h: number }

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
    this.buildFromCity();
    let open = 0;
    for (let c = 0; c < W * H; c++) if (!this.solid[c]) open++;
    this.openCount = Math.max(1, open);
    this.reset();
  }

  /** Load the baked real city: normalise the DEM to a lab-friendly relief, take buildings as
   *  solid obstacles and the mapped watercourse as the drainage channel. */
  private buildFromCity(): void {
    const city = decodeCity();
    let lo = Infinity;
    let hi = -Infinity;
    for (let c = 0; c < W * H; c++) {
      const zc = city.zNorm[c] * TARGET_RELIEF;
      this.z[c] = zc;
      this.solid[c] = city.building[c];
      this.chan[c] = city.water[c] && !city.building[c] ? 1 : 0;
      if (zc < lo) lo = zc;
      if (zc > hi) hi = zc;
    }
    this.zLo = lo;
    this.zHi = hi;
    this.buildRects();
  }

  /** Greedy-merge the per-cell building mask into rectangles for the vector building pass. */
  private buildRects(): void {
    const used = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!this.solid[y * W + x] || used[y * W + x]) continue;
        const r = this.rectAt(x, y, used);
        for (let yy = y; yy < y + r.h; yy++) for (let xx = x; xx < x + r.w; xx++) used[yy * W + xx] = 1;
        this.rects.push({ x, y, w: r.w, h: r.h });
      }
    }
  }

  private rectAt(x: number, y: number, used: Uint8Array): { w: number; h: number } {
    let w = 1;
    while (x + w < W && this.solid[y * W + x + w] && !used[y * W + x + w]) w++;
    let h = 1;
    while (y + h < H && this.rowFree(x, w, y + h, used)) h++;
    return { w, h };
  }

  private rowFree(x: number, w: number, y: number, used: Uint8Array): boolean {
    for (let k = 0; k < w; k++) { const c = y * W + x + k; if (!this.solid[c] || used[c]) return false; }
    return true;
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

  /** Readout over all non-building cells (incl. the watercourse) — the real flood extent. */
  private measure(): void {
    let maxDepth = 0;
    let deepest = 0;
    let wet = 0;
    for (let c = 0; c < W * H; c++) {
      if (this.solid[c]) continue;
      if (this.h[c] > maxDepth) { maxDepth = this.h[c]; deepest = c; }
      if (this.h[c] > WET) wet++;
    }
    this.maxDepth = maxDepth;
    this.deepestIdx = deepest;
    this.pondedFrac = wet / this.openCount;
  }
}
