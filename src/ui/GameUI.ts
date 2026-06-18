import { t } from '../i18n';

export interface GameUICallbacks {
  onStart(): void; // first launch: begin rain + run the sim
  onTogglePause(): void; // pause / resume the running sim
  onRestart(): void; // reset the flood back to dry ground
}

/**
 * The clean game shell: a single centred launch button, then a floating
 * pause/restart dock and a compact flood readout. Pure view — it owns the
 * DOM visibility and button glyphs and emits intent; the app owns the params.
 */
export class GameUI {
  private readonly overlay = document.getElementById('start-overlay') as HTMLElement;
  private readonly startBtn = document.getElementById('start-btn') as HTMLButtonElement;
  private readonly startLabel = this.startBtn.querySelector('.start-label') as HTMLElement;
  private readonly sub = this.overlay.querySelector('.sub') as HTMLElement;
  private readonly dock = document.getElementById('game-dock') as HTMLElement;
  private readonly pauseBtn = document.getElementById('btn-pause') as HTMLButtonElement;
  private readonly restartBtn = document.getElementById('btn-restart') as HTMLButtonElement;
  private readonly hud = document.getElementById('hud-stats') as HTMLElement;
  private readonly hudDepth = document.getElementById('hud-depth') as HTMLElement;
  private readonly hudArea = document.getElementById('hud-area') as HTMLElement;
  private started = false;
  private running = false;

  constructor(private readonly cb: GameUICallbacks) {
    this.startBtn.addEventListener('click', () => this.launch());
    this.pauseBtn.addEventListener('click', () => this.cb.onTogglePause());
    this.restartBtn.addEventListener('click', () => this.cb.onRestart());
    this.retranslate();
  }

  private launch(): void {
    if (this.started) return;
    this.started = true;
    document.body.classList.add('game-started');
    this.overlay.hidden = true;
    this.dock.hidden = false;
    this.hud.hidden = false;
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

  setStats(peakDepthM: number, floodedPercent: number): void {
    if (this.hud.hidden) return;
    this.hudDepth.textContent = `${peakDepthM.toFixed(2)} m`;
    this.hudArea.textContent = `${floodedPercent.toFixed(0)}%`;
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
