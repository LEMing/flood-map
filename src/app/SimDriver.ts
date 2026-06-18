import * as THREE from 'three';
import type { Params } from '../config';
import type { Heightmap } from '../geo/heightmap';
import { type StatsData, formatDuration, formatVolume } from '../ui/stats';
import { stormIntensityMmHr } from '../sim/storm';
import { FloodSimulation } from '../sim/FloodSimulation';
import { Timeline } from '../sim/Timeline';
import { t } from '../i18n';

const MAX_STEPS_PER_FRAME = 48;
const READBACK_INTERVAL = 0.4; // seconds (wall clock)
const DEMO_SIM_SECONDS = 2.5 * 3600; // storm length precomputed for the demo timeline
const MAX_PRECOMPUTE_STEPS = 600; // sim substeps per captured frame
const TIMELINE_PLAY_SECONDS = 12; // real seconds to play the whole precomputed timeline

export type TimelineMode = 'live' | 'computing' | 'scrub';

/** What the driver needs back from the app each frame / on a stats refresh. */
export interface SimDriverHooks {
  /** Push the current stats/params into the controls panel. */
  refreshPanel(): void;
  /** Wire the current depth texture into the render meshes. */
  syncTextures(): void;
  /** Current smoothed FPS, for the stats line. */
  fps(): number;
}

/**
 * Runs the flood simulation: live CFL-substepped stepping, the precompute →
 * scrub demo timeline, the non-blocking GPU readback, and the derived stats.
 * Owns the sim, the timeline and the readback buffer (recreated per world via
 * setWorld); the app keeps the render-mesh wiring and param orchestration.
 */
export class SimDriver {
  private sim?: FloodSimulation;
  private timeline?: Timeline;
  private heightmap?: Heightmap;
  private buf?: Float32Array;
  private timelineMode: TimelineMode = 'live';
  private precomputeTargetFrames = 0;
  private precomputeFrameSec = 0;
  private simTime = 0;
  private rainedVolume = 0;
  private observedMaxDepth = 1;
  private stored = 0;
  private floodedFrac = 0;
  private peakDepthNow = 0;
  private sinceReadback = 0;
  private readbackPending = false;

  constructor(
    private readonly params: Params,
    private readonly stats: StatsData,
    private readonly hooks: SimDriverHooks,
  ) {}

  get hasSim(): boolean { return !!this.sim; }
  get mode(): TimelineMode { return this.timelineMode; }
  get readback(): Float32Array | undefined { return this.buf; }
  get waterStored(): number { return this.stored; }
  get simTimeSec(): number { return this.simTime; }
  get floodedFraction(): number { return this.floodedFrac; }
  get peakDepth(): number { return this.peakDepthNow; }

  setWorld(sim: FloodSimulation, timeline: Timeline, heightmap: Heightmap): void {
    this.sim = sim;
    this.timeline = timeline;
    this.heightmap = heightmap;
    this.buf = new Float32Array(sim.N * sim.N * 4);
    this.timelineMode = 'live';
    this.simTime = 0;
    this.rainedVolume = 0;
    this.observedMaxDepth = 1;
    this.stored = 0;
    this.sinceReadback = 0;
    this.readbackPending = false;
  }

  dispose(): void {
    this.sim?.dispose();
    this.timeline?.dispose();
    this.sim = undefined;
    this.timeline = undefined;
    this.heightmap = undefined;
    this.buf = undefined;
  }

  updateParams(params: Params): void { this.sim?.updateParams(params); }
  setSurface(tex: THREE.Texture | null): void { this.sim?.setSurface(tex); }
  requestInject(depthM: number): void { this.sim?.requestInject(depthM); }
  requestFill(level: number): void { this.sim?.requestFill(level); }

  currentDepthTexture(): THREE.Texture | null {
    if (this.timelineMode === 'scrub' && this.timeline) return this.timeline.tex;
    return this.sim?.waterTexture ?? null;
  }

  setLive(): void { this.timelineMode = 'live'; }
  toScrubIfReady(): void { if (this.timeline?.ready) this.timelineMode = 'scrub'; }

