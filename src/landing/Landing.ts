import { geocode, shortLabel, type GeocodeResult } from '../geo/geocode';
import { suggest, type Suggestion } from '../geo/autocomplete';
import { landingBackdrop } from '../geo/landingSatellite';
import { detectIpLocation } from '../geo/ipLocation';
import { prefetchWorld, type WorldRequest } from '../geo/worldDataCache';
import { videoCaptureSupported } from '../video/Recorder';
import { detectWebGLSupport } from '../render/webglSupport';
import { DEFAULT_PARAMS } from '../config';
import { formatCoords, parseCoords, readUrlState } from '../url';
import { getLanguage, t } from '../i18n';
import { el, button } from '../ui/dom';
import { renderPreparing, renderFacts, renderFactError } from './landingFacts';

export interface EnterOptions { cinematic?: boolean; km?: number; grid?: number }

export interface LandingCallbacks {
  /** Leave the landing and enter the sim/video for `location` with the chosen scale. */
  onEnter(location: GeocodeResult, opts: EnterOptions): void;
}

// Map scale + grid density offered on the landing card.
const SIZE_OPTIONS = [1, 2.5, 5, 10, 20]; // km on a side
const GRID_OPTIONS = [256, 512, 1024, 2048]; // sim grid N×N (2048 = sharpest)

interface OptionSpec {
  icon: string;
  label: string;
  values: number[];
  current: () => number;
  set: (v: number) => void;
  unit: string;
}

/** Whether the browser can record video (WebCodecs frame-accurate mp4). */
export function videoExportSupported(): boolean {
  return videoCaptureSupported();
}

/**
 * The "/" entry surface: an immersive satellite backdrop with a glass card that
 * geocodes an address, prefetches its world in the background, shows a few facts,
 * and hands off to the sim (realtime or cinematic video) via `onEnter`. The card
 * is fully rebuilt by render() so a language change just re-renders it.
 */
export class Landing {
  private readonly cb: LandingCallbacks;
  private readonly root: HTMLElement;
  private bg!: HTMLDivElement;
  private input!: HTMLInputElement;
  private acList!: HTMLDivElement;
  private facts!: HTMLDivElement;
  private btnRealtime!: HTMLButtonElement;
  private btnVideo!: HTMLButtonElement;
  private readonly webglOk = detectWebGLSupport().ok;

  private selected?: GeocodeResult;
  private items: Suggestion[] = [];
  private highlight = -1;
  private debounce?: number;
  private abort?: AbortController;
  private bgToken = 0;
  private selectToken = 0;
  private touchedInput = false;
  private km: number;
  private grid: number;

  constructor(cb: LandingCallbacks) {
    this.cb = cb;
    const url = readUrlState();
    this.km = url.km && SIZE_OPTIONS.includes(url.km) ? url.km : DEFAULT_PARAMS.mapSizeKm;
    this.grid = url.grid && GRID_OPTIONS.includes(url.grid) ? url.grid : DEFAULT_PARAMS.gridResolution;
    this.root = document.getElementById('landing') as HTMLElement;

    // Close the autocomplete on any outside click (added once; reads live refs).
    document.addEventListener('click', (e) => {
      if (e.target !== this.input && !this.acList?.contains(e.target as Node)) this.closeAc();
    });

    this.render();
    void this.bootstrapFromIp();
  }

  /** Re-entry (e.g. browser Back): the DOM persists, just make sure it's visible. */
  show(): void {
    this.input.focus({ preventScroll: true });
  }

  /** Rebuild the card in the current language; keeps the chosen place + scale. */
  retranslate(): void {
    this.render();
    if (this.selected) this.select(this.selected);
  }

