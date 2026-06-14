export interface Poi {
  lat: number;
  lon: number;
  label: string;
}

// Named places to mark on the map whenever they fall inside the loaded area.
export const POINTS_OF_INTEREST: Poi[] = [
  { lat: 45.0762, lon: 38.9988, label: 'Музыкальный микрорайон' },
];
