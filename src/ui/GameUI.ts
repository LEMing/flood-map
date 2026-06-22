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
  private readonly timeEl = document.getElementById('dock-time') as HTMLElement;
  private readonly speedEl = document.getElementById('dock-speed') as HTMLElement;
  private started = false;
  private running = false;
  private ready = false;
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

  /** Tick the elapsed-sim-time readout (the app pushes this each stats refresh). */
  setTime(time: string): void {
    this.timeEl.textContent = time;
  }

  private stepSpeed(delta: number): void {
    this.speedIdx = Math.max(0, Math.min(SPEEDS.length - 1, this.speedIdx + delta));
    this.cb.onSpeedSet(SPEEDS[this.speedIdx]);
    this.renderSpeed();
  }

  private renderSpeed(): void {
    this.speedEl.textContent = `${SPEEDS[this.speedIdx]}×`;
    this.slowerBtn.classList.toggle('off', this.speedIdx === 0);
    this.fasterBtn.classList.toggle('off', this.speedIdx === SPEEDS.length - 1);
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
    this.overlay.hidden = true;
    this.dock.hidden = false;
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
    this.setRunning(this.running);
  }
}