  /** Switch to manual scrub at the current timeline position (if precomputed). */
  scrub(): void {
    if (!this.timeline?.ready) return;
    this.timelineMode = 'scrub';
    this.params.timelinePlaying = false;
    this.showTimelineFrame();
    this.hooks.syncTextures(); // wire the scrubbed frame now; tick idles when not playing
  }

  reset(): void {
    this.sim?.reset();
    this.simTime = 0;
    this.rainedVolume = 0;
    this.observedMaxDepth = 1;
  }

  stepOnce(): void {
    if (!this.sim) return;
    const stepDt = this.params.mapSizeKm * 1000 / this.params.gridResolution * 0.1;
    this.sim.step(stepDt);
    this.simTime += stepDt;
  }

  /** Begin precomputing the storm into scrubbable frames. */
  beginPrecompute(): void {
    if (!this.sim || !this.timeline) return;
    this.reset();
    this.params.raining = true;
    this.params.floodLevelLive = false;
    this.params.timelinePlaying = false;
    this.params.timelinePos = 0;
    this.timeline.begin();
    this.timelineMode = 'computing';
    const N = this.sim.N;
    this.precomputeTargetFrames = Math.max(24, Math.min(72, Math.floor(150e6 / (N * N * 16))));
    this.precomputeFrameSec = DEMO_SIM_SECONDS / this.precomputeTargetFrames;
  }

  /** Per-frame: run the active mode (computing / scrub / live). Returns true if
   *  the displayed water could have changed this frame (drives render-on-demand);
   *  the expensive GPU readback is skipped while the sim is frozen. */
  tick(dt: number): boolean {
    if (!this.sim) return false;
    if (this.timelineMode === 'computing') {
      this.tickPrecompute(); // fills the readback synchronously + captures
      this.computeStats(this.simTime);
      this.hooks.syncTextures();
      return true;
    }
    if (this.timelineMode === 'scrub') {
      if (!this.params.timelinePlaying) return false; // static frame already wired by scrub()
      this.params.timelinePos += dt / TIMELINE_PLAY_SECONDS;
      if (this.params.timelinePos > 1) this.params.timelinePos = 0; // loop
      this.hooks.refreshPanel();
      this.showTimelineFrame();
      this.hooks.syncTextures();
      return true;
    }
    let stepped = false;
    if (this.params.floodLevelLive && this.heightmap) {
      this.sim.requestFill(this.heightmap.min + this.params.fillLevelM, true);
      this.sim.step(0); // set water exactly to the level, no dynamics
      stepped = true;
    } else if (this.params.running) {
      this.advance(dt);
      stepped = true;
    }
    this.hooks.syncTextures(); // cheap: keeps mesh depth-texture refs valid (incl. first frame after build)
    if (stepped) this.pumpStatsReadback(dt); // skip the gl.readPixels stall + O(N²) scan on a frozen sim
    return stepped;
  }

  private advance(dtReal: number): void {
    this.stepSimSeconds(dtReal * this.params.timeScale, MAX_STEPS_PER_FRAME);
  }

  /** Advance the sim by a fixed number of simulated seconds (CFL-substepped). */
  private stepSimSeconds(simSeconds: number, maxSteps: number): void {
    if (!this.sim) return;
    // Drive rain from the storm hyetograph (peaked залповый ливень) over sim time.
    const intensityMmHr = this.params.raining
      ? stormIntensityMmHr(this.params.stormType, this.simTime, this.params.intensityMmPerHr)
      : 0;
    this.sim.setRainRateMmPerHr(intensityMmHr);

    const g = Math.max(0.1, this.params.gravity);
    const cellSize = this.sim.cellSize;
    const refDepth = Math.max(1, this.observedMaxDepth);
    const cflMax = (0.45 * cellSize) / Math.sqrt(g * refDepth);

    const stepDt = Math.min(simSeconds / this.params.substeps, cflMax);
    let remaining = simSeconds;
    let steps = 0;
    while (remaining > 1e-6 && steps < maxSteps && stepDt > 0) {
      const dt = Math.min(stepDt, remaining);
      this.sim.step(dt);
      remaining -= dt;
      steps++;
    }
    const simulated = simSeconds - remaining;
    this.simTime += simulated;
    this.rainedVolume += (intensityMmHr / 1000 / 3600) * this.rainArea() * simulated;
  }

