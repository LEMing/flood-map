import type { LatLon } from './heightmap';
import { ENDPOINTS } from './endpoints';
import { t } from '../i18n';

export interface GeocodeResult extends LatLon {
  displayName: string;
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
      lat: 45.0762,
      lon: 38.9988,
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
