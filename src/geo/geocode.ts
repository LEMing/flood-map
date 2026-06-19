import type { LatLon } from './heightmap';
import { ENDPOINTS } from './endpoints';
import { parseCoords } from '../url';
import { t } from '../i18n';

export interface GeocodeResult extends LatLon {
  displayName: string;
}

/** Trim a display-name string to its two most specific parts ("City, Region"). */
export function shortPlaceName(name: string): string {
  return name.split(',').slice(0, 2).map((s) => s.trim()).filter(Boolean).join(', ');
}

/** Short label for a geocode result — raw coords pass through unshortened. */
export function shortLabel(location: GeocodeResult): string {
  if (parseCoords(location.displayName)) return location.displayName;
  return shortPlaceName(location.displayName);
}

interface NominatimEntry {
  lat: string;
  lon: string;
  display_name: string;
}

// Local overrides for places Nominatim resolves poorly. The Музыкальный
// микрорайон of Krasnodar isn't a Nominatim feature (it returns a same-named
// place in Yeysk), so we pin it from its bounding streets.
const KNOWN_PLACES: Array<{ match: (q: string) => boolean; result: GeocodeResult }> = [
  {
    match: (q) => q.includes('музыкальн') && (q.includes('краснодар') || q.includes('микрорайон')),
    result: {
      lat: 45.0803,
      lon: 39.0092,
      displayName: 'Музыкальный микрорайон, Прикубанский округ, Краснодар',
    },
  },
];

/**
 * Resolve an address / place name to coordinates via Nominatim (OpenStreetMap).
 *
 * Routed through the Vite dev proxy (`/api/geocode`) which injects the
 * User-Agent that the Nominatim usage policy requires. Policy also caps usage
 * at ~1 request/second — fine for interactive single lookups.
 */
export async function geocode(address: string): Promise<GeocodeResult> {
  const query = address.trim();
  if (!query) throw new Error(t('toast.enterAddress'));

  const normalized = query.toLowerCase();
  for (const place of KNOWN_PLACES) {
    if (place.match(normalized)) return place.result;
  }

  const url = `${ENDPOINTS.geocode}/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(t('toast.geocodeFail'));
  }

  const entries = (await res.json()) as NominatimEntry[];
  if (!entries.length) {
    throw new Error(t('toast.notFound', { q: query }));
  }

  const top = entries[0];
  return {
    lat: parseFloat(top.lat),
    lon: parseFloat(top.lon),
    displayName: top.display_name,
  };
}
