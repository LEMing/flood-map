import * as THREE from 'three';
import type { Params } from '../config';
import type { SimDriver } from './SimDriver';
import type { SceneManager } from '../render/SceneManager';
import { stormIntensityMmHr, stormDurationSec } from '../sim/storm';
import { Recorder } from '../video/Recorder';
import { buildVideoLabel } from '../video/videoLabel';
import { el, button } from '../ui/dom';
import { showToast } from '../ui/toast';
import { t } from '../i18n';

export interface VideoModeHost {
  readonly params: Params;
  readonly simDriver: SimDriver;
  readonly scene: SceneManager;
  placeName(): string;
  applyParams(): void;
  refreshPanel(): void;
  renderCaptureFrame(dt: number): void;
  setCapturing(on: boolean): void;
  onExit(): void;
  replay(): void;
}

const VIDEO_DURATION_SEC = 30;
const VIDEO_FPS = 30;
const VIDEO_FRAMES = Math.round(VIDEO_DURATION_SEC * VIDEO_FPS); // even-spaced scrub positions
const ORBIT_RAD = Math.PI / 9; // ~20° gentle cinematic sweep over the clip
const RAIN_VISUAL_CUTOFF_MMHR = 0.5;

// Params the capture profile mutates; snapshotted so the live sim is restored after.
const TOUCHED: Array<keyof Params> = [
  'stormType', 'storm', 'raining', 'running', 'evaporationPerHr', 'rainMultiplier', 'stormSpeed',
  'rainFootprint', 'timelinePos', 'timelinePlaying',
];

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Records an accelerated cloudburst over the current world to a downloadable clip:
 * precompute the WHOLE storm arc (rain → pools → drains to a stable state), then scrub
 * the interpolated timeline across a fixed 30 s timelapse — every frame at an even
 * position, encoded with explicit WebCodecs timestamps, so the result is smooth and
 * exactly 30 s. Shows progress, then an in-page player with download / replay actions.
 */
export class VideoMode {
  private readonly overlay: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly barFill: HTMLDivElement;
  private readonly startOffset = new THREE.Vector3();
  private outputExt = 'mp4';
  private aborted = false;
  private resultUrl?: string;