  /** Build (or rebuild) the entire card DOM and wire its events. */
  private render(): void {
    this.root.innerHTML = '';
    this.bg = el('div', 'lp-bg');
    const scrim = el('div', 'lp-scrim');
    const card = el('div', 'lp-card');

    const brand = el('div', 'lp-brand');
    const headline = el('h1', 'lp-headline');
    headline.textContent = t('landing.headline');
    const tagline = el('p', 'lp-tagline');
    tagline.textContent = t('landing.tagline');
    brand.append(headline, tagline);

    const search = el('div', 'lp-search');
    this.input = document.createElement('input');
    this.input.className = 'lp-input';
    this.input.type = 'text';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.placeholder = t('input.placeholder');
    this.input.dir = 'auto';
    this.acList = el('div', 'lp-ac');
    search.append(this.input, this.acList);

    this.facts = el('div', 'lp-facts');

    const cta = el('div', 'lp-cta');
    this.btnRealtime = button('lp-btn lp-btn-primary', t('landing.cta.realtime'));
    this.btnVideo = button('lp-btn lp-btn-ghost', t('landing.cta.video'));
    this.btnRealtime.disabled = !this.selected || !this.webglOk;
    this.btnVideo.disabled = !this.selected || !this.webglOk;
    if (!videoExportSupported()) {
      this.btnVideo.hidden = true;
      cta.classList.add('single');
    }
    cta.append(this.btnRealtime, this.btnVideo);

    card.append(brand, search, this.buildOptions(), this.facts, cta);
    if (!this.webglOk) {
      this.btnRealtime.title = t('toast.webglUnsupported');
      this.btnVideo.title = t('toast.webglUnsupported');
      const note = el('div', 'lp-opt-hint');
      note.textContent = t('toast.webglUnsupported');
      note.dir = 'auto';
      card.appendChild(note);
    }
    this.root.append(this.bg, scrim, card);

    this.wireCard();
    if (this.selected) this.input.value = shortLabel(this.selected);
  }

  private wireCard(): void {
    this.btnRealtime.addEventListener('click', () => {
      if (this.selected) this.cb.onEnter(this.selected, { km: this.km, grid: this.grid });
    });
    this.btnVideo.addEventListener('click', () => {
      if (this.selected) this.cb.onEnter(this.selected, { cinematic: true, km: this.km, grid: this.grid });
    });
    this.input.addEventListener('input', () => { this.touchedInput = true; this.onInput(); });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
  }

  /** Two labelled pickers — map size (km) and grid detail (N) — with a hint. */
  private buildOptions(): HTMLElement {
    const wrap = el('div', 'lp-opts');
    wrap.append(
      this.optionRow({
        icon: '🗺', label: t('landing.opt.size'), values: SIZE_OPTIONS,
        current: () => this.km, set: (v) => { this.km = v; }, unit: 'km',
      }),
      this.optionRow({
        icon: '▦', label: t('landing.opt.detail'), values: GRID_OPTIONS,
        current: () => this.grid, set: (v) => { this.grid = v; }, unit: '',
      }),
    );
    const hint = el('div', 'lp-opt-hint');
    hint.textContent = t('landing.opt.hint');
    wrap.appendChild(hint);
    return wrap;
  }

  private optionRow(o: OptionSpec): HTMLElement {
    const row = el('div', 'lp-opt-row');
    const lab = el('div', 'lp-opt-label');
    const ic = el('span', 'lp-opt-ic');
    ic.textContent = o.icon;
    const text = document.createElement('span');
    text.textContent = o.label;
    lab.append(ic, text);

    const seg = el('div', 'lp-seg');
    for (const v of o.values) {
      const b = button('lp-seg-btn' + (v === o.current() ? ' on' : ''), String(v));
      b.addEventListener('click', () => {
        o.set(v);
        seg.querySelectorAll('.lp-seg-btn').forEach((other) => other.classList.toggle('on', other === b));
        this.onScaleChange();
      });
      seg.appendChild(b);
    }
    if (o.unit) {
      const u = el('span', 'lp-seg-unit');
      u.textContent = o.unit;
      seg.appendChild(u);
    }
    row.append(lab, seg);
    return row;
  }

  /** Size/density changed → re-prefetch + refresh facts for the chosen scale. */
  private onScaleChange(): void {
    if (this.selected) this.select(this.selected);
  }

  private async bootstrapFromIp(): Promise<void> {
    const ip = await detectIpLocation().catch(() => null);
    if (!ip || this.touchedInput || this.selected) return;
    const displayName = ip.city ? [ip.city, ip.region].filter(Boolean).join(', ') : formatCoords(ip.lat, ip.lon);
    this.select({ lat: ip.lat, lon: ip.lon, displayName });
  }

