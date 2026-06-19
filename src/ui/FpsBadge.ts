// Always-visible FPS badge (the panel's own fps stat is collapsible/buried).
// Throttled to ~5 Hz; update() returns true on the ticks it actually repainted
// so the caller can piggy-back its own throttled readouts on the same cadence.
const THROTTLE_MS = 200;

export class FpsBadge {
  private el: HTMLDivElement | null = null;
  private lastShown = 0;

  update(now: number, fps: number): boolean {
    if (now - this.lastShown < THROTTLE_MS) return false;
    this.lastShown = now;
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.id = 'fps-meter';
      document.body.appendChild(this.el);
    }
    const f = Math.round(fps);
    this.el.textContent = `${f} fps`;
    this.el.style.color = f >= 50 ? '#86e08a' : f >= 30 ? '#e0cf86' : '#e08a86';
    return true;
  }
}
