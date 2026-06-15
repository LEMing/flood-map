import { suggest, type Suggestion } from '../geo/autocomplete';
import { formatCoords, parseCoords } from '../url';
import { getLanguage, t } from '../i18n';

export interface AddressBarCallbacks {
  onSubmit(text: string): void;
  onSelect(lat: number, lon: number, label: string): void;
}

export class AddressBar {
  private readonly input: HTMLInputElement;
  private readonly button: HTMLButtonElement;
  private readonly list: HTMLDivElement;
  private readonly cb: AddressBarCallbacks;
  private items: Suggestion[] = [];
  private highlight = -1;
  private debounce?: number;
  private abort?: AbortController;

  constructor(cb: AddressBarCallbacks) {
    this.cb = cb;
    this.input = document.getElementById('address-input') as HTMLInputElement;
    this.button = document.getElementById('address-go') as HTMLButtonElement;
    this.list = document.getElementById('ac-list') as HTMLDivElement;

    this.button.addEventListener('click', () => this.submit());
    this.input.addEventListener('input', () => this.onInput());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('click', (e) => {
      if (e.target !== this.input && !this.list.contains(e.target as Node)) this.close();
    });

    this.retranslate();
  }

  retranslate(): void {
    this.input.placeholder = t('input.placeholder');
    this.input.dir = 'auto'; // RTL for Arabic/Hebrew place names, LTR for coords
    this.button.textContent = this.button.disabled ? t('btn.loading') : t('btn.load');
  }

  setValue(value: string): void {
    this.input.value = value;
    this.close();
  }

  setBusy(busy: boolean): void {
    this.button.disabled = busy;
    this.button.textContent = busy ? t('btn.loading') : t('btn.load');
  }

  private submit(): void {
    if (this.highlight >= 0 && this.items[this.highlight]) this.choose(this.items[this.highlight]);
    else {
      this.close();
      this.cb.onSubmit(this.input.value);
    }
  }

  private choose(s: Suggestion): void {
    this.input.value = s.label;
    this.close();
    this.cb.onSelect(s.lat, s.lon, s.label);
  }

  private onInput(): void {
    const text = this.input.value;
    window.clearTimeout(this.debounce);
    const coords = parseCoords(text);
    if (coords) {
      this.items = [{
        lat: coords.lat, lon: coords.lon,
        label: t('autocomplete.useCoords', { coords: formatCoords(coords.lat, coords.lon) }),
      }];
      this.highlight = 0;
      this.render();
      return;
    }
    if (text.trim().length < 3) {
      this.close();
      return;
    }
    this.debounce = window.setTimeout(async () => {
      this.abort?.abort();
      this.abort = new AbortController();
      this.items = await suggest(text, getLanguage(), this.abort.signal);
      this.highlight = -1;
      this.render();
    }, 250);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' && this.items.length) {
      e.preventDefault();
      this.highlight = (this.highlight + 1) % this.items.length;
      this.updateActive();
    } else if (e.key === 'ArrowUp' && this.items.length) {
      e.preventDefault();
      this.highlight = (this.highlight - 1 + this.items.length) % this.items.length;
      this.updateActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.submit();
    } else if (e.key === 'Escape') {
      this.close();
    }
  }

  private render(): void {
    if (!this.items.length) {
      this.close();
      return;
    }
    this.list.innerHTML = '';
    this.items.forEach((s, i) => {
      const el = document.createElement('div');
      el.className = 'ac-item' + (i === this.highlight ? ' active' : '');
      el.textContent = s.label;
      el.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        this.choose(s);
      });
      el.addEventListener('mouseenter', () => {
        this.highlight = i;
        this.updateActive();
      });
      this.list.appendChild(el);
    });
    this.list.style.display = 'block';
  }

  private updateActive(): void {
    Array.from(this.list.children).forEach((c, i) => c.classList.toggle('active', i === this.highlight));
  }

  private close(): void {
    this.list.style.display = 'none';
    this.items = [];
    this.highlight = -1;
  }
}
