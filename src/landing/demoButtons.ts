import type { GeocodeResult } from '../geo/geocode';
import { formatCoords } from '../url';

export function wireDemoButtons(root: HTMLElement, onSelect: (location: GeocodeResult) => void): void {
  root.querySelectorAll<HTMLButtonElement>('.lp-demo-btn').forEach((demo) => {
    demo.addEventListener('click', () => {
      const location = demoLocation(demo);
      if (location) onSelect(location);
    });
  });
}

function demoLocation(demo: HTMLButtonElement): GeocodeResult | null {
  const lat = Number(demo.dataset.lat);
  const lon = Number(demo.dataset.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat,
    lon,
    displayName: demo.dataset.label ?? demo.textContent?.trim() ?? formatCoords(lat, lon),
  };
}
