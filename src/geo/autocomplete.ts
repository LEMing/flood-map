// Free address autocomplete via Photon (Komoot) — OSM-based, CORS-enabled, no
// API key. https://photon.komoot.io/api/?q=…
export interface Suggestion {
  label: string;
  lat: number;
  lon: number;
}

interface PhotonProps {
  name?: string;
  street?: string;
  housenumber?: string;
  city?: string;
  district?: string;
  county?: string;
  state?: string;
  country?: string;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: PhotonProps;
}

function labelOf(p: PhotonProps): string {
  const street = p.housenumber && p.street ? `${p.street} ${p.housenumber}` : p.street;
  const parts = [p.name, street, p.district, p.city, p.county, p.state, p.country].filter(
    (x): x is string => !!x,
  );
  return [...new Set(parts)].join(', ');
}

const PHOTON_LANGS = new Set(['en', 'de', 'fr']);

export async function suggest(query: string, lang: string, signal?: AbortSignal): Promise<Suggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const langParam = PHOTON_LANGS.has(lang) ? `&lang=${lang}` : '';
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6${langParam}`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: PhotonFeature[] };
    return (data.features ?? [])
      .map((f) => ({
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        label: labelOf(f.properties),
      }))
      .filter((s) => s.label && isFinite(s.lat) && isFinite(s.lon));
  } catch {
    return []; // aborted or network error
  }
}
