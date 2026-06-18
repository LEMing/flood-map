import { geocode, type GeocodeResult } from '../geo/geocode';
import { suggest, type Suggestion } from '../geo/autocomplete';
import { landingBackdrop } from '../geo/landingSatellite';
import { detectIpLocation } from '../geo/ipLocation';
import { prefetchWorld, type WorldRequest } from '../geo/worldDataCache';
import type { GeoLoadResult } from '../geo/geoWorkerTypes';
import { DEFAULT_PARAMS, GRID_RESOLUTIONS } from '../config';
import { formatCoords, parseCoords, readUrlState } from '../url';
import { getLanguage, t } from '../i18n';

export interface LandingCallbacks {
  /** Leave the landing and enter the sim for `location` (cinematic = video flow). */
  onEnter(location: GeocodeResult, opts: { cinematic?: boolean }): void;
}

/** Best-effort feature gate: Safari has no webm MediaRecorder, so hide the video CTA. */
export function videoExportSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof MediaRecorder.isTypeSupported === 'function' &&
    (MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ||
      MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ||
      MediaRecorder.isTypeSupported('video/webm'))
  );
}

/**
 * The "/" entry surface: an immersive satellite backdrop with a glass card that
 * geocodes an address, prefetches its world in the background, shows a few facts,
 * and hands off to the sim (realtime or cinematic video) via `onEnter`.
 */
export class Landing {
  private readonly cb: LandingCallbacks;
  private readonly root: HTMLElement;
  private readonly bg: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly acList: HTMLDivElement;
  private readonly facts: HTMLDivElement;
  private readonly btnRealtime: HTMLButtonElement;
  private readonly btnVideo: HTMLButtonElement;

  private selected?: GeocodeResult;
  private items: Suggestion[] = [];
  private highlight = -1;
  private debounce?: number;
  private abort?: AbortController;
  private bgToken = 0;
  private selectToken = 0;
  private touchedInput = false;

  constructor(cb: LandingCallbacks) {
    this.cb = cb;
    this.root = document.getElementById('landing') as HTMLElement;
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
    this.btnRealtime.disabled = true;
    this.btnVideo.disabled = true;
    if (!videoExportSupported()) {
      this.btnVideo.hidden = true;
      cta.classList.add('single');
    }
    cta.append(this.btnRealtime, this.btnVideo);

    card.append(brand, search, this.facts, cta);
    this.root.append(this.bg, scrim, card);

    this.wireEvents();
    void this.bootstrapFromIp();
  }

  /** Re-entry (e.g. browser Back): the DOM persists, just make sure it's visible. */
  show(): void {
    this.input.focus({ preventScroll: true });
  }

  private wireEvents(): void {
    this.btnRealtime.addEventListener('click', () => {
      if (this.selected) this.cb.onEnter(this.selected, {});
    });
    this.btnVideo.addEventListener('click', () => {
      if (this.selected) this.cb.onEnter(this.selected, { cinematic: true });
    });
    this.input.addEventListener('input', () => { this.touchedInput = true; this.onInput(); });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('click', (e) => {
      if (e.target !== this.input && !this.acList.contains(e.target as Node)) this.closeAc();
    });
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
      this.showFactError();
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
    this.acList.classList.remove('show');
    this.items = [];
    this.highlight = -1;
  }

  /** Commit a chosen place: prefill, enable CTAs, swap the backdrop, prefetch, show facts. */
  private select(location: GeocodeResult): void {
    this.selected = location;
    this.input.value = shortLabel(location);
    this.closeAc();
    this.btnRealtime.disabled = false;
    this.btnVideo.disabled = false;
    const token = ++this.selectToken;
    this.renderFacts(location);
    void this.swapBackdrop(location);
    prefetchWorld(this.worldRequest(location)).then(
      (res) => { if (token === this.selectToken) this.setFacts(location, res); },
      () => { if (token === this.selectToken) this.showFactError(); },
    );
  }

  private worldRequest(location: GeocodeResult): WorldRequest {
    const url = readUrlState();
    const km = url.km ?? DEFAULT_PARAMS.mapSizeKm;
    const grid = url.grid && (GRID_RESOLUTIONS as readonly number[]).includes(url.grid)
      ? url.grid : DEFAULT_PARAMS.gridResolution;
    return {
      location,
      mapSizeKm: km,
      N: grid,
      elevationSource: DEFAULT_PARAMS.elevationSource,
      useSurface: DEFAULT_PARAMS.useSurface,
      params: { ...DEFAULT_PARAMS, mapSizeKm: km, gridResolution: grid },
    };
  }

  private async swapBackdrop(location: GeocodeResult): Promise<void> {
    const token = ++this.bgToken;
    const url = await landingBackdrop(location).catch(() => null);
    if (!url || token !== this.bgToken) return;
    this.bg.style.backgroundImage = `url("${url}")`;
    this.bg.classList.add('show');
  }

  /** Render the facts row in its "preparing" state; populated by setFacts later. */
  private renderFacts(location: GeocodeResult): void {
    this.facts.innerHTML = '';
    const place = chip('📍', shortLabel(location));
    const preparing = chip('', t('landing.fact.preparing'), 'loading');
    preparing.prepend(spinner());
    this.facts.append(place, preparing);
    requestAnimationFrame(() => { place.classList.add('show'); preparing.classList.add('show'); });
  }

  /** Replace the "preparing" row with the place's real facts once it's built. */
  private setFacts(location: GeocodeResult, res: GeoLoadResult): void {
    const hm = res.heightmap;
    const relief = hm.max - hm.min;
    const chips = [
      chip('📍', shortLabel(location)),
      chip('⛰', t('landing.fact.elevation', { min: Math.round(hm.min), max: Math.round(hm.max) })),
      chip('', this.terrainLabel(relief)),
    ];
    const buildings = res.surface?.counts.buildings ?? 0;
    if (buildings > 0) {
      chips.push(chip('🏙', t('landing.fact.buildings', { count: buildings.toLocaleString() })));
    }
    this.facts.innerHTML = '';
    this.facts.append(...chips);
    chips.forEach((c, i) => window.setTimeout(() => c.classList.add('show'), 40 + i * 55));
  }

  private terrainLabel(relief: number): string {
    if (relief < 20) return t('landing.fact.terrainFlat');
    if (relief < 120) return t('landing.fact.terrainHilly');
    return t('landing.fact.terrainMountain');
  }

  private showFactError(): void {
    this.facts.innerHTML = '';
    const c = chip('⚠️', t('toast.notFound', { q: this.input.value.trim() }));
    this.facts.append(c);
    requestAnimationFrame(() => c.classList.add('show'));
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function button(className: string, label: string): HTMLButtonElement {
  const b = el('button', className);
  b.type = 'button';
  b.textContent = label;
  return b;
}

function chip(icon: string, text: string, extra = ''): HTMLSpanElement {
  const c = el('span', 'lp-chip' + (extra ? ` ${extra}` : ''));
  if (icon) {
    const i = el('span', 'ic');
    i.textContent = icon;
    c.appendChild(i);
  }
  c.appendChild(document.createTextNode(text));
  return c;
}

function spinner(): HTMLSpanElement {
  return el('span', 'spin');
}

function shortLabel(location: GeocodeResult): string {
  if (parseCoords(location.displayName)) return location.displayName;
  return location.displayName.split(',').slice(0, 2).map((s) => s.trim()).join(', ');
}
