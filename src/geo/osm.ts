import type { LatLon } from './heightmap';
import { localMetersToLonLat, lonLatToLocalMeters } from './projection';
import { cachedJson } from './cache';

// OpenStreetMap features (via Overpass `out geom`) rasterized to the grid:
//  - building : no-flow obstacles that route water into the streets
//  - road     : preferential flow channels (lowered a few cm)
//  - water    : rivers / lakes (open water)
//  - green    : parks / grass / farmland (pervious, high infiltration)

/** A building footprint (ring in grid coords) + its extrusion height in metres. */
export interface BuildingShape {
  ring: number[][]; // [[gx, gy], …] in grid space
  height: number;
}

export interface OsmRasters {
  building: Uint8Array;
  road: Uint8Array;
  water: Uint8Array;
  green: Uint8Array;
  buildings: BuildingShape[]; // footprints + heights for the 3D extrusion
  counts: { buildings: number; roads: number };
}

const DEFAULT_BUILDING_M = 9; // ~2–3 storeys when OSM has no height/levels
const STOREY_M = 3.2;

/** Building height from OSM tags: explicit `height`, else `building:levels`, else default. */
export function buildingHeight(t: Record<string, string>): number {
  const h = t.height ? parseFloat(t.height) : NaN; // "18 m" → 18
  if (isFinite(h) && h > 0) return h;
  const levels = t['building:levels'] ? parseFloat(t['building:levels']) : NaN;
  if (isFinite(levels) && levels > 0) return levels * STOREY_M + 1;
  return DEFAULT_BUILDING_M;
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
const OVERPASS_TIMEOUT_MS = 28000; // generous cap: a big bbox can take ~20 s server-side
const OSM_GREEN_MAX_METERS = 3500; // above this, skip land-use/leisure/green (too heavy)

type OverpassResponse = { elements: OsmWay[] };

// Race ALL CORS mirrors and take the first to respond, instead of trying them
// one-by-one — a single slow/rate-limited mirror used to stack 12 s timeouts and
// make a big (km≥5) query feel like a hang. The winner cancels the losers.
// Cache is keyed by the query (not the mirror) so a re-query hits regardless.
async function overpassFetch(query: string): Promise<OverpassResponse> {
  const cacheKey = `overpass:${query}`;
  const controllers = OVERPASS_MIRRORS.map(() => new AbortController());
  const timers = controllers.map((c) => setTimeout(() => c.abort(), OVERPASS_TIMEOUT_MS));
  const attempts = OVERPASS_MIRRORS.map((mirror, i) => {
    const url = `${mirror}?data=${encodeURIComponent(query)}`;
    return cachedJson<OverpassResponse>(url, { key: cacheKey, init: { signal: controllers[i].signal } });
  });
  try {
    return await Promise.any(attempts);
  } catch {
    throw new Error('All Overpass mirrors failed');
  } finally {
    timers.forEach(clearTimeout);
    controllers.forEach((c) => c.abort()); // cancel the slower mirrors (no-op for the winner)
  }
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
  // Above ~3.5 km the bbox covers a lot of ground and the land-use / leisure /
  // natural-green polygons (farmland etc.) dominate the Overpass payload + parse
  // time. They only feed the pervious-soil fallback, so for big maps we drop them
  // and keep the essentials (buildings + roads + water) — much faster to load.
  const clauses = [
    `way["building"](${box});`,
    `way["highway"](${box});`,
    `way["natural"="water"](${box});`,
    `way["water"](${box});`,
    `way["waterway"](${box});`,
  ];
  if (sizeMeters <= OSM_GREEN_MAX_METERS) {
    clauses.push(
      `way["landuse"](${box});`,
      `way["leisure"](${box});`,
      `way["natural"~"wood|scrub|grassland|heath|wetland"](${box});`,
    );
  }
  const query = `[out:json][timeout:60];(${clauses.join('')});out geom;`;

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
  const buildingShapes: BuildingShape[] = [];
  let buildings = 0, roads = 0;

  for (const el of json.elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const t = el.tags ?? {};
    const pts = el.geometry.map((g) => toGrid(g.lon, g.lat));

    if (t.building) {
      fillPolygon(pts, building, N);
      if (pts.length >= 4) buildingShapes.push({ ring: pts, height: buildingHeight(t) });
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

  return { building, road, water, green, buildings: buildingShapes, counts: { buildings, roads } };
}
