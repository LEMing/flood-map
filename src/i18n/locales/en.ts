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

  // Misc
  'legend.elevation': 'Elevation',
  'readout.elev': 'elev',
  'readout.water': 'water',
};