  private onInput(): void {
    const text = this.input.value;
    window.clearTimeout(this.debounce);
    const coords = parseCoords(text);
    if (coords) {
      this.items = [{ lat: coords.lat, lon: coords.lon, label: formatCoords(coords.lat, coords.lon) }];
      this.highlight = 0;
      this.renderAc();
      return;
    }
    if (text.trim().length < 3) { this.closeAc(); return; }
    this.debounce = window.setTimeout(async () => {
      this.abort?.abort();
      this.abort = new AbortController();
      this.items = await suggest(text, getLanguage(), this.abort.signal);
      this.highlight = -1;
      this.renderAc();
    }, 250);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' && this.items.length) {
      e.preventDefault();
      this.highlight = (this.highlight + 1) % this.items.length;
      this.updateAcActive();
    } else if (e.key === 'ArrowUp' && this.items.length) {
      e.preventDefault();
      this.highlight = (this.highlight - 1 + this.items.length) % this.items.length;
      this.updateAcActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void this.submit();
    } else if (e.key === 'Escape') {
      this.closeAc();
    }
  }

  private async submit(): Promise<void> {
    if (this.highlight >= 0 && this.items[this.highlight]) {
      const s = this.items[this.highlight];
      this.select({ lat: s.lat, lon: s.lon, displayName: s.label });
      return;
    }
    const text = this.input.value.trim();
    if (!text) return;
    const coords = parseCoords(text);
    if (coords) {
      this.select({ lat: coords.lat, lon: coords.lon, displayName: formatCoords(coords.lat, coords.lon) });
      return;
    }
    this.closeAc();
    try {
      this.select(await geocode(text));
    } catch {
      renderFactError(this.facts, text);
    }
  }

  private renderAc(): void {
    if (!this.items.length) { this.closeAc(); return; }
    this.acList.innerHTML = '';
    this.items.forEach((s, i) => {
      const item = el('div', 'lp-ac-item' + (i === this.highlight ? ' active' : ''));
      item.dir = 'auto';
      item.textContent = s.label;
      item.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        this.select({ lat: s.lat, lon: s.lon, displayName: s.label });
      });
      item.addEventListener('mouseenter', () => { this.highlight = i; this.updateAcActive(); });
      this.acList.appendChild(item);
    });
    this.acList.classList.add('show');
  }

  private updateAcActive(): void {
    Array.from(this.acList.children).forEach((c, i) => c.classList.toggle('active', i === this.highlight));
  }

  private closeAc(): void {
    this.acList?.classList.remove('show');
    this.items = [];
    this.highlight = -1;
  }

  /** Commit a chosen place: prefill, enable CTAs, swap the backdrop, prefetch, show facts. */
  private select(location: GeocodeResult): void {
    this.selected = location;
    this.input.value = shortLabel(location);
    this.closeAc();
    this.btnRealtime.disabled = !this.webglOk;
    this.btnVideo.disabled = !this.webglOk;
    const token = ++this.selectToken;
    renderPreparing(this.facts, location);
    void this.swapBackdrop(location);
    prefetchWorld(this.worldRequest(location)).then(
      (res) => { if (token === this.selectToken) renderFacts(this.facts, location, res); },
      () => { if (token === this.selectToken) renderFactError(this.facts, this.input.value.trim()); },
    );
  }

  private worldRequest(location: GeocodeResult): WorldRequest {
    return {
      location,
      mapSizeKm: this.km,
      N: this.grid,
      elevationSource: DEFAULT_PARAMS.elevationSource,
      useSurface: DEFAULT_PARAMS.useSurface,
      params: { ...DEFAULT_PARAMS, mapSizeKm: this.km, gridResolution: this.grid },
    };
  }

  private async swapBackdrop(location: GeocodeResult): Promise<void> {
    const token = ++this.bgToken;
    const url = await landingBackdrop(location).catch(() => null);
    if (!url || token !== this.bgToken) return;
    this.bg.style.backgroundImage = `url("${url}")`;
    this.bg.classList.add('show');
  }

}
