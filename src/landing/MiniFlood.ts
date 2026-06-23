import { type LabScene } from './labShared';
import { CrossScene } from './CrossScene';
import { CityScene } from './CityScene';

// Controller for the landing's interactive physics lab: owns the canvas, the controls
// and the rAF loop, and delegates step()/draw() to whichever scene is active — the 1D
// cross-section (η = z + h principle) or the 2D top-down city (water in the streets).
// Everything is CPU + Canvas 2D, runs only while on screen, and respects reduced-motion.
const BASE_RATE = 110; // sim-seconds per real second at 1×
const SPEED_MULT = [1, 4, 16]; // the Faster button steps logarithmically

export class MiniFlood {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly depthEl: HTMLElement | null;
  private readonly pondedEl: HTMLElement | null;
  private readonly speedEl: HTMLElement | null;
  private readonly rainBtn: HTMLButtonElement | null;
  private readonly viewBtns: HTMLButtonElement[];
  private readonly cross = new CrossScene();
  private readonly city = new CityScene();
  private active: LabScene;
  private raining: boolean;
  private auto: boolean;
  private speedIdx = 0;
  private phase = 0;
  private running = false;
  private onScreen = false;
  private raf = 0;
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly io: IntersectionObserver;

  constructor(root: HTMLElement) {
    this.canvas = root.querySelector('.lp-lab-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.rainBtn = root.querySelector('[data-lab-act="rain"]');
    this.depthEl = root.querySelector('[data-lab="depth"]');
    this.pondedEl = root.querySelector('[data-lab="ponded"]');
    this.speedEl = root.querySelector('[data-lab="speed"]');
    this.viewBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-lab-view]'));
    this.active = this.cross;
    this.auto = !this.reduced;
    this.raining = !this.reduced;
    this.setRain(this.raining);
    this.renderSpeed();
    this.rainBtn?.addEventListener('click', () => this.toggleRain());
    root.querySelector('[data-lab-act="faster"]')?.addEventListener('click', () => this.cycleSpeed());
    root.querySelector('[data-lab-act="reset"]')?.addEventListener('click', () => this.reset());
    this.viewBtns.forEach((b) => b.addEventListener('click', () => this.setView(b.dataset.labView ?? 'cross')));
    addEventListener('resize', () => this.resize());
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
  }

  refresh(): void {
    this.rainBtn?.classList.toggle('on', this.raining);
  }

  private setView(view: string): void {
    this.active = view === 'top' ? this.city : this.cross;
    this.viewBtns.forEach((b) => b.classList.toggle('on', b.dataset.labView === view));
    this.active.reset();
    this.auto = !this.reduced;
    this.setRain(!this.reduced);
    this.draw();
    this.emitStats();
  }

  private setRain(on: boolean): void {
    this.raining = on;
    this.rainBtn?.classList.toggle('on', on);
  }

  private toggleRain(): void {
    this.auto = false;
    this.setRain(!this.raining);
    this.sync();
  }

  private cycleSpeed(): void {
    this.speedIdx = (this.speedIdx + 1) % SPEED_MULT.length;
    this.renderSpeed();
  }

  private renderSpeed(): void {
    if (this.speedEl) this.speedEl.textContent = `${SPEED_MULT[this.speedIdx]}×`;
  }

  private reset(): void {
    this.active.reset();
    this.auto = !this.reduced;
    this.setRain(!this.reduced);
    this.draw();
    this.emitStats();
  }

  private sync(): void {
    const shouldRun = this.onScreen && !document.hidden;
    if (shouldRun && !this.running) {
      this.running = true;
      this.raf = requestAnimationFrame(this.frame);
    } else if (!shouldRun && this.running) {
      this.running = false;
      cancelAnimationFrame(this.raf);
    }
  }

  private readonly frame = (): void => {
    if (!this.running) return;
    this.active.step((1 / 60) * BASE_RATE * SPEED_MULT[this.speedIdx], this.raining);
    if (this.auto) {
      if (this.raining && this.active.peaked()) this.setRain(false);
      else if (!this.raining && this.active.drained()) this.setRain(true);
    }
    this.phase = (this.phase + 0.06) % 1;
    this.draw();
    this.emitStats();
    this.raf = requestAnimationFrame(this.frame);
  };

  private emitStats(): void {
    if (this.depthEl) this.depthEl.textContent = this.active.maxDepth.toFixed(1);
    if (this.pondedEl) this.pondedEl.textContent = String(Math.round(this.active.pondedFrac * 100));
  }

  private resize(): void {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = this.canvas.clientWidth || 600;
    const hpx = this.canvas.clientHeight || 240;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(hpx * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  private draw(): void {
    const w = this.canvas.clientWidth || 600;
    const h = this.canvas.clientHeight || 240;
    this.active.draw(this.ctx, { w, h, phase: this.phase, raining: this.raining });
  }
}
