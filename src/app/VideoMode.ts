import * as THREE from 'three';
import type { Params } from '../config';
import type { SimDriver } from './SimDriver';
import type { SceneManager } from '../render/SceneManager';
import { stormIntensityMmHr } from '../sim/storm';
import { Recorder } from '../video/Recorder';
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
}

const VIDEO_DURATION_SEC = 30;
const VIDEO_FPS = 30;
const ORBIT_RAD = Math.PI / 9; // ~20° gentle cinematic sweep over the clip
const RAIN_VISUAL_CUTOFF_MMHR = 0.5;
// Keep the world's real drainage so the cloudburst (~25 mm/hr peak) actually
// pools and floods, but bump evaporation so the water fully recedes within the
// capture window — the clip must run all the way to dry (works even where
// drainage is zero, e.g. подтопление zones). 0.8/hr clears the worst basin in
// ~4.4 h after the peak (the precompute self-terminates at dryness).
const CAPTURE_EVAP_PER_HR = 0.8;

// Params the capture profile mutates; snapshotted so the live sim is restored after.
const TOUCHED: Array<keyof Params> = [
  'stormType', 'storm', 'raining', 'running', 'evaporationPerHr',
  'rainFootprint', 'timelinePos', 'timelinePlaying',
];

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Records an accelerated cloudburst over the current world to a downloadable
 * webm: precompute the storm (rain → pools → drains & evaporates), then scrub the
 * timeline across a 30 s clip while a recorder taps the canvas. Shows progress,
 * then an in-page player with download / replay / open-realtime actions.
 */
export class VideoMode {
  private readonly overlay: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly barFill: HTMLDivElement;
  private readonly startOffset = new THREE.Vector3();
  private outputExt = 'mp4';
  private aborted = false;

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

    this.host.simDriver.beginPrecompute({ untilDry: true });
    this.host.applyParams();
    await this.awaitPrecompute();

    let blob: Blob | null = null;
    if (!this.aborted) {
      try {
        blob = await this.record();
      } catch {
        blob = null;
      }
    }

    this.host.setCapturing(false);
    this.restore(snapshot);
    this.host.simDriver.setLive();
    this.host.simDriver.reset();
    this.host.applyParams();
    this.host.refreshPanel();

    if (blob && !this.aborted) this.showResult(blob);
    else this.dispose();
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

    const recorder = new Recorder(this.host.scene.renderer.domElement, VIDEO_FPS);
    this.outputExt = recorder.fileExt;
    recorder.start();

    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      let last = t0;
      const frame = (now: number): void => {
        if (this.aborted) { resolve(); return; }
        const elapsed = (now - t0) / 1000;
        const dt = Math.min(0.05, (now - last) / 1000) || 0;
        last = now;
        const pos = Math.min(1, elapsed / VIDEO_DURATION_SEC);
        const time = this.host.simDriver.seekTimeline(pos);
        this.updateCaptureVisuals(time);
        this.orbit(pos);
        this.host.renderCaptureFrame(dt);
        this.setProgress(t('video.recording', { pct: pctOf(pos) }), pos);
        if (elapsed >= VIDEO_DURATION_SEC) { resolve(); return; }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });

    return recorder.stop();
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
    p.evaporationPerHr = CAPTURE_EVAP_PER_HR;
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
    newAddress.addEventListener('click', () => { URL.revokeObjectURL(url); this.goHome(); });
    const realtime = button('vm-btn vm-btn-ghost', t('video.realtime'));
    realtime.addEventListener('click', () => {
      URL.revokeObjectURL(url);
      this.dispose();
      window.dispatchEvent(new CustomEvent('app:navigate', { detail: 'sim' }));
    });
    const again = button('vm-btn vm-btn-ghost', t('video.again'));
    again.addEventListener('click', () => {
      URL.revokeObjectURL(url);
      this.overlay.remove();
      this.host.onExit();
      const next = new VideoMode(this.host);
      void next.run();
    });

    actions.append(download, newAddress, realtime, again);
    panel.append(heading, video, actions);
    this.overlay.appendChild(panel);
  }

  private dispose(): void {
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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function button(className: string, label: string): HTMLButtonElement {
  const b = el('button', className);
  b.type = 'button';
  b.textContent = label;
  return b;
}

function pctOf(frac: number): number {
  return Math.round(THREE.MathUtils.clamp(frac, 0, 1) * 100);
}

function slug(name: string): string {
  return (name.split(',')[0] || 'map').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'map';
}
