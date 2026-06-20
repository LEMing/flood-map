import * as THREE from 'three';
import type { Params } from '../config';
import type { Heightmap } from '../geo/heightmap';
import { type StatsData, formatDuration, formatVolume, formatWaterBalance } from '../ui/stats';
import { stormIntensityMmHr, stormDurationSec } from '../sim/storm';
import { FloodSimulation } from '../sim/FloodSimulation';
import { Timeline } from '../sim/Timeline';
import { StatsReadback } from '../sim/StatsReadback';
import {
  STORM_FRAMES, STEP_TAIL_SEC, MAX_CAPTURE_SIM_SECONDS, STORM_EVAP_PER_HR, TAIL_EVAP_PER_HR,
  captureGrid, videoFrameBudget, scanWater, isFullyDrained, captureFrame,
} from '../sim/videoPrecompute';
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
  // Until-dry video capture state (unused on the legacy fixed-window demo path).
  private untilDry = false;
  private maxFrames = 0;
  private stepStorm = 0;
  private peakStored = 0;
  private peakFlooded = 0;
  private timeOfPeak = 0;
  private dryStreak = 0;
  private captureN = 0;
  private captureFactor = 1;
  private captureBuf?: Float32Array;
  private simTime = 0;
  private rainedVolume = 0;
  private injectedVolume = 0; // cumulative water added by manual dumps (m³), for the budget
  private observedMaxDepth = 1;
  private observedMaxVel = 0; // peak flow speed (m/s) for the velocity-aware CFL
  private stored = 0;
  private floodedFrac = 0;
  private peakDepthNow = 0;
  private readonly statsReadback = new StatsReadback(READBACK_INTERVAL);

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
    this.rainedVolume = this.injectedVolume = 0;
    this.observedMaxDepth = 1; this.observedMaxVel = 0;
    this.stored = 0;
    this.statsReadback.reset();
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
  setSurface(t: THREE.Texture | null): void { this.sim?.setSurface(t); }
  setSewer(t: THREE.Texture | null): void { this.sim?.setSewer(t); }
  requestInject(depthM: number): void {
    this.injectedVolume += depthM * this.rainArea(); // dump uses the rain footprint → exact m³
    this.sim?.requestInject(depthM);
  }
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
    this.simTime = 0; this.rainedVolume = this.injectedVolume = 0;
    this.observedMaxDepth = 1; this.observedMaxVel = 0;
  }

  stepOnce(): void {
    if (!this.sim) return;
    const stepDt = this.params.mapSizeKm * 1000 / this.params.gridResolution * 0.1;
    this.sim.step(stepDt); this.sim.sewerStep(stepDt);
    this.simTime += stepDt;
  }

  /** Begin precomputing the storm into scrubbable frames. `untilDry` (video)
   *  captures the full rain→flood→drained arc and self-terminates at dryness;
   *  otherwise a fixed `simSeconds` window is sampled (the demo timeline). */
  beginPrecompute(opts: { simSeconds?: number; untilDry?: boolean } = {}): void {
    if (!this.sim || !this.timeline) return;
    this.reset();
    this.params.raining = true;
    this.params.floodLevelLive = false;
    this.params.timelinePlaying = false;
    this.params.timelinePos = 0;
    this.timeline.begin();
    this.timelineMode = 'computing';
    const N = this.sim.N;
    this.untilDry = !!opts.untilDry;
    // Snapshots are downsampled to the capture grid so a 1024/2048 sim doesn't
    // blow the timeline RAM (a full 2048² float frame is ~67 MB).
    const { captureN, factor } = this.untilDry ? captureGrid(N) : { captureN: N, factor: 1 };
    this.captureN = captureN;
    this.captureFactor = factor;
    this.timeline.configure(captureN);
    this.captureBuf = factor > 1 ? new Float32Array(captureN * captureN * 4) : undefined;

    if (this.untilDry) {
      this.maxFrames = videoFrameBudget(captureN);
      this.stepStorm = stormDurationSec(this.params.stormType) / STORM_FRAMES;
      this.peakStored = 0;
      this.peakFlooded = 0;
      this.timeOfPeak = 0;
      this.dryStreak = 0;
    } else {
      this.precomputeTargetFrames = Math.max(24, Math.min(72, Math.floor(150e6 / (N * N * 16))));
      this.precomputeFrameSec = (opts.simSeconds ?? DEMO_SIM_SECONDS) / this.precomputeTargetFrames;
    }
  }

  /** True once the precompute has captured a full scrubbable timeline. */
  get timelineReady(): boolean { return !!this.timeline?.ready; }
  /** 0..1 precompute progress (drives the video "simulating…" bar). */
  get precomputeProgress(): number { return this.timeline?.progress ?? 0; }

  /** Show an interpolated timeline frame at `pos` and return its sim time —
   *  the video recorder's scrub driver. */
  seekTimeline(pos: number): number {
    if (!this.timeline) return 0;
    this.timelineMode = 'scrub';
    const f = this.timeline.sampleAt(pos);
    if (!f) return 0;
    this.simTime = f.time;
    this.hooks.syncTextures();
    return f.time;
  }

  /** Per-frame: run the active mode (computing / scrub / live). Returns true if
   *  the displayed water could have changed this frame (drives render-on-demand);
   *  the expensive GPU readback is skipped while the sim is frozen. */
  tick(dt: number): boolean {
    if (!this.sim) return false;
    if (this.timelineMode === 'computing') {
      this.tickPrecompute(); // steps, captures, computes stats + checks dryness
      this.hooks.syncTextures();
      return true;
    }
    if (this.timelineMode === 'scrub') return this.tickScrub(dt);
    return this.tickLive(dt);
  }

  private tickScrub(dt: number): boolean {
    if (!this.params.timelinePlaying) return false; // static frame already wired by scrub()
    this.params.timelinePos += dt / TIMELINE_PLAY_SECONDS;
    if (this.params.timelinePos > 1) this.params.timelinePos = 0; // loop
    this.hooks.refreshPanel();
    this.showTimelineFrame();
    this.hooks.syncTextures();
    return true;
  }

  private tickLive(dt: number): boolean {
    if (!this.sim) return false;
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
    // Skip the gl.readPixels stall + O(N²) scan on a frozen sim.
    if (stepped && this.buf) {
      this.statsReadback.pump(dt, this.sim, this.buf, () => this.computeStats(this.simTime));
    }
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
    // Velocity-aware CFL (Bates et al. α≈0.7): supercritical flow advects at |v|+√(g·h).
    const cflMax = (0.7 * cellSize) / (this.observedMaxVel + Math.sqrt(g * refDepth));

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
    if (simulated > 0) this.sim.sewerStep(simulated); this.simTime += simulated; // sewer once per frame (slow dynamics)
    this.rainedVolume += (intensityMmHr / 1000 / 3600) * this.rainArea() * simulated;
  }

  private tickPrecompute(): void {
    if (!this.sim || !this.timeline || !this.buf) return;
    const stormDur = stormDurationSec(this.params.stormType);
    let stepSec = this.precomputeFrameSec;
    if (this.untilDry) {
      const inStorm = this.simTime < stormDur;
      stepSec = inStorm ? this.stepStorm : STEP_TAIL_SEC;
      // Low evap while raining (flood pools), high after (city dries fully + fast).
      this.params.evaporationPerHr = inStorm ? STORM_EVAP_PER_HR : TAIL_EVAP_PER_HR;
      this.sim.updateParams(this.params);
    }
    this.stepSimSeconds(stepSec, MAX_PRECOMPUTE_STEPS);
    this.sim.readWater(this.buf);
    this.computeStats(this.simTime); // stored / floodedFrac / observedMaxDepth for THIS frame
    this.timeline.capture(captureFrame(this.buf, this.captureBuf, this.captureN, this.captureFactor), this.simTime);
    if (this.untilDry) {
      this.advanceUntilDry(stormDur);
    } else {
      this.timeline.progress = this.timeline.count / this.precomputeTargetFrames;
      if (this.timeline.count >= this.precomputeTargetFrames) this.finishPrecompute();
    }
  }

  /** Until-dry (video) capture: track peaks, drive the monotonic bar, and finish
   *  once the water has receded to dryness (or a hard cap binds). */
  private advanceUntilDry(stormDur: number): void {
    if (!this.timeline) return;
    if (this.stored > this.peakStored) { this.peakStored = this.stored; this.timeOfPeak = this.simTime; }
    this.peakFlooded = Math.max(this.peakFlooded, this.floodedFrac);
    this.timeline.progress = Math.min(1, this.simTime / MAX_CAPTURE_SIM_SECONDS);
    const dry = this.simTime >= stormDur && this.simTime >= this.timeOfPeak
      && isFullyDrained(this.stored, this.peakStored, this.floodedFrac, this.peakFlooded);
    this.dryStreak = dry ? this.dryStreak + 1 : 0;
    if (this.dryStreak >= 2 || this.timeline.count >= this.maxFrames || this.simTime >= MAX_CAPTURE_SIM_SECONDS) {
      this.finishPrecompute();
    }
  }

  private finishPrecompute(): void {
    if (!this.timeline) return;
    this.timeline.finish();
    this.timelineMode = 'scrub';
    this.params.timelinePos = 0;
    this.params.timelinePlaying = true; // auto-play the finished scene once
    this.showTimelineFrame();
    this.hooks.refreshPanel();
  }

  private showTimelineFrame(): void {
    if (!this.timeline || !this.buf) return;
    const f = this.timeline.showAt(this.params.timelinePos);
    if (!f) return;
    // Downsampled (video) frames don't fit the full-res buf — the visuals come
    // from the timeline texture (already uploaded by showAt); just sync the clock.
    if (this.captureFactor > 1) {
      this.stats.simTime = formatDuration(f.time);
      this.hooks.refreshPanel();
      return;
    }
    this.buf.set(f.rgba);
    this.computeStats(f.time);
  }

  status(): string {
    const tl = this.timeline;
    if (this.timelineMode === 'computing' && tl) return t('demo.stComputing', { pct: Math.round(tl.progress * 100) });
    return this.timelineMode === 'scrub' ? t('demo.stReady') : t('demo.stLive');
  }

  private rainArea(): number {
    const size = this.params.mapSizeKm * 1000;
    if (this.params.rainFootprint === 'uniform') return size * size;
    const frac = Math.min(1, Math.PI * this.params.spotRadius * this.params.spotRadius * 0.5);
    return size * size * frac;
  }

  private computeStats(simTime: number): void {
    if (!this.sim || !this.buf) return;
    const N = this.sim.N;
    const cellArea = this.sim.cellSize * this.sim.cellSize;
    const { stored, flooded, maxNow, maxEver, maxVel } = scanWater(this.buf, N * N);
    if (this.timelineMode !== 'scrub') { this.observedMaxDepth = Math.max(1, maxEver); this.observedMaxVel = maxVel; }
    this.stored = stored * cellArea;
    this.floodedFrac = flooded / (N * N);
    this.peakDepthNow = maxNow;
    this.stats.simTime = formatDuration(simTime);
    this.stats.rained = formatVolume(this.rainedVolume); this.stats.stored = formatVolume(stored * cellArea);
    this.stats.balance = formatWaterBalance(this.rainedVolume, this.injectedVolume, stored * cellArea);
    const floodedPct = (flooded / (N * N)) * 100;
    this.stats.floodedArea = floodedPct > 0 && floodedPct < 1 ? '<1 %' : `~${Math.round(floodedPct)} %`;
    this.stats.maxDepth = `~${maxNow.toFixed(1)} m (max ~${maxEver.toFixed(1)})`;
    this.stats.fps = this.hooks.fps().toFixed(0); this.stats.timelineStatus = this.status();
    this.hooks.refreshPanel();
  }
}
