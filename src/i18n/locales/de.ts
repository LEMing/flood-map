export const de: Record<string, string> = {
  // Address bar
  'input.placeholder': 'Adresse, Ort oder "Breite, Länge"…',
  'btn.load': 'Laden',
  'btn.loading': 'Lädt…',
  'autocomplete.useCoords': 'Koordinaten {coords} verwenden',

  // Panel + folders
  'panel.title': 'Hochwasserkarte',
  'sim.title': 'Simulation',
  'rain.title': 'Regen',
  'urban.title': 'Stadtmodell',
  'soil.title': 'Boden & Verdunstung',
  'physics.title': 'Physik',
  'map.title': 'Karte (neu laden)',
  'viz.title': 'Visualisierung',
  'stats.title': 'Statistik',

  // Simulation
  'sim.play': 'Start ▶',
  'sim.pause': 'Pause ⏸',
  'sim.step': 'Schritt ⏭',
  'sim.reset': 'Zurücksetzen ⟳',
  'sim.dump': 'Wasser ablassen 💧 (Sturzflut)',
  'sim.fill': 'Auf Pegel füllen 🌊 (einmalig)',
  'sim.dumpDepth': 'Ablasstiefe (m)',
  'sim.floodLevel': 'Hochwasserpegel (+m)',
  'sim.liveFlood': 'Live-Hochwasserpegel',
  'sim.timescale': 'Zeit × (Sim s/s)',
  'sim.substeps': 'Teilschritte',

  // Rain
  'rain.raining': 'es regnet',
  'rain.stormEvent': 'Unwetter',
  'rain.clouds': 'Wolken ⛈ + Blitze',
  'rain.constant': 'konstant mm/hr',
  'rain.footprint': 'Ausdehnung',
  'rain.footprintUniform': 'Gleichmäßig',
  'rain.footprintSpot': 'Gewitterzelle',

  // Urban model
  'urban.surface': 'Oberflächenmodell',
  'urban.buildings': 'Gebäude als Wände',
  'urban.sewer': 'Regenkanalisation (mm/hr)',
  'urban.groundwater': 'hoher Grundwasserstand',

  // Soil
  'soil.infiltration': 'Bodeninfiltration (mm/hr)',
  'soil.evaporation': 'Verdunstung (/hr)',

  // Physics
  'physics.gravity': 'Schwerkraft (m/s²)',
  'physics.flow': 'Strömungskoeffizient',
  'physics.friction': 'Reibung',
  'physics.edges': 'Ränder',
  'physics.edgesOpen': 'Offen (Abfluss)',
  'physics.edgesClosed': 'Geschlossen (Wände)',

  // Map
  'map.elevation': 'Höhe',
  'map.size': 'Größe (km)',
  'map.grid': 'Raster',
  'map.apply': 'Größe / Raster anwenden ⟲',

  // Visualization
  'viz.terrain': 'Gelände',
  'viz.terrainSatellite': 'Satellit',
  'viz.terrainHypso': 'Höhenfärbung',
  'viz.terrainHeatmap': 'Höhen-Heatmap',
  'viz.terrainSurface': 'Oberfläche (Hochwasserrisiko)',
  'viz.darkening': 'Tiefenabdunklung',
  'viz.vertical': 'vertikal ×',
  'viz.opacity': 'Wassertransparenz',
  'viz.depthMax': 'Tiefenfarbe max (m)',
  'viz.maxFlood': 'max Hochwasserausdehnung',
  'viz.arrows': 'Strömungspfeile',
  'viz.wireframe': 'Drahtgittergelände',
  'viz.language': 'Sprache',

  // Stats
  'stats.location': 'Standort',
  'stats.simTime': 'Sim-Zeit',
  'stats.rainIn': 'Regen seit',
  'stats.stored': 'gespeichertes Wasser',
  'stats.flooded': 'überflutete Fläche',
  'stats.maxDepth': 'max Tiefe',
  'stats.fps': 'fps',

  // Toasts
  'toast.loadingPlace': '„{q}“ wird geladen…',
  'toast.loadingSurface': 'Oberflächenmodell wird geladen (Landbedeckung + OSM)…',
  'toast.loaded': '{place} geladen',
  'toast.notFound': 'Keine Treffer für „{q}“.',
  'toast.geocodeFail': 'Geokodierung fehlgeschlagen. Versuchen Sie es gleich erneut.',
  'toast.enterAddress': 'Bitte geben Sie eine Adresse ein.',

  // Misc
  'legend.elevation': 'Höhe',
  'readout.elev': 'Höhe',
  'readout.water': 'Wasser',
};
