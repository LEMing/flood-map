import { t } from '../i18n';
import type { GeoStage } from '../geo/geoWorkerTypes';

// A loading card shown while a world is built: the place being loaded, the bytes
// downloaded so far, and an icon stepper of the stages (current one spinning,
// done ones lit, upcoming dim). It is deliberately TEXT-FREE except the header
// (reuses the translated `toast.loadingPlace`) and a universal MB/KB unit, so it
// reads identically in all 60 locales without adding translatable strings.
type Stage = 'location' | GeoStage | 'imagery';

const STAGES: ReadonlyArray<{ key: Stage; icon: string }> = [
  { key: 'location', icon: '📍' },
  { key: 'elevation', icon: '⛰️' },
  { key: 'features', icon: '🏙️' },
  { key: 'imagery', icon: '🛰️' },
];

export class LoadingPanel {
  private readonly root = document.createElement('div');
  private readonly title = document.createElement('span');
  private readonly size = document.createElement('span');
  private readonly steps = new Map<Stage, HTMLDivElement>();
  private bytes = 0;
  private hideTimer?: number;

  constructor() {
    this.root.id = 'loading-card';
    this.root.hidden = true;
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');

    const head = document.createElement('div');
    head.className = 'lc-head';
    const spin = document.createElement('span');
    spin.className = 'lc-spin';
    this.title.className = 'lc-title';
    this.size.className = 'lc-size';
    head.append(spin, this.title, this.size);

    const strip = document.createElement('div');
    strip.className = 'lc-steps';
    for (const { key, icon } of STAGES) {
      const step = document.createElement('div');
      step.className = 'lc-step';
      const ic = document.createElement('span');
      ic.className = 'lc-ic';
      ic.textContent = icon;
      const bar = document.createElement('span');
      bar.className = 'lc-bar';
      step.append(ic, bar);
      strip.append(step);
      this.steps.set(key, step);
    }

    this.root.append(head, strip);
    document.body.append(this.root);
  }

  /** Begin loading `place`. Coords are already resolved, so location starts done. */
  start(place: string): void {
    window.clearTimeout(this.hideTimer);
    this.bytes = 0;
    this.size.textContent = '';
    this.title.textContent = t('toast.loadingPlace', { q: place });
    this.setStage('elevation');
    this.root.hidden = false;
    void this.root.offsetWidth; // reflow so the fade-in runs from hidden
    this.root.classList.add('show');
  }

  /** Light every stage up to (not including) `stage` as done, `stage` as active. */
  setStage(stage: Stage): void {
    let reached = false;
    for (const { key } of STAGES) {
      const step = this.steps.get(key);
      if (!step) continue;
      if (key === stage) { step.className = 'lc-step active'; reached = true; }
      else step.className = reached ? 'lc-step' : 'lc-step done';
    }
  }

  addBytes(delta: number): void {
    this.bytes += delta;
    this.size.textContent = formatSize(this.bytes);
  }

  /** World is built: mark everything done and fade the card out. */
  done(): void {
    if (this.root.hidden) return;
    for (const step of this.steps.values()) step.className = 'lc-step done';
    this.root.classList.remove('show');
    this.hideTimer = window.setTimeout(() => { this.root.hidden = true; }, 320);
  }

  /** Load failed: drop the card (an error toast takes over). */
  fail(): void {
    this.root.classList.remove('show');
    this.hideTimer = window.setTimeout(() => { this.root.hidden = true; }, 200);
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