  constructor(private readonly host: VideoModeHost) {
    this.overlay = el('div', 'vm-overlay');
    const panel = el('div', 'vm-progress');
    this.title = el('div', 'vm-title');
    const bar = el('div', 'vm-bar');
    this.barFill = el('div', 'vm-bar-fill');
    bar.appendChild(this.barFill);
    const cancel = button('vm-cancel', '✕');
    cancel.title = t('video.exit');
    cancel.addEventListener('click', () => this.goHome());
    panel.append(this.title, bar, cancel);
    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);
  }

  async run(): Promise<void> {
    const snapshot = this.snapshot();
    this.applyCaptureProfile();
    this.host.applyParams();

    let blob: Blob | null = null;
    let failed = false;
    try {
      this.host.simDriver.beginPrecompute({ untilDry: true });
      this.host.applyParams();
      await this.awaitPrecompute();
      if (!this.aborted) blob = await this.record();
    } catch {
      failed = true;
    }

    this.host.setCapturing(false);
    this.restore(snapshot);
    this.host.simDriver.setLive();
    this.host.simDriver.reset();
    this.host.applyParams();
    this.host.refreshPanel();

    if (blob && blob.size > 0 && !this.aborted) {
      this.showResult(blob);
    } else {
      if ((failed || !blob) && !this.aborted) showToast(t('video.failed'), true);
      this.dispose();
    }
  }

  private awaitPrecompute(): Promise<void> {
    return new Promise((resolve) => {
      const tick = (): void => {
        if (this.aborted) { resolve(); return; }
        this.setProgress(t('video.preparing', { pct: pctOf(this.host.simDriver.precomputeProgress) }),
          this.host.simDriver.precomputeProgress);
        if (this.host.simDriver.timelineReady) { resolve(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  private async record(): Promise<Blob> {
    this.host.params.timelinePlaying = false;
    this.host.setCapturing(true);
    this.startOffset.copy(this.host.scene.camera.position).sub(this.host.scene.controls.target);

    const canvas = this.host.scene.renderer.domElement;
    // `?nolabel` exports a clean clip (no corner watermark) — used to capture the landing hero loop.
    const clean = new URLSearchParams(window.location.search).has('nolabel');
    const label = clean ? null : buildVideoLabel(this.host.placeName(), canvas.width, canvas.height);
    const recorder = new Recorder(canvas.width, canvas.height, VIDEO_FPS);
    this.outputExt = recorder.fileExt;
    recorder.start();

    // Deterministic capture: render VIDEO_FRAMES at EVEN timeline positions and encode each
    // with an explicit timestamp (i/fps) via WebCodecs — the clip is perfectly even fps and
    // exactly VIDEO_DURATION_SEC, with no wall-clock jitter, however fast the GPU renders. A
    // fixed dt keeps ripples animating steadily; the water STATE comes from the interpolated
    // timeline (sampleAt). No real-time pacing — it encodes as fast as the GPU allows.
    const dt = 1 / VIDEO_FPS;
    for (let i = 0; i < VIDEO_FRAMES; i++) {
      if (this.aborted) break;
      const pos = i / (VIDEO_FRAMES - 1);
      const time = this.host.simDriver.seekTimeline(pos);
      this.updateCaptureVisuals(time);
      this.orbit(pos);
      this.host.renderCaptureFrame(dt);
      if (label) this.host.scene.renderOverlay(label.scene, label.camera); // bake the corner label
      await recorder.addFrame(canvas, i); // explicit-timestamp encode (snapshots the canvas now)
      this.setProgress(t('video.recording', { pct: pctOf(pos) }), pos);
    }

    const blob = await recorder.finish();
    label?.dispose();
    return blob;
  }

  private updateCaptureVisuals(simTimeSec: number): void {
    const mmHr = stormIntensityMmHr(this.host.params.stormType, simTimeSec, this.host.params.intensityMmPerHr);
    this.host.params.raining = mmHr > RAIN_VISUAL_CUTOFF_MMHR;
  }

  private orbit(pos: number): void {
    const cam = this.host.scene.camera;
    const target = this.host.scene.controls.target;
    const offset = this.startOffset.clone().applyAxisAngle(UP, ORBIT_RAD * pos);
    cam.position.copy(target).add(offset);
    cam.lookAt(target);
  }

  private applyCaptureProfile(): void {
    const p = this.host.params;
    p.stormType = 'cloudburst';
    p.storm = true;
    p.raining = true;
    p.rainFootprint = 'uniform';
    // Capture-only storm knobs: `?storm=N` scales the cloudburst N× (heavier rain), `?stormmins=M`
    // compresses it into an M-minute burst (a short, fierce залп instead of a long soak).
    const q = new URLSearchParams(window.location.search);
    const scale = Number(q.get('storm'));
    p.rainMultiplier = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const mins = Number(q.get('stormmins'));
    const naturalMins = stormDurationSec('cloudburst') / 60;
    p.stormSpeed = Number.isFinite(mins) && mins > 0 ? naturalMins / mins : 1;
    // evaporationPerHr is driven per-phase by the precompute (low → high); it's in
    // TOUCHED so the live sim value is restored afterwards.
  }

  private snapshot(): Partial<Params> {
    const s: Partial<Params> = {};
    for (const k of TOUCHED) (s as Record<string, unknown>)[k] = this.host.params[k];
    return s;
  }

  private restore(s: Partial<Params>): void {
    Object.assign(this.host.params, s);
  }

  private setProgress(label: string, frac: number): void {
    this.title.textContent = label;
    this.barFill.style.width = `${Math.round(THREE.MathUtils.clamp(frac, 0, 1) * 100)}%`;
  }

  private showResult(blob: Blob): void {
    const url = URL.createObjectURL(blob);
    this.resultUrl = url;
    this.overlay.classList.add('result');
    this.overlay.innerHTML = '';

    const panel = el('div', 'vm-result');
    const heading = el('div', 'vm-result-title');
    heading.textContent = t('video.title');

    const video = document.createElement('video');
    video.className = 'vm-video';
    video.src = url;
    video.controls = true;
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;

    const actions = el('div', 'vm-actions');
    const download = document.createElement('a');
    download.className = 'vm-btn vm-btn-primary';
    download.textContent = t('video.download');
    download.href = url;
    download.download = `flood-${slug(this.host.placeName())}.${this.outputExt}`;

    const newAddress = button('vm-btn vm-btn-ghost', t('video.newAddress'));
    newAddress.addEventListener('click', () => this.goHome());
    const realtime = button('vm-btn vm-btn-ghost', t('video.realtime'));
    realtime.addEventListener('click', () => {
      this.dispose();
      window.dispatchEvent(new CustomEvent('app:navigate', { detail: 'sim' }));
    });
    const again = button('vm-btn vm-btn-ghost', t('video.again'));
    again.addEventListener('click', () => {
      this.dispose();
      this.host.replay();
    });

    actions.append(download, newAddress, realtime, again);
    panel.append(heading, video, actions);
    this.overlay.appendChild(panel);
  }

  private dispose(): void {
    if (this.resultUrl) { URL.revokeObjectURL(this.resultUrl); this.resultUrl = undefined; }
    this.overlay.remove();
    this.host.onExit();
  }

  /** The way out of the /video flow → back to the landing to pick another place. */
  private goHome(): void {
    this.aborted = true;
    this.dispose();
    window.dispatchEvent(new CustomEvent('app:navigate', { detail: 'landing' }));
  }

  /** Tear down immediately (router left /video, or a new capture is starting). */
  cancel(): void {
    this.aborted = true;
    this.dispose();
  }
}

function pctOf(frac: number): number {
  return Math.round(THREE.MathUtils.clamp(frac, 0, 1) * 100);
}

function slug(name: string): string {
  return (name.split(',')[0] || 'map').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'map';
}
