import type { GeocodeResult } from '../geo/geocode';
import type { GeoLoadResult } from '../geo/geoWorkerTypes';
import { t } from '../i18n';
import { chip, spinner, shortLabel } from './dom';

// Renders the landing's facts row in its various states.

/** "Preparing terrain…" placeholder while the world prefetch runs. */
export function renderPreparing(facts: HTMLElement, location: GeocodeResult): void {
  facts.innerHTML = '';
  const place = chip('📍', shortLabel(location));
  const preparing = chip('', t('landing.fact.preparing'), 'loading');
  preparing.prepend(spinner());
  facts.append(place, preparing);
  requestAnimationFrame(() => { place.classList.add('show'); preparing.classList.add('show'); });
}

/** Real facts: place, elevation range, terrain type, building count. */
export function renderFacts(facts: HTMLElement, location: GeocodeResult, res: GeoLoadResult): void {
  const hm = res.heightmap;
  const chips = [
    chip('📍', shortLabel(location)),
    chip('⛰', t('landing.fact.elevation', { min: Math.round(hm.min), max: Math.round(hm.max) })),
    chip('', terrainLabel(hm.max - hm.min)),
  ];
  const buildings = res.surface?.counts.buildings ?? 0;
  if (buildings > 0) {
    chips.push(chip('🏙', t('landing.fact.buildings', { count: buildings.toLocaleString() })));
  }
  facts.innerHTML = '';
  facts.append(...chips);
  chips.forEach((c, i) => window.setTimeout(() => c.classList.add('show'), 40 + i * 55));
}

export function renderFactError(facts: HTMLElement, query: string): void {
  facts.innerHTML = '';
  const c = chip('⚠️', t('toast.notFound', { q: query }));
  facts.append(c);
  requestAnimationFrame(() => c.classList.add('show'));
}

function terrainLabel(relief: number): string {
  if (relief < 20) return t('landing.fact.terrainFlat');
  if (relief < 120) return t('landing.fact.terrainHilly');
  return t('landing.fact.terrainMountain');
}
