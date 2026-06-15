// Subsurface geological column under the map. Only the top ~2 m is real,
// location-specific data (SoilGrids, spliced in by soilgrids.ts); everything
// below is a generalized REGIONAL model for the Western Ciscaucasian foredeep
// (Indolo-Kuban trough) over the Scythian Platform, with the deep crustal
// boundaries from CRUST1.0 for the Krasnodar 1°×1° cell. Depths are metres
// below the local ground surface; the legend states this is a model, not a log.

export type GeoSource = 'soilgrids' | 'regional' | 'crust1';

export interface GeoLayer {
  /** i18n suffix: t('geo.l.' + key) gives the display name. */
  key: string;
  topM: number;
  botM: number;
  hex: number;
  source: GeoSource;
}

export interface GeoColumn {
  layers: GeoLayer[];
  /** true once the top soil bands came from a live SoilGrids query. */
  soilReal: boolean;
}

// Generalized Krasnodar / Kuban column (topsoil placeholders are replaced by
// real SoilGrids bands when available). Sources: CRUST1.0 (Laske et al. 2013)
// for crustal boundaries (Moho ≈ 39.9 km here); regional stratigraphy of the
// Indolo-Kuban foredeep for the sedimentary section (Maikop ≈ 3.5–7 km).
export const KRASNODAR_COLUMN: GeoLayer[] = [
  { key: 'topsoil', topM: 0, botM: 0.3, hex: 0x3b2a1a, source: 'regional' },
  { key: 'subsoil', topM: 0.3, botM: 2.0, hex: 0x6b4f2a, source: 'regional' },
  { key: 'alluvium', topM: 2, botM: 30, hex: 0xb9a06a, source: 'regional' },
  { key: 'neogene', topM: 30, botM: 3500, hex: 0x9bb0b8, source: 'regional' },
  { key: 'maikop', topM: 3500, botM: 7000, hex: 0x43342a, source: 'regional' },
  { key: 'mesozoic', topM: 7000, botM: 9000, hex: 0x3f6f63, source: 'regional' },
  { key: 'basement', topM: 9000, botM: 12000, hex: 0xa26d8c, source: 'regional' },
  { key: 'upperCrust', topM: 12000, botM: 19500, hex: 0x8a7d86, source: 'crust1' },
  { key: 'midCrust', topM: 19500, botM: 33720, hex: 0x6d6a72, source: 'crust1' },
  { key: 'lowerCrust', topM: 33720, botM: 39910, hex: 0x544a55, source: 'crust1' },
  { key: 'mantle', topM: 39910, botM: 60000, hex: 0x2e2230, source: 'crust1' },
];

/** Index of the Maikop aquiclude (the regional aquitard that perches the water
 * table and drives urban подтопление) so the UI can highlight it. */
export const AQUICLUDE_KEY = 'maikop';

export function defaultColumn(): GeoColumn {
  return { layers: KRASNODAR_COLUMN.map((l) => ({ ...l })), soilReal: false };
}

/**
 * Replace the two generic topsoil bands (0–2 m) with the real SoilGrids bands
 * when a profile is available, keeping every deeper regional/crustal layer.
 */
export function withSoilProfile(soil: GeoLayer[] | null): GeoColumn {
  const deep = KRASNODAR_COLUMN.filter((l) => l.topM >= 2).map((l) => ({ ...l }));
  if (!soil || soil.length === 0) return defaultColumn();
  return { layers: [...soil, ...deep], soilReal: true };
}
