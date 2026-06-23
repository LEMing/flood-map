import { type DrawCtx } from './labShared';
import { LabWorld } from './LabWorld';
import { TopView } from './TopView';
import { SectionView } from './SectionView';

// Controller for the landing's interactive physics lab. Owns ONE shared LabWorld and two
// pure renderers (top-down map, side cross-section), the controls, and the rAF loop.
// The fill→drain "breathing" is a wall-clock 4-phase FSM (NOT tied to physics speed), so
// it is slow and dwells on the flooded state instead of jittering. CPU + Canvas 2D only,
// runs on screen, reduced-motion aware.
const BASE_RATE = 28; // sim-seconds per real second at 1× — gentle, watchable
const SPEED_MULT = [1, 4, 16]; // the Faster button steps the WATER physics, not the breathing period
const RAIN_MS = 0.0015;
const DRAIN_WET = 0.0004; // low loss while raining
const DRAIN_DRY = 0.0016; // tail loss during recession
const TARGET_DEPTH = 1.2; // m — once the basin reaches this, the rain stops and the sim FREEZES, so the
//                          flood holds steady (deep + visible) and never overflows — at any speed

// state, seconds, rain (m/s), drain (m/s), freeze. `freeze` pauses the whole sim so the
// flooded streets hold steady — without it the water just redistributes downhill and the
// flood "fades" even with no source/sink.
const PHASES = [
  { dur: 6, rain: RAIN_MS, drain: DRAIN_WET, freeze: false }, // RAIN_FILL — streets + plaza fill
  { dur: 8, rain: 0, drain: 0, freeze: true }, // DWELL_FLOOD — hold the flood (the key fix)
  { dur: 5, rain: 0, drain: DRAIN_DRY, freeze: false }, // DRAIN — recede
  { dur: 2, rain: 0, drain: DRAIN_DRY, freeze: false }, // DWELL_DRY — brief dry beat
];

export class MiniFlood {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly depthEl: HTMLElement | null;
  private readonly pondedEl: HTMLElement | null;
  private readonly speedEl: HTMLElement | null;
  private readonly rainBtn: HTMLButtonElement | null;
  private readonly viewBtns: HTMLButtonElement[];
  private readonly world = new LabWorld();
  private readonly topView = new TopView(this.world);
  private readonly section = new SectionView(this.world);
  private view: 'top' | 'cross' = 'cross';
  private auto: boolean;
  private manualRain = false;
  private phase = 0;
  private phaseT = 0;
  private anim = 0;
  private speedIdx = 0;
  private curRaining = false;
  private running = false;
  private onScreen = false;
  private lastT = 0;
  private raf = 0;
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly io: IntersectionObserver;
  private readonly ro: ResizeObserver;

