import { getLanguage, LANGUAGES, t, type Lang, type LanguageDef } from '../i18n';

/**
 * Compact, unobtrusive language switcher pinned to the top-right (left of the
 * controls panel). A globe + current code; clicking opens a searchable popup so
 * 30+ languages stay browsable. Pure view: it emits a selection and lets the app
 * own persistence / URL / panel rebuild.
 */
export class LanguagePicker {
  private readonly root: HTMLDivElement;
  private readonly trigger: HTMLButtonElement;
  private readonly pop: HTMLDivElement;
  private readonly search: HTMLInputElement;
  private readonly list: HTMLDivElement;
  private readonly onChange: (lang: Lang) => void;
  private filtered: LanguageDef[] = LANGUAGES;
  private highlight = 0;
  private open = false;

  constructor(onChange: (lang: Lang) => void) {
    this.onChange = onChange;

    this.root = document.createElement('div');
    this.root.id = 'lang-picker';

    this.trigger = document.createElement('button');
    this.trigger.id = 'lang-trigger';
    this.trigger.type = 'button';

    this.pop = document.createElement('div');
    this.pop.id = 'lang-pop';
    this.pop.hidden = true;

    this.search = document.createElement('input');
    this.search.id = 'lang-search';
    this.search.type = 'text';
    this.search.autocomplete = 'off';
    this.search.spellcheck = false;

    this.list = document.createElement('div');
    this.list.id = 'lang-list';

    this.pop.append(this.search, this.list);
    this.root.append(this.trigger, this.pop);
    document.body.appendChild(this.root);

    this.trigger.addEventListener('click', () => this.toggle());
    this.search.addEventListener('input', () => this.applyFilter());
    this.search.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('click', (e) => {
      if (!this.root.contains(e.target as Node)) this.close();
    });

    this.retranslate();
  }

  retranslate(): void {
    const def = LANGUAGES.find((l) => l.code === getLanguage());
    this.trigger.innerHTML =
      `<span class="globe">🌐</span><span class="code">${(def?.code ?? 'en').toUpperCase()}</span>`;
    this.trigger.title = def ? `${def.label} · ${def.english}` : 'Language';
    this.search.placeholder = `${t('viz.language')}…`;
  }

  private toggle(): void {
    if (this.open) this.close();
    else this.openPop();
  }

  private openPop(): void {
    this.open = true;
    this.pop.hidden = false;
    document.body.classList.add('lang-open'); // hides the pre-launch Play CTA underneath
    this.search.value = '';
    this.applyFilter();
    this.search.focus();
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.pop.hidden = true;
    document.body.classList.remove('lang-open');
  }

  private applyFilter(): void {
    const q = this.search.value.trim().toLowerCase();
    this.filtered = q
      ? LANGUAGES.filter(
          (l) =>
            l.label.toLowerCase().includes(q) ||
            l.english.toLowerCase().includes(q) ||
            l.code.includes(q),
        )
      : LANGUAGES;
    const cur = this.filtered.findIndex((l) => l.code === getLanguage());
    this.highlight = cur >= 0 ? cur : 0;
    this.render();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' && this.filtered.length) {
      e.preventDefault();
      this.highlight = (this.highlight + 1) % this.filtered.length;
      this.updateActive();
    } else if (e.key === 'ArrowUp' && this.filtered.length) {
      e.preventDefault();
      this.highlight = (this.highlight - 1 + this.filtered.length) % this.filtered.length;
      this.updateActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = this.filtered[this.highlight];
      if (pick) this.choose(pick.code);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  }

  private render(): void {
    const cur = getLanguage();
    this.list.innerHTML = '';
    this.filtered.forEach((l, i) => {
      const el = document.createElement('div');
      el.className =
        'lang-item' + (i === this.highlight ? ' active' : '') + (l.code === cur ? ' current' : '');
      el.dir = l.rtl ? 'rtl' : 'ltr';
      el.innerHTML = `<span class="name">${l.label}</span><span class="lc">${l.code}</span>`;
      el.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        this.choose(l.code);
      });
      el.addEventListener('mouseenter', () => {
        this.highlight = i;
        this.updateActive();
      });
      this.list.appendChild(el);
    });
    this.updateActive();
  }

  private updateActive(): void {
    const children = Array.from(this.list.children);
    children.forEach((c, i) => c.classList.toggle('active', i === this.highlight));
    children[this.highlight]?.scrollIntoView({ block: 'nearest' });
  }

  private choose(code: Lang): void {
    this.close();
    if (code !== getLanguage()) this.onChange(code);
    else this.retranslate();
  }
}
