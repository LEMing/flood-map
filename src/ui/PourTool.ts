import { t } from '../i18n';

interface PourToolCallbacks {
  onToggle(active: boolean): void;
}

/**
 * Floating "pour water" toggle pinned to the bottom-center, clear of the
 * address bar, language picker, and controls panel. Pure view: it flips its own
 * active state, surfaces a dismissible hint while armed, and emits the toggle so
 * the app can own the canvas cursor and the click-to-pour raycast.
 */
export class PourTool {
  private readonly cb: PourToolCallbacks;
  private readonly button: HTMLButtonElement;
  private readonly label: HTMLSpanElement;
  private readonly hint: HTMLDivElement;
  private readonly hintText: HTMLSpanElement;
  private readonly hintClose: HTMLButtonElement;
  private active = false;

  constructor(cb: PourToolCallbacks) {
    this.cb = cb;

    this.button = document.createElement('button');
    this.button.id = 'pour-trigger';
    this.button.type = 'button';
    this.label = document.createElement('span');
    this.label.className = 'pour-label';
    this.button.append(this.dropIcon(), this.label);

    this.hint = document.createElement('div');
    this.hint.id = 'pour-hint';
    this.hint.hidden = true;
    this.hintText = document.createElement('span');
    this.hintText.className = 'pour-hint-text';
    this.hintClose = document.createElement('button');
    this.hintClose.className = 'pour-hint-close';
    this.hintClose.type = 'button';
    this.hintClose.textContent = '×';
    this.hint.append(this.hintText, this.hintClose);

    document.body.append(this.button, this.hint);

    this.button.addEventListener('click', () => this.toggle());
    this.hintClose.addEventListener('click', () => {
      this.hint.hidden = true;
    });

    this.retranslate();
  }

  setActive(active: boolean): void {
    this.active = active;
    this.button.classList.toggle('active', active);
    this.button.setAttribute('aria-pressed', String(active));
    this.hint.hidden = !active;
  }

  retranslate(): void {
    this.label.textContent = t('pour.button');
    this.button.title = t('pour.button');
    this.hintText.textContent = t('pour.hint');
    this.hintClose.setAttribute('aria-label', t('pour.hint'));
  }

  dispose(): void {
    this.button.remove();
    this.hint.remove();
  }

  private toggle(): void {
    this.setActive(!this.active);
    this.cb.onToggle(this.active);
  }

  private dropIcon(): HTMLSpanElement {
    const icon = document.createElement('span');
    icon.className = 'pour-icon';
    icon.textContent = '💧';
    return icon;
  }
}
