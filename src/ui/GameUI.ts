import { t } from '../i18n';

export interface GameUICallbacks {
  onStart(): void; // first launch: begin rain + run the sim
  onTogglePause(): void; // pause / resume the running sim
  onRestart(): void; // reset the flood back to dry ground
  onSpeedSet(timeScale: number): void; // apply a new time scale (simulated seconds per real second)
}

// Time-scale presets the slower/faster buttons step through (sim seconds per real second).
const SPEEDS = [1, 10, 30, 60, 180, 600, 1800, 3000];

/**
 * The clean game shell: a single centred launch button, then a floating
 * pause/restart dock. Pure view — it owns the DOM visibility and button glyphs
 * and emits intent; the app owns the params.
 */
export class GameUI {
  private readonly overlay = document.getElementById('start-overlay') as HTMLElement;
  private readonly startBtn = document.getElementById('start-btn') as HTMLButtonElement;
  private readonly startLabel = this.startBtn.querySelector('.start-label') as HTMLElement;
  private readonly sub = this.overlay.querySelector('.sub') as HTMLElement;
  private readonly dock = document.getElementById('game-dock') as HTMLElement;
  private readonly pauseBtn = document.getElementById('btn-pause') as HTMLButtonElement;
  private readonly restartBtn = document.getElementById('btn-restart') as HTMLButtonElement;
  private readonly slowerBtn = document.getElementById('btn-slower') as HTMLButtonElement;
  private readonly fasterBtn = document.getElementById('btn-faster') as HTMLButtonElement;
  private readonly phaseEl = document.getElementById('dock-phase') as HTMLElement;
  private readonly timeEl = document.getElementById('dock-time') as HTMLElement;
  private readonly speedEl = document.getElementById('dock-speed') as HTMLElement;
  private readonly statusEl = document.getElementById('dock-status') as HTMLElement;
  private started = false;
  private running = false;
  private ready = false;
  private raining = false;
  private lastAnnounce = '';
  private speedIdx = SPEEDS.indexOf(180); // default time scale (matches DEFAULT_PARAMS.timeScale)

  constructor(private readonly cb: GameUICallbacks) {
    this.startBtn.disabled = true; // no world yet — enabled by setReady() once it builds
    this.startBtn.addEventListener('click', () => this.launch());
    this.pauseBtn.addEventListener('click', () => this.cb.onTogglePause());
    this.restartBtn.addEventListener('click', () => this.cb.onRestart());
    this.slowerBtn.addEventListener('click', () => this.stepSpeed(-1));
    this.fasterBtn.addEventListener('click', () => this.stepSpeed(1));
    this.renderSpeed();
    this.retranslate();
  }

  /** Tick the elapsed-sim-time readout + storm-phase glyph (🌧 while the rain
   *  is still falling, 💧 once it has stopped and the water is draining away). */
  setTime(time: string, raining: boolean): void {
    this.timeEl.textContent = time;
    this.raining = raining;
    this.phaseEl.textContent = raining ? '🌧' : '💧';
    this.phaseEl.classList.toggle('raining', raining);
    this.announce();
  }

  /** Announce phase + speed to assistive tech via the visually-hidden live region — only
   *  when one of them actually changes, so it doesn't fire on every elapsed-time tick. */
  private announce(): void {
    const msg = `${t(this.raining ? 'sim.raining' : 'sim.draining')} · ${SPEEDS[this.speedIdx]}×`;
    if (msg === this.lastAnnounce) return;
    this.lastAnnounce = msg;
    this.statusEl.textContent = msg;
  }

  private stepSpeed(delta: number): void {
    this.speedIdx = Math.max(0, Math.min(SPEEDS.length - 1, this.speedIdx + delta));
    this.cb.onSpeedSet(SPEEDS[this.speedIdx]);
    this.renderSpeed();
    this.announce();
  }

  private renderSpeed(): void {
    this.speedEl.textContent = `${SPEEDS[this.speedIdx]}×`;
    const atFloor = this.speedIdx === 0;
    const atCeil = this.speedIdx === SPEEDS.length - 1;
    this.slowerBtn.classList.toggle('off', atFloor);
    this.fasterBtn.classList.toggle('off', atCeil);
    this.slowerBtn.setAttribute('aria-disabled', String(atFloor));
    this.fasterBtn.setAttribute('aria-disabled', String(atCeil));
    this.slowerBtn.setAttribute('aria-label', t('sim.slower'));
    this.fasterBtn.setAttribute('aria-label', t('sim.faster'));
  }

  /** Enable the launch button once the world has actually built — pressing Play
   *  before then would start the sim against a non-existent world (dead button,
   *  empty sky, 0.00 m / 0%). */
  setReady(ready: boolean): void {
    this.ready = ready;
    this.startBtn.disabled = !ready || this.started;
  }

  private launch(): void {
    if (this.started || !this.ready) return;
    this.started = true;
    document.body.classList.add('game-started');
    this.overlay.classList.add('leaving'); // fade the launch button out…
    this.dock.hidden = false;
    this.dock.classList.add('dock-enter'); // …as the dock rises in (reduced-motion: instant)
    window.setTimeout(() => { this.overlay.hidden = true; }, 220);
    this.cb.onStart();
  }

  /** Reflect the live running flag on the pause/resume button glyph + label. */
  setRunning(running: boolean): void {
    this.running = running;
    this.pauseBtn.textContent = running ? '⏸' : '▶';
    const label = running ? t('sim.pause') : t('sim.play');
    this.pauseBtn.title = label;
    this.pauseBtn.setAttribute('aria-label', label);
  }

  /** Place name under the launch button (a proper noun — language-independent). */
  setSubtitle(text: string): void {
    this.sub.textContent = text;
    this.sub.dir = 'auto'; // RTL place names stay correctly ordered
  }

  retranslate(): void {
    this.startLabel.dir = 'auto'; // keep the ▶ glyph on the leading side in RTL
    this.startLabel.textContent = t('sim.play');
    this.restartBtn.title = t('sim.reset');
    this.restartBtn.setAttribute('aria-label', t('sim.reset'));
    this.lastAnnounce = ''; // re-announce phase/speed in the new language
    this.renderSpeed(); // re-localize slower/faster aria-labels
    this.setRunning(this.running);
  }
}
