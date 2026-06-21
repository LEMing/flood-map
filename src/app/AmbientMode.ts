import * as THREE from 'three';
import type { Params } from '../config';
import type { SimDriver } from './SimDriver';
import type { SceneManager } from '../render/SceneManager';

export interface AmbientModeHost {
  readonly params: Params;
  readonly simDriver: SimDriver;
  readonly scene: SceneManager;
  applyParams(): void;
  renderCaptureFrame(dt: number): void;
}

const AMBIENT_FPS = 30;
const FRAME_MS = 1000 / AMBIENT_FPS;
const AMBIENT_RENDER_SCALE = 0.65; // ambient is a backdrop, not a crisp sim — save fill-rate
const AUTO_FREEZE_SEC = 18; // after the flood loop has shown its arc, stop drawing (static frame)
const ORBIT_RAD = Math.PI / 14; // a gentle sway, not a full sweep (this runs as a backdrop)
const ORBIT_PERIOD_SEC = 44; // one slow there-and-back sway
const UP = new THREE.Vector3(0, 1, 0);

// Visual params the ambient profile mutates; snapshotted so the interactive sim restores clean.
const TOUCHED: Array<keyof Params> = [
  'raining', 'running', 'storm', 'timelinePos', 'timelinePlaying', 'autoQuality', 'renderScale',
];

/**
 * The landing's living-flood backdrop: precompute the storm once, then loop the scrubbable
 * timeline with a slow camera sway behind the glass card — the real sim as ambient art, with
 * no chrome and no recorder. Self-driven rAF (App's loop steps aside while this runs), capped to
 * 30 fps, paused on a hidden tab, and frozen on a static frame after a short while so a marketing
 * page never burns the GPU indefinitely. Restores every touched param on exit so the handoff into
 * the interactive sim / cinematic is clean.
 */
export class AmbientMode {
  private readonly startOffset = new THREE.Vector3();
  private snapshot?: Partial<Params>;
  private controlsWasEnabled = true;
  private aborted = false;
  private elapsed = 0; // wall seconds of drawn frames, drives the orbit sway
  private scrubTime = 0; // seconds spent looping the flood, drives the auto-freeze
  private lastFrame = 0;

  constructor(private readonly host: AmbientModeHost) {}

  start(): void {
    const p = this.host.params;
    this.snapshot = {};
    for (const k of TOUCHED) (this.snapshot as Record<string, unknown>)[k] = p[k];

    // Own the camera: disable user orbit so nothing fights the sway (App's loop is bypassed too).
    this.controlsWasEnabled = this.host.scene.controls.enabled;
    this.host.scene.controls.enabled = false;
    this.startOffset.copy(this.host.scene.camera.position).sub(this.host.scene.controls.target);

    p.storm = false; // skip the raymarched cloud dome — too costly for a backdrop
    p.autoQuality = false; // we pin renderScale ourselves
    p.renderScale = AMBIENT_RENDER_SCALE;
    this.host.applyParams();

    // Light demo precompute (NOT until-dry): a cheap fixed-window storm arc that finishPrecompute
    // flips to an auto-looping scrub — the existing tickScrub then loops it with no extra code.
    this.host.simDriver.beginPrecompute();
    this.host.applyParams();

    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    if (this.aborted) return;
    requestAnimationFrame(this.frame);
    if (document.hidden) { this.lastFrame = now; return; } // pause on a hidden tab
    const since = now - this.lastFrame;
    if (since < FRAME_MS) return; // 30 fps cap
    const dt = Math.min(0.05, since / 1000);
    this.lastFrame = now;

    if (this.host.simDriver.mode === 'scrub') {
      if (this.scrubTime > AUTO_FREEZE_SEC) return; // frozen on the last drawn frame
      this.scrubTime += dt;
    }
    this.elapsed += dt;
    this.host.simDriver.tick(dt); // computing: build the timeline; scrub: auto-advance + loop
    this.orbit();
    this.host.renderCaptureFrame(dt);
  };

  /** A slow sinusoidal sway around the framing WorldBuilder set — eases at the extremes and never
   *  drifts away, so the frozen end frame is a sensible composition. */
  private orbit(): void {
    const cam = this.host.scene.camera;
    const target = this.host.scene.controls.target;
    const angle = Math.sin((this.elapsed / ORBIT_PERIOD_SEC) * 2 * Math.PI) * ORBIT_RAD;
    cam.position.copy(target).add(this.startOffset.clone().applyAxisAngle(UP, angle));
    cam.lookAt(target);
  }

  stop(): void {
    this.aborted = true;
    this.host.scene.controls.enabled = this.controlsWasEnabled;
    if (this.snapshot) Object.assign(this.host.params, this.snapshot);
    this.host.simDriver.setLive();
    this.host.simDriver.reset();
    this.host.applyParams();
  }
}
