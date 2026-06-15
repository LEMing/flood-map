export interface Poi {
  lat: number;
  lon: number;
  label: string;
  // Optional boundary outline ([lat, lon] vertices) — drawn as a polygon
  // instead of a pin when present.
  polygon?: Array<[number, number]>;
}

// Музыкальный микрорайон, traced from its bounding streets (Московская west,
// Российская east, Солнечная south, Петра Метальникова north) — OSM has no
// tagged boundary for it.
const MUSIC_POLYGON: Array<[number, number]> = [
  [45.0715, 39.0008], // SW — Московская × Солнечная
  [45.0902, 39.0020], // NW — Московская north
  [45.0910, 39.0100], // N  — near Петра Метальникова / Стрелка
  [45.0902, 39.0182], // NE — Российская north
  [45.0713, 39.0168], // SE — Российская × Солнечная
];

// Named places to mark on the map whenever they fall inside the loaded area.
export const POINTS_OF_INTEREST: Poi[] = [
  { lat: 45.0803, lon: 39.0092, label: 'Музыкальный микрорайон', polygon: MUSIC_POLYGON },
];
