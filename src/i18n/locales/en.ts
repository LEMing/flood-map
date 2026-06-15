// English is the source catalog. Other locales mirror these keys; any missing
// key falls back to English. Keep {placeholders}, emoji and units unchanged
// when translating.
export const en: Record<string, string> = {
  // Address bar
  'input.placeholder': 'Address, place, or "lat, lon"…',
  'btn.load': 'Load',
  'btn.loading': 'Loading…',
  'autocomplete.useCoords': 'Use coordinates {coords}',

  // Panel + folders
  'panel.title': 'Flood Map',
  'sim.title': 'Simulation',
  'rain.title': 'Rain',
  'urban.title': 'Urban model',
  'soil.title': 'Soil & evaporation',
  'physics.title': 'Physics',
  'map.title': 'Map (reload)',
  'viz.title': 'Visualization',
  'stats.title': 'Stats',

  // Simulation
  'sim.play': 'Play ▶',
  'sim.pause': 'Pause ⏸',
  'sim.step': 'Step ⏭',
  'sim.reset': 'Reset ⟳',
  'sim.dump': 'Dump water 💧 (flash flood)',
  'sim.fill': 'Fill to level 🌊 (one-shot)',
  'sim.dumpDepth': 'dump depth (m)',
  'sim.floodLevel': 'flood level (+m)',
  'sim.liveFlood': 'live flood level',
  'sim.timescale': 'time × (sim s/s)',
  'sim.substeps': 'substeps',

  // Rain
  'rain.raining': 'raining',
  'rain.stormEvent': 'storm event',
  'rain.clouds': 'clouds ⛈ + lightning',
  'rain.constant': 'constant mm/hr',
  'rain.footprint': 'footprint',
  'rain.footprintUniform': 'Uniform',
  'rain.footprintSpot': 'Storm cell',
  'rain.cellX': 'cell x',
  'rain.cellY': 'cell y',
  'rain.cellRadius': 'cell radius',

  // Storm hyetograph presets
  'storm.constant': 'Constant (manual mm/hr)',
  'storm.cloudburst': 'Cloudburst (~50 mm / 2 h)',
  'storm.design25yr': 'Design storm P≈25 yr',
  'storm.may2026': 'Observed 18 May 2026 (41 mm/2 h)',
  'storm.jun2026': 'Observed 12 Jun 2026 (90 mm/day)',

  // Urban model
  'urban.surface': 'surface model',
  'urban.buildings': 'buildings as walls',
  'urban.sewer': 'storm sewer (mm/hr)',
  'urban.groundwater': 'high groundwater',

  // Soil
  'soil.infiltration': 'soil infiltration (mm/hr)',
  'soil.evaporation': 'evaporation (/hr)',

  // Physics
  'physics.gravity': 'gravity (m/s²)',
  'physics.flow': 'flow coefficient',
  'physics.friction': 'friction',
  'physics.edges': 'edges',
  'physics.edgesOpen': 'Open (drains)',
  'physics.edgesClosed': 'Closed (walls)',

  // Map
  'map.elevation': 'elevation',
  'map.size': 'size (km)',
  'map.grid': 'grid',
  'map.apply': 'Apply size / grid ⟲',

  // Visualization
  'viz.terrain': 'terrain',
  'viz.terrainSatellite': 'Satellite',
  'viz.terrainHypso': 'Elevation tint',
  'viz.terrainHeatmap': 'Height heatmap',
  'viz.terrainSurface': 'Surface (flood risk)',
  'viz.darkening': 'depth darkening',
  'viz.vertical': 'vertical ×',
  'viz.opacity': 'water opacity',
  'viz.depthMax': 'depth color max (m)',
  'viz.maxFlood': 'max flood extent',
  'viz.arrows': 'flow arrows',
  'viz.wireframe': 'wireframe terrain',
  'viz.language': 'language',
  'viz.waterQuality': 'water quality',
  'viz.qLow': 'Low (fast)',
  'viz.qMedium': 'Medium',
  'viz.qHigh': 'High (pretty)',
  'viz.reflections': 'sky reflection',
  'viz.refraction': 'refraction',
  'viz.clarity': 'water clarity',
  'viz.ripples': 'ripple strength',
  'viz.flowSpeed': 'flow speed',
  'viz.foam': 'foam',
  'viz.glint': 'sun glint',
  'viz.shoreline': 'shoreline softness (m)',
  'viz.skirt': 'edge skirt walls',
  'viz.floodOverlay': 'flood map overlay',
  'viz.floodGrid': 'flood grid',

  // Atmosphere / post-processing
  'atmo.title': 'Atmosphere',
  'atmo.post': 'post-processing',
  'atmo.exposure': 'exposure',
  'atmo.bloom': 'bloom',
  'atmo.ssao': 'ambient occlusion',
  'atmo.vignette': 'vignette',
  'atmo.wetness': 'wet ground (rain)',
  'atmo.cloudShadows': 'cloud shadows',
  'atmo.godRays': 'light shafts (storm)',
  'atmo.haze': 'ground haze',
  'atmo.splashes': 'rain splashes',

  // Stats
  'stats.location': 'location',
  'stats.simTime': 'sim time',
  'stats.rainIn': 'rain in',
  'stats.stored': 'water stored',
  'stats.flooded': 'flooded area',
  'stats.maxDepth': 'max depth',
  'stats.fps': 'fps',

  // Toasts
  'toast.loadingPlace': 'Loading “{q}”…',
  'toast.loadingSurface': 'Loading surface model (land cover + OSM)…',
  'toast.loaded': 'Loaded {place}',
  'toast.notFound': 'No match found for “{q}”.',
  'toast.geocodeFail': 'Geocoding failed. Try again in a moment.',
  'toast.enterAddress': 'Please enter an address.',
  'toast.detecting': 'Detecting your location…',

  // Misc
  'legend.elevation': 'Elevation',
  'readout.elev': 'elev',
  'readout.water': 'water',
};
