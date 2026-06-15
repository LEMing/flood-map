export const es: Record<string, string> = {
  // Address bar
  'input.placeholder': 'Dirección, lugar o "lat, lon"…',
  'btn.load': 'Cargar',
  'btn.loading': 'Cargando…',
  'autocomplete.useCoords': 'Usar coordenadas {coords}',

  // Panel + folders
  'panel.title': 'Mapa de inundación',
  'sim.title': 'Simulación',
  'rain.title': 'Lluvia',
  'urban.title': 'Modelo urbano',
  'soil.title': 'Suelo y evaporación',
  'physics.title': 'Física',
  'map.title': 'Mapa (recargar)',
  'viz.title': 'Visualización',
  'stats.title': 'Estadísticas',

  // Simulation
  'sim.play': 'Reproducir ▶',
  'sim.pause': 'Pausar ⏸',
  'sim.step': 'Paso ⏭',
  'sim.reset': 'Reiniciar ⟳',
  'sim.dump': 'Soltar agua 💧 (riada súbita)',
  'sim.fill': 'Llenar al nivel 🌊 (única vez)',
  'sim.dumpDepth': 'profundidad de descarga (m)',
  'sim.floodLevel': 'nivel de inundación (+m)',
  'sim.liveFlood': 'nivel de inundación en vivo',
  'sim.timescale': 'tiempo × (sim s/s)',
  'sim.substeps': 'subpasos',

  // Rain
  'rain.raining': 'lloviendo',
  'rain.stormEvent': 'tormenta',
  'rain.clouds': 'nubes ⛈ + relámpagos',
  'rain.constant': 'constante mm/hr',
  'rain.footprint': 'cobertura',
  'rain.footprintUniform': 'Uniforme',
  'rain.footprintSpot': 'Célula de tormenta',

  // Urban model
  'urban.surface': 'modelo de superficie',
  'urban.buildings': 'edificios como muros',
  'urban.sewer': 'alcantarillado pluvial (mm/hr)',
  'urban.groundwater': 'nivel freático alto',

  // Soil
  'soil.infiltration': 'infiltración del suelo (mm/hr)',
  'soil.evaporation': 'evaporación (/hr)',

  // Physics
  'physics.gravity': 'gravedad (m/s²)',
  'physics.flow': 'coeficiente de flujo',
  'physics.friction': 'fricción',
  'physics.edges': 'bordes',
  'physics.edgesOpen': 'Abiertos (drenan)',
  'physics.edgesClosed': 'Cerrados (muros)',

  // Map
  'map.elevation': 'elevación',
  'map.size': 'tamaño (km)',
  'map.grid': 'malla',
  'map.apply': 'Aplicar tamaño / malla ⟲',

  // Visualization
  'viz.terrain': 'terreno',
  'viz.terrainSatellite': 'Satélite',
  'viz.terrainHypso': 'Tinte por elevación',
  'viz.terrainHeatmap': 'Mapa de calor de altura',
  'viz.terrainSurface': 'Superficie (riesgo de inundación)',
  'viz.darkening': 'oscurecimiento por profundidad',
  'viz.vertical': 'vertical ×',
  'viz.opacity': 'opacidad del agua',
  'viz.depthMax': 'color máx de profundidad (m)',
  'viz.maxFlood': 'extensión máx de inundación',
  'viz.arrows': 'flechas de flujo',
  'viz.wireframe': 'terreno de malla',
  'viz.language': 'idioma',

  // Stats
  'stats.location': 'ubicación',
  'stats.simTime': 'tiempo de sim',
  'stats.rainIn': 'lluvia en',
  'stats.stored': 'agua almacenada',
  'stats.flooded': 'área inundada',
  'stats.maxDepth': 'profundidad máx',
  'stats.fps': 'fps',

  // Toasts
  'toast.loadingPlace': 'Cargando «{q}»…',
  'toast.loadingSurface': 'Cargando modelo de superficie (cobertura del suelo + OSM)…',
  'toast.loaded': '{place} cargado',
  'toast.notFound': 'No se encontró ninguna coincidencia para «{q}».',
  'toast.geocodeFail': 'La geocodificación falló. Inténtalo de nuevo en un momento.',
  'toast.enterAddress': 'Por favor, introduce una dirección.',

  // Misc
  'legend.elevation': 'Elevación',
  'readout.elev': 'elev',
  'readout.water': 'agua',
};