  private tickPrecompute(): void {
    if (!this.sim || !this.timeline || !this.buf) return;
    this.stepSimSeconds(this.precomputeFrameSec, MAX_PRECOMPUTE_STEPS);
    this.sim.readWater(this.buf);
    let maxEver = 1;
    for (let i = 1; i < this.buf.length; i += 4) {
      if (this.buf[i] > maxEver) maxEver = this.buf[i];
    }
    this.observedMaxDepth = maxEver;
    this.timeline.capture(this.buf, this.simTime);
    this.timeline.progress = this.timeline.count / this.precomputeTargetFrames;
    if (this.timeline.count >= this.precomputeTargetFrames) {
      this.timeline.finish();
      this.timelineMode = 'scrub';
      this.params.timelinePos = 0;
      this.params.timelinePlaying = true; // auto-play the finished scene once
      this.showTimelineFrame();
      this.hooks.refreshPanel();
    }
  }

  private showTimelineFrame(): void {
    if (!this.timeline || !this.buf) return;
    const f = this.timeline.showAt(this.params.timelinePos);
    if (!f) return;
    this.buf.set(f.rgba);
    this.computeStats(f.time);
  }

  status(): string {
    if (this.timelineMode === 'computing' && this.timeline) {
      return t('demo.stComputing', { pct: Math.round(this.timeline.progress * 100) });
    }
    if (this.timelineMode === 'scrub') return t('demo.stReady');
    return t('demo.stLive');
  }

  private rainArea(): number {
    const size = this.params.mapSizeKm * 1000;
    if (this.params.rainFootprint === 'uniform') return size * size;
    const frac = Math.min(1, Math.PI * this.params.spotRadius * this.params.spotRadius * 0.5);
    return size * size * frac;
  }

  private updateStats(): void {
    if (!this.sim || !this.buf) return;
    this.sim.readWater(this.buf);
    this.computeStats(this.simTime);
  }

  /** Non-blocking stats: poll a finished async readback, then kick the next one.
   * Avoids the ~26ms gl.readPixels stall (at 1024) every refresh interval. */
  private pumpStatsReadback(dt: number): void {
    if (!this.sim || !this.buf) return;
    if (this.readbackPending && this.sim.pollReadback(this.buf)) {
      this.readbackPending = false;
      this.computeStats(this.simTime);
    }
    this.sinceReadback += dt;
    if (!this.readbackPending && this.sinceReadback >= READBACK_INTERVAL) {
      this.sinceReadback = 0;
      if (this.sim.requestReadback()) this.readbackPending = true;
      else this.updateStats(); // no WebGL2 fence support → sync fallback
    }
  }

  private computeStats(simTime: number): void {
    if (!this.sim || !this.buf) return;
    const N = this.sim.N;
    const cellArea = this.sim.cellSize * this.sim.cellSize;
    let stored = 0;
    let flooded = 0;
    let maxNow = 0;
    let maxEver = 0;
    for (let i = 0; i < N * N; i++) {
      const d = this.buf[i * 4];
      const m = this.buf[i * 4 + 1];
      stored += d;
      if (d > 0.05) flooded++;
      if (d > maxNow) maxNow = d;
      if (m > maxEver) maxEver = m;
    }
    if (this.timelineMode !== 'scrub') this.observedMaxDepth = Math.max(1, maxEver);
    this.stored = stored * cellArea;
    this.floodedFrac = flooded / (N * N);
    this.peakDepthNow = maxNow;
    this.stats.simTime = formatDuration(simTime);
    this.stats.rained = formatVolume(this.rainedVolume);
    this.stats.stored = formatVolume(stored * cellArea);
    this.stats.floodedArea = `${((flooded / (N * N)) * 100).toFixed(1)} %`;
    this.stats.maxDepth = `${maxNow.toFixed(2)} m (max ${maxEver.toFixed(2)})`;
    this.stats.fps = this.hooks.fps().toFixed(0);
    this.stats.timelineStatus = this.status();
    this.hooks.refreshPanel();
  }
}
