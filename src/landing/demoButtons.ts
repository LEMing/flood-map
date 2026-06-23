import type { GeocodeResult } from '../geo/geocode';
import { formatCoords } from '../url';

export function wireDemoButtons(root: HTMLElement, onSelect: (location: GeocodeResult) => void): void {
  root.querySelectorAll<HTMLElement>('.lp-demo-btn').forEach((demo) => {
    demo.addEventListener('click', (e) => {
      // The chips are real <a href="/flood/<slug>/"> for crawlability; a plain click stays in the
      // SPA (preselect the place), while a modified/middle click opens the per-place page in a tab.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const location = demoLocation(demo);
      if (!location) return;
      e.preventDefault();
      onSelect(location);
    });
  });
}

function demoLocation(demo: HTMLElement): GeocodeResult | null {
  const lat = Number(demo.dataset.lat);
  const lon = Number(demo.dataset.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat,
    lon,
    displayName: demo.dataset.label ?? demo.textContent?.trim() ?? formatCoords(lat, lon),
  };
}
