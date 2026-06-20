import { t } from '../i18n';

// In-app "how the flood model works & its limits" disclosure — the honest caveat
// for the headline flood feature, mirroring the geology "model, not a borehole"
// note. A small ⓘ button toggles a panel; hidden on the landing/video routes via
// body classes (see index.html). Plain text only (no innerHTML / user data).
export class MethodNote {
  private readonly btn = document.createElement('button');
  private readonly panel = document.createElement('div');
  private readonly closeBtn = document.createElement('button');
  private readonly titleEl = document.createElement('div');
  private readonly bodyEl = document.createElement('div');
  private open = false;

  constructor() {
    this.btn.id = 'method-btn';
    this.btn.type = 'button';
    this.btn.textContent = 'ⓘ';
    this.panel.id = 'method-note';
    this.panel.hidden = true;
    this.closeBtn.className = 'mn-close';
    this.closeBtn.type = 'button';
    this.closeBtn.textContent = '✕';
    this.closeBtn.setAttribute('aria-label', 'Close');
    this.titleEl.className = 'mn-title';
    this.bodyEl.className = 'mn-body';
    this.panel.append(this.closeBtn, this.titleEl, this.bodyEl);
    document.body.append(this.btn, this.panel);
    this.translate();

    this.btn.addEventListener('click', () => this.setOpen(!this.open));
    this.closeBtn.addEventListener('click', () => this.setOpen(false));
    document.addEventListener('pointerdown', (e) => {
      if (!this.open) return;
      const target = e.target as Node;
      if (this.btn.contains(target) || this.panel.contains(target)) return;
      this.setOpen(false);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.open) this.setOpen(false); });
  }

  translate(): void {
    this.btn.title = t('method.title');
    this.btn.setAttribute('aria-label', t('method.title'));
    this.titleEl.textContent = t('method.title');
    this.bodyEl.textContent = t('method.body');
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.panel.hidden = !open;
    this.btn.setAttribute('aria-expanded', String(open));
  }
}
