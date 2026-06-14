export interface StatsData {
  location: string;
  simTime: string;
  rained: string;
  stored: string;
  floodedArea: string;
  maxDepth: string;
  fps: string;
}

export const INITIAL_STATS: StatsData = {
  location: '—',
  simTime: '0 s',
  rained: '0 m³',
  stored: '0 m³',
  floodedArea: '0 %',
  maxDepth: '0.00 m',
  fps: '0',
};

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)} s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`;
  return `${(seconds / 3600).toFixed(2)} h`;
}

export function formatVolume(cubicMeters: number): string {
  if (cubicMeters >= 1e6) return `${(cubicMeters / 1e6).toFixed(2)} ×10⁶ m³`;
  if (cubicMeters >= 1e3) return `${(cubicMeters / 1e3).toFixed(1)} ×10³ m³`;
  return `${cubicMeters.toFixed(0)} m³`;
}
