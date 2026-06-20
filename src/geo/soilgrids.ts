// Real, location-specific topsoil profile (0–2 m) from ISRIC SoilGrids v2.0.
// The REST point query is CORS-open (Access-Control-Allow-Origin: *), so we call
// it directly in dev and prod. Many pixels are masked (urban/water) and return
// null means — we probe a small ring of nearby coordinates and fall back to the
// bundled regional column if every probe is null. CC-BY 4.0 (ISRIC).

import { cachedJson } from './cache';
import type { GeoLayer } from './geology';
import type { SoilTextureInput } from './pedotransfer';

const BASE = 'https://rest.isric.org/soilgrids/v2.0/properties/query';
const PROPS = ['sand', 'silt', 'clay', 'bdod', 'soc'] as const;
const D_FACTOR: Record<string, number> = { sand: 10, silt: 10, clay: 10, bdod: 100, soc: 10 };

interface SoilGridsDepth {
  label: string;
  range: { top_depth: number; bottom_depth: number; unit_depth: string };
  values: { mean: number | null };
}
interface SoilGridsLayer { name: string; depths: SoilGridsDepth[] }
interface SoilGridsResponse { properties: { layers: SoilGridsLayer[] } }

function queryUrl(lat: number, lon: number): string {
  const props = PROPS.map((p) => `property=${p}`).join('&');
  return `${BASE}?lon=${lon.toFixed(4)}&lat=${lat.toFixed(4)}&${props}&value=mean`;
}

/** USDA-ish texture name from sand/silt/clay %. */
function textureClass(sand: number, silt: number, clay: number): string {
  if (clay >= 40) return clay >= 60 ? 'heavy clay' : 'clay';
  if (sand >= 70) return 'sandy';
  if (silt >= 50) return 'silt';
  if (clay >= 27) return 'clay loam';
  return 'loam';
}

// Soil colour by clay content, darkened by organic carbon (humus-rich chernozem = dark).
function soilHex(clay: number, socGkg: number): number {
  const clayCol = { r: 0.42, g: 0.32, b: 0.22 };
  const sandCol = { r: 0.80, g: 0.69, b: 0.45 };
  const f = Math.min(1, clay / 60);
  const humus = Math.min(0.55, socGkg / 80); // 0..0.55 darkening
  const r = (sandCol.r + (clayCol.r - sandCol.r) * f) * (1 - humus);
  const g = (sandCol.g + (clayCol.g - sandCol.g) * f) * (1 - humus);
  const b = (sandCol.b + (clayCol.b - sandCol.b) * f) * (1 - humus);
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

function parse(resp: SoilGridsResponse): GeoLayer[] | null {
  const byName: Record<string, SoilGridsDepth[]> = {};
  for (const layer of resp.properties.layers) byName[layer.name] = layer.depths;
  const clay = byName.clay;
  if (!clay) return null;

  const out: GeoLayer[] = [];
  for (let i = 0; i < clay.length; i++) {
    const val = (name: string): number | null => {
      const d = byName[name]?.[i]?.values.mean;
      return d == null ? null : d / D_FACTOR[name];
    };
    const c = val('clay'); const s = val('sand'); const si = val('silt'); const soc = val('soc');
    if (c == null || s == null || si == null) continue; // masked pixel band
    const top = clay[i].range.top_depth / 100; // cm → m
    const bot = clay[i].range.bottom_depth / 100;
    out.push({
      key: `soil:${textureClass(s, si, c)}`,
      topM: top,
      botM: bot,
      hex: soilHex(c, soc ?? 10),
      source: 'soilgrids',
    });
  }
  return out.length ? out : null;
}

const PROBE_RING: Array<[number, number]> = [
  [0, 0], [0.01, 0], [-0.01, 0], [0, 0.01], [0, -0.01], [0.03, 0.03], [-0.03, -0.03],
];

/**
 * Fetch the real 0–2 m soil profile, probing a ring of nearby pixels when the
 * exact point is masked. Returns null if every probe is masked or the API fails.
 */
export async function fetchSoilProfile(lat: number, lon: number): Promise<GeoLayer[] | null> {
  for (const [dLat, dLon] of PROBE_RING) {
    try {
      const url = queryUrl(lat + dLat, lon + dLon);
      const resp = await cachedJson<SoilGridsResponse>(url, { key: `soilgrids:${url}` });
      const layers = parse(resp);
      if (layers) return layers;
    } catch {
      /* try the next ring offset; fall through to null */
    }
  }
  return null;
}

// Topsoil (0–30 cm) depth bands and their thicknesses (cm) for an infiltration-relevant
// composite — the layer that actually controls how fast a downpour soaks in.
const TOPSOIL_BANDS: Array<{ i: number; w: number }> = [{ i: 0, w: 5 }, { i: 1, w: 10 }, { i: 2, w: 15 }];

/** Thickness-weighted topsoil sand/clay fractions + organic-matter % from a SoilGrids reply. */
export function parseSoilTexture(resp: SoilGridsResponse): SoilTextureInput | null {
  const byName: Record<string, SoilGridsDepth[]> = {};
  for (const layer of resp.properties.layers) byName[layer.name] = layer.depths;
  if (!byName.sand || !byName.clay) return null;

  let wSum = 0, socWSum = 0, sand = 0, clay = 0, soc = 0;
  for (const { i, w } of TOPSOIL_BANDS) {
    const s = byName.sand[i]?.values.mean;
    const c = byName.clay[i]?.values.mean;
    if (s == null || c == null) continue;
    wSum += w;
    sand += (s / D_FACTOR.sand) * w; // g/kg → %
    clay += (c / D_FACTOR.clay) * w;
    const so = byName.soc?.[i]?.values.mean;
    if (so != null) { soc += (so / D_FACTOR.soc) * w; socWSum += w; } // own denominator: don't dilute OM
  }
  if (wSum === 0) return null;
  const socGkg = socWSum > 0 ? soc / socWSum : 0;
  return {
    sandFrac: sand / wSum / 100,
    clayFrac: clay / wSum / 100,
    omPct: (socGkg / 10) * 1.724, // SOC g/kg → SOC % → organic matter % (van Bemmelen)
  };
}

/** Real topsoil texture (0–30 cm) for the pedotransfer, probing the masked-pixel ring. */
export async function fetchSoilTexture(lat: number, lon: number): Promise<SoilTextureInput | null> {
  for (const [dLat, dLon] of PROBE_RING) {
    try {
      const url = queryUrl(lat + dLat, lon + dLon);
      const resp = await cachedJson<SoilGridsResponse>(url, { key: `soilgrids:${url}` });
      const tex = parseSoilTexture(resp);
      if (tex) return tex;
    } catch {
      /* next ring offset */
    }
  }
  return null;
}
