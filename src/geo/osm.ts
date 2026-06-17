import type { LatLon } from './heightmap';
import { localMetersToLonLat, lonLatToLocalMeters } from './projection';
import { cachedJson } from './cache';

// OpenStreetMap features (via Overpass `out geom`) rasterized to the grid:
//  - building : no-flow obstacles that route water into the streets
//  - road     : preferential flow channels (lowered a few cm)
//  - water    : rivers / lakes (open water)
//  - green    : parks / grass / farmland (pervious, high infiltration)

export interface OsmRasters {
  building: Uint8Array;
  road: Uint8Array;
  water: Uint8Array;
  green: Uint8Array;
  counts: { buildings: number; roads: number };
}

interface OsmWay {
  type: string;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

// CORS-enabled Overpass mirrors (overpass-api.de rejects browser Origin with 406).
// Russia-hosted maps.mail.ru first — fast and well-covered for Krasnodar.
const OVERPASS_MIRRORS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

type OverpassResponse = { elements: OsmWay[] };

// Cache keyed by the query (not the mirror URL) so a re-query hits cache
// regardless of which mirror served the original response.
async function overpassFetch(query: string): Promise<OverpassResponse> {
  const cacheKey = `overpass:${query}`;
  let lastError: unknown;
  for (const mirror of OVERPASS_MIRRORS) {
    const url = `${mirror}?data=${encodeURIComponent(query)}`;
    try {
      return await cachedJson<OverpassResponse>(url, { key: cacheKey });
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error('All Overpass mirrors failed');
}

const ROAD_WIDTH: Record<string, number> = {
  motorway: 16, trunk: 13, primary: 11, secondary: 9, tertiary: 8,
  residential: 6, unclassified: 6, living_street: 5, service: 4,
  pedestrian: 4, footway: 2.5, path: 2, cycleway: 2.5,
};

export function roadWidthM(tags: Record<string, string>): number {
  const w = tags.width ? parseFloat(tags.width) : NaN;
  if (isFinite(w)) return w;
  const lanes = tags.lanes ? parseInt(tags.lanes, 10) : NaN;
  if (isFinite(lanes)) return Math.max(1, lanes) * 3.25 + 1.5;
  return ROAD_WIDTH[tags.highway] ?? 5;
}

export function isGreen(t: Record<string, string>): boolean {
  return (
    /^(grass|meadow|forest|farmland|recreation_ground|cemetery|allotments|village_green|orchard|vineyard|greenfield)$/.test(t.landuse ?? '') ||
    /^(park|garden|pitch|golf_course|playground|nature_reserve|dog_park)$/.test(t.leisure ?? '') ||
    /^(wood|scrub|grassland|heath|wetland)$/.test(t.natural ?? '')
  );
}

export function isWater(t: Record<string, string>): boolean {
  return t.natural === 'water' || t.landuse === 'reservoir' || t.waterway === 'riverbank' || t.water !== undefined;
}

export function bbox(center: LatLon, sizeMeters: number): [number, number, number, number] {
  const half = sizeMeters / 2;
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const x of [-half, 0, half]) {
    for (const y of [-half, 0, half]) {
      const [lon, lat] = localMetersToLonLat(center, x, y);
      s = Math.min(s, lat); n = Math.max(n, lat);
      w = Math.min(w, lon); e = Math.max(e, lon);
    }
  }
  return [s, w, n, e];
}

export function fillPolygon(pts: number[][], target: Uint8Array, N: number): void {
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  const y0 = Math.max(0, Math.ceil(minY - 0.5));
  const y1 = Math.min(N - 1, Math.floor(maxY - 0.5));
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
        xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((u, v) => u - v);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.max(0, Math.ceil(xs[i] - 0.5));
      const xb = Math.min(N - 1, Math.floor(xs[i + 1] - 0.5));
      for (let x = xa; x <= xb; x++) target[y * N + x] = 1;
    }
  }
}

export function stampLine(a: number[], b: number[], r: number, target: Uint8Array, N: number): void {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len));
  const ri = Math.max(0, Math.ceil(r));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = Math.round(a[0] + dx * t);
    const cy = Math.round(a[1] + dy * t);
    for (let oy = -ri; oy <= ri; oy++) {
      for (let ox = -ri; ox <= ri; ox++) {
        if (ox * ox + oy * oy > r * r + 0.25) continue;
        const x = cx + ox, y = cy + oy;
        if (x >= 0 && x < N && y >= 0 && y < N) target[y * N + x] = 1;
      }
    }
  }
}

export async function fetchOsm(
  center: LatLon,
  sizeMeters: number,
  N: number,
): Promise<OsmRasters> {
  const [s, w, n, e] = bbox(center, sizeMeters);
  const box = `${s},${w},${n},${e}`;
  const query = `[out:json][timeout:60];(
    way["building"](${box});
    way["highway"](${box});
    way["natural"="water"](${box});
    way["water"](${box});
    way["waterway"](${box});
    way["landuse"](${box});
    way["leisure"](${box});
    way["natural"~"wood|scrub|grassland|heath|wetland"](${box});
  );out geom;`;

  const json = await overpassFetch(query);

  const cellSize = sizeMeters / (N - 1);
  const toGrid = (lon: number, lat: number): number[] => {
    const [mx, my] = lonLatToLocalMeters(center, lon, lat);
    return [(mx / sizeMeters + 0.5) * (N - 1), (my / sizeMeters + 0.5) * (N - 1)];
  };

  const building = new Uint8Array(N * N);
  const road = new Uint8Array(N * N);
  const water = new Uint8Array(N * N);
  const green = new Uint8Array(N * N);
  let buildings = 0, roads = 0;

  for (const el of json.elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const t = el.tags ?? {};
    const pts = el.geometry.map((g) => toGrid(g.lon, g.lat));

    if (t.building) {
      fillPolygon(pts, building, N);
      buildings++;
    } else if (t.highway) {
      const r = Math.max(0.4, roadWidthM(t) / 2 / cellSize);
      for (let i = 1; i < pts.length; i++) stampLine(pts[i - 1], pts[i], r, road, N);
      roads++;
    } else if (t.waterway && !isWater(t)) {
      const r = Math.max(0.5, (parseFloat(t.width) || 4) / 2 / cellSize);
      for (let i = 1; i < pts.length; i++) stampLine(pts[i - 1], pts[i], r, water, N);
    } else if (isWater(t)) {
      fillPolygon(pts, water, N);
    } else if (isGreen(t)) {
      fillPolygon(pts, green, N);
    }
  }

  return { building, road, water, green, counts: { buildings, roads } };
}
