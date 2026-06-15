export type RainFootprint = 'uniform' | 'spot';
export type BoundaryMode = 'open' | 'closed';
export type TerrainStyle = 'satellite' | 'hypsometric' | 'heatmap' | 'surface';
export type ElevationSource = 'glo30' | 'fabdem' | 'terrarium';
export type WaterQuality = 'low' | 'medium' | 'high';

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

  // Demo mode: a simplified panel + a precomputed, scrubbable storm timeline
  demoMode: boolean;
  timelinePos: number; // 0..1 scrub position through the precomputed timeline
  timelinePlaying: boolean; // auto-advance the timeline

  // Visualization
  terrainStyle: TerrainStyle;
  imageryDarkening: number; // how much deep water darkens the terrain beneath
  waterOpacity: number;
  depthColorMax: number; // m — depth mapped to the deepest color
  showMaxFlood: boolean;
  showVelocity: boolean;
  wireframe: boolean;

  // Water surface (Tier 1 shader)
  waterQuality: WaterQuality; // master gate: low=flat, medium=+refraction/foam, high=+3-octave/AO-friendly
  waterReflections: boolean; // sky + cloud reflection with fresnel
  waterRefraction: boolean; // screen-space refraction of the submerged bottom
  waterClarity: number; // 0 realistic/transparent .. 1 clear depth-map colouring (overlay-like)
  rippleStrength: number; // 0..1 normal perturbation amount
  flowSpeed: number; // how fast velX/velY advects the ripples
  foamAmount: number; // 0..1 shoreline + turbulence foam
  sunGlint: number; // 0..2 specular highlight strength
  shorelineSoftness: number; // metres of soft alpha fade at the water edge
  skirtEnabled: boolean; // perimeter wall so deep edge water doesn't show holes
  floodOverlay: boolean; // bold flood-extent map layer (clear "where is water")
  floodGrid: boolean; // relief grid lines on the flood overlay

  // Atmosphere / post-processing (Tier 2)
  postProcessing: boolean; // master switch for the EffectComposer stack
  exposure: number; // ACES tonemap exposure
  bloom: number; // 0..2 bloom strength (0 = off)
  ssao: boolean; // GTAO ambient occlusion (opt-in, costly)
  vignette: number; // 0..1 darkness
  wetness: number; // 0..1 wet-look terrain when raining
  cloudShadows: number; // 0..1 moving cloud-shadow strength on ground + water
  godRays: number; // 0..1 light-shaft strength (storm only)
  groundHaze: number; // 0..1 low ground haze (storm)
  rainSplashes: boolean; // splash rings on the water when raining
  renderScale: number; // 0.5..1 render-resolution scale (fill-rate vs sharpness)
  autoQuality: boolean; // drop effects automatically on sustained low FPS
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

  demoMode: false,
  timelinePos: 0,
  timelinePlaying: false,

  terrainStyle: 'satellite',
  imageryDarkening: 0.8,
  waterOpacity: 0.62,
  depthColorMax: 2.0,
  showMaxFlood: false,
  showVelocity: false,
  wireframe: false,

  waterQuality: 'medium',
  waterReflections: true,
  waterRefraction: true,
  waterClarity: 0.6,
  rippleStrength: 0.5,
  flowSpeed: 0.6,
  foamAmount: 0.6,
  sunGlint: 1.0,
  shorelineSoftness: 0.25,
  skirtEnabled: true,
  floodOverlay: false,
  floodGrid: true,

  postProcessing: true,
  exposure: 1.15,
  bloom: 0.35,
  ssao: false,
  vignette: 0.35,
  wetness: 0.7,
  cloudShadows: 0.35,
  godRays: 0.4,
  groundHaze: 0.12,
  rainSplashes: true,
  renderScale: 1,
  autoQuality: true,
};

export const GRID_RESOLUTIONS = [128, 256, 512, 1024, 2048] as const;
