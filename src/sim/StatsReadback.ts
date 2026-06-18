// Non-blocking GPU stats readback: poll a finished async readback, then kick the
// next one, so the ~26 ms gl.readPixels stall (at 1024) is amortized instead of
// hit every refresh. Falls back to a sync read where WebGL2 fences are absent.

interface ReadbackSim {
  pollReadback(buf: Float32Array): boolean;
  requestReadback(): boolean;
  readWater(buf: Float32Array): void;
}

export class StatsReadback {
  private pending = false;
  private since = 0;

  constructor(private readonly intervalSec: number) {}

  reset(): void {
    this.pending = false;
    this.since = 0;
  }

  /** Advance by `dt`; calls `onReady()` whenever a fresh frame lands in `buf`. */
  pump(dt: number, sim: ReadbackSim, buf: Float32Array, onReady: () => void): void {
    if (this.pending && sim.pollReadback(buf)) {
      this.pending = false;
      onReady();
    }
    this.since += dt;
    if (!this.pending && this.since >= this.intervalSec) {
      this.since = 0;
      if (sim.requestReadback()) this.pending = true;
      else { sim.readWater(buf); onReady(); } // no fence support → sync fallback
    }
  }
}