  constructor(root: HTMLElement) {
    this.canvas = root.querySelector('.lp-lab-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.rainBtn = root.querySelector('[data-lab-act="rain"]');
    this.depthEl = root.querySelector('[data-lab="depth"]');
    this.pondedEl = root.querySelector('[data-lab="ponded"]');
    this.speedEl = root.querySelector('[data-lab="speed"]');
    this.viewBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-lab-view]'));
    this.auto = !this.reduced;
    this.renderSpeed();
    this.rainBtn?.addEventListener('click', () => this.toggleRain());
    root.querySelector('[data-lab-act="faster"]')?.addEventListener('click', () => this.cycleSpeed());
    root.querySelector('[data-lab-act="reset"]')?.addEventListener('click', () => this.reset());
    this.viewBtns.forEach((b) => b.addEventListener('click', () => this.setView(b.dataset.labView === 'top' ? 'top' : 'cross')));
    addEventListener('resize', () => this.resize());
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvas);
    document.addEventListener('visibilitychange', () => this.sync());
    this.io = new IntersectionObserver(
      (e) => { this.onScreen = e[0].isIntersecting; this.sync(); },
      { threshold: 0.15 },
    );
    this.io.observe(this.canvas);
    this.resize();
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.io.disconnect();
    this.ro.disconnect();
  }

  refresh(): void { this.rainBtn?.classList.toggle('on', this.curRaining); }

  private setView(view: 'top' | 'cross'): void {
    this.view = view; // do NOT reset the world — the water persists, reinforcing "same place"
    this.viewBtns.forEach((b) => b.classList.toggle('on', b.dataset.labView === view));
    this.paint();
  }

  private toggleRain(): void {
    this.auto = false;
    this.manualRain = !this.manualRain;
  }

  private cycleSpeed(): void {
    this.speedIdx = (this.speedIdx + 1) % SPEED_MULT.length;
    this.renderSpeed();
  }

  private renderSpeed(): void {
    if (this.speedEl) this.speedEl.textContent = `${SPEED_MULT[this.speedIdx]}×`;
  }

  private reset(): void {
    this.world.reset();
    this.auto = !this.reduced;
    this.manualRain = false;
    this.phase = 0;
    this.phaseT = 0;
    this.paint();
    this.emitStats();
  }

  private sync(): void {
    const shouldRun = this.onScreen && !document.hidden;
    if (shouldRun && !this.running) {
      this.running = true;
      this.lastT = 0;
      this.raf = requestAnimationFrame(this.frame);
    } else if (!shouldRun && this.running) {
      this.running = false;
      cancelAnimationFrame(this.raf);
    }
  }

  /** This frame's rain/drain/freeze from the wall-clock FSM (auto) or the manual toggle.
   *  Rain is never endless: the river channel drains flood water off-map, so even held
   *  rain settles at a steady level (see LabWorld CHANNEL_DRAIN) instead of overflowing. */
  private tick(dtReal: number): { rain: number; drain: number; freeze: boolean } {
    let cfg: { rain: number; drain: number; freeze: boolean };
    if (!this.auto) {
      cfg = { rain: this.manualRain ? RAIN_MS : 0, drain: this.manualRain ? DRAIN_WET : DRAIN_DRY, freeze: false };
    } else {
      this.phaseT += dtReal;
      if (this.phaseT >= PHASES[this.phase].dur) { this.phase = (this.phase + 1) % PHASES.length; this.phaseT = 0; }
      cfg = PHASES[this.phase];
    }
    // Once the basin is full, freeze instead of raining on — holds a deep flood, never overflows.
    if (cfg.rain > 0 && this.world.maxDepth >= TARGET_DEPTH) return { rain: 0, drain: 0, freeze: true };
    return cfg;
  }

  private readonly frame = (t: number): void => {
    if (!this.running) return;
    const dtReal = this.lastT ? Math.min(0.1, (t - this.lastT) / 1000) : 1 / 60;
    this.lastT = t;
    const cfg = this.tick(dtReal);
    this.curRaining = cfg.rain > 0;
    this.rainBtn?.classList.toggle('on', this.auto ? this.curRaining : this.manualRain);
    if (!cfg.freeze) this.world.step((1 / 60) * BASE_RATE * SPEED_MULT[this.speedIdx], cfg.rain, cfg.drain);
    this.anim = (this.anim + 0.06) % 1;
    this.paint();
    this.emitStats();
    this.raf = requestAnimationFrame(this.frame);
  };

  private emitStats(): void {
    if (this.depthEl) this.depthEl.textContent = this.world.maxDepth.toFixed(1);
    if (this.pondedEl) this.pondedEl.textContent = String(Math.round(this.world.pondedFrac * 100));
  }

  private resize(): void {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = this.canvas.clientWidth || 600;
    const hpx = this.canvas.clientHeight || 240;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(hpx * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.paint();
  }

  private paint(): void {
    const view: DrawCtx = {
      w: this.canvas.clientWidth || 600,
      h: this.canvas.clientHeight || 240,
      phase: this.anim,
      raining: this.curRaining,
    };
    if (this.view === 'top') this.topView.draw(this.ctx, view);
    else this.section.draw(this.ctx, view);
  }
}
