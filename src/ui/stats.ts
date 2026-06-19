export interface StatsData {
  location: string;
  simTime: string;
  rained: string;
  stored: string;
  balance: string;
  floodedArea: string;
  maxDepth: string;
  fps: string;
  timelineStatus: string;
}

export const INITIAL_STATS: StatsData = {
  location: '—',
  simTime: '0 s',
  rained: '0 m³',
  stored: '0 m³',
  balance: '—',
  floodedArea: '~0 %',
  maxDepth: '~0.0 m',
  fps: '0',
  timelineStatus: 'live',
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

// Water-budget closure: of all the water put in (rain + manual dumps), how much is
// still ponded vs lost to infiltration, storm drains, evaporation and edge outflow.
// Ponded can never exceed input — a live check that the solver conserves mass rather
// than conjuring water. (Bathtub "fill" is not flux-tracked, so it is excluded from
// `input` and retained is clamped to 100% in that mode.)
export function formatWaterBalance(rained: number, injected: number, stored: number): string {
  const input = rained + injected;
  if (input <= 0) return '—';
  const retained = Math.min(100, Math.round((stored / input) * 100));
  return `~${retained}% ponded · ${formatVolume(Math.max(0, input - stored))} lost`;
}
