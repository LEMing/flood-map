export type RainFootprint = 'uniform' | 'spot';
export type BoundaryMode = 'open' | 'closed';
export type TerrainStyle = 'satellite' | 'hypsometric' | 'heatmap' | 'surface';
export type ElevationSource = 'glo30' | 'fabdem' | 'terrarium';

// Urban pluvial flood model: a realistic design / observed storm hyetograph
// instead of flat rain. See sim/storm.ts.
export type StormType = 'constant' | 'cloudburst' | 'design25yr' | 'may2026' | 'jun2026';

export const STORM_LABELS: Record<StormType, string> = {
  constant: 'Constant (manual mm/hr)',
  cloudburst: 'Залповый ливень (~50 mm / 2 h)',
  design25yr: 'Design storm P≈25 yr',
  may2026: 'Observed 18 May 2026 (41 mm/2 h)',
  jun2026: 'Observed 12 Jun 2026 (90 mm/day)',
};

export const SOURCE_LABELS: Record<ElevationSource | 'synthetic', string> = {
  glo30: 'Copernicus GLO-30',
  fabdem: 'FABDEM (bare-earth)',
  terrarium: 'SRTM (terrarium)',
  synthetic: 'synthetic',
};

export interface Params {
  // Location / map
  address: string;
  mapSizeKm: number;
  gridResolution: number;
  elevationSource: ElevationSource;
  verticalExaggeration: number;

  // Rain
  raining: boolean;
  intensityMmPerHr: number;
  stormType: StormType; // hyetograph driving the rain over sim time
  storm: boolean; // dark clouds + lightning atmosphere
  rainFootprint: RainFootprint;
  spotX: number; // 0..1 in grid space
  spotY: number; // 0..1 in grid space
  spotRadius: number; // fraction of map (0..1)

  // Urban surface model (land cover + OSM → per-cell infiltration/drainage/roughness)
  useSurface: boolean; // use the land-cover / OSM derived per-cell fields
  drainageCapacityMmPerHr: number; // storm-sewer removal capacity in the served (built-up) zone
  groundwaterHigh: boolean; // high water table → suppress soil infiltration (подтопление)
  burnBuildings: boolean; // raise OSM buildings as no-flow obstacles

  // Soil / atmosphere
  infiltrationMmPerHr: number; // pervious-soil infiltration (scaled down by high groundwater)
  evaporationPerHr: number; // fraction of depth lost per simulated hour

  // Physics
  gravity: number; // m/s^2
  pipeArea: number; // virtual-pipe cross-section coefficient (m)
  friction: number; // flux damping per second (0 = none, ~0.1 mild)
  substeps: number;
  timeScale: number; // simulated seconds per real second
  boundary: BoundaryMode;

  // One-shot water dump (flash flood) — instant volume instead of rain
  releaseDepthM: number;
  // "Fill to level" — flood ground up to this many metres above the lowest point
  fillLevelM: number;
  floodLevelLive: boolean; // live: water tracks the flood-level slider in real time

  // Simulation control
  running: boolean;

  // Visualization
  terrainStyle: TerrainStyle;
  imageryDarkening: number; // how much deep water darkens the terrain beneath
  waterOpacity: number;
  depthColorMax: number; // m — depth mapped to the deepest color
  showMaxFlood: boolean;
  showVelocity: boolean;
  wireframe: boolean;
}

export const DEFAULT_PARAMS: Params = {
  address: 'Музыкальный микрорайон, Краснодар',
  mapSizeKm: 2.5,
  gridResolution: 512,
  elevationSource: 'fabdem', // bare-earth base; buildings added back via OSM
  verticalExaggeration: 1.0,

  raining: true,
  intensityMmPerHr: 120,
  stormType: 'cloudburst',
  storm: true,
  rainFootprint: 'uniform',
  spotX: 0.5,
  spotY: 0.5,
  spotRadius: 0.25,

  useSurface: true,
  drainageCapacityMmPerHr: 8, // ~P=1yr 60-min storm-sewer capacity in the served core
  groundwaterHigh: true, // Krasnodar подтопление: pre-saturated soils
  burnBuildings: true,

  infiltrationMmPerHr: 12, // pervious-soil capacity before groundwater scaling
  evaporationPerHr: 0.0,

  gravity: 9.81,
  pipeArea: 1.0,
  friction: 0.06,
  substeps: 4,
  timeScale: 180, // 1 real second = 3 simulated minutes
  boundary: 'open',

  releaseDepthM: 3,
  fillLevelM: 5,
  floodLevelLive: false,
  running: true,

  terrainStyle: 'satellite',
  imageryDarkening: 0.8,
  waterOpacity: 0.62,
  depthColorMax: 2.0,
  showMaxFlood: false,
  showVelocity: false,
  wireframe: false,
};

export const GRID_RESOLUTIONS = [128, 256, 512, 1024] as const;
