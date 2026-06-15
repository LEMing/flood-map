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
  'pour.button': 'Wasser eingießen',
  'pour.hint': 'Auf die Karte klicken, um dort Wasser einzugießen',
  'pour.depth': 'Eingießtiefe (m)',
  'pour.radius': 'Eingießradius (m)',

  // Rain
  'rain.raining': 'es regnet',
  'rain.stormEvent': 'Unwetter',
  'rain.clouds': 'Wolken ⛈ + Blitze',
  'rain.constant': 'konstant mm/hr',
  'rain.footprint': 'Ausdehnung',
  'rain.footprintUniform': 'Gleichmäßig',
  'rain.footprintSpot': 'Gewitterzelle',
  'rain.cellX': 'Zelle x',
  'rain.cellY': 'Zelle y',
  'rain.cellRadius': 'Zellenradius',

  // Storm hyetograph presets
  'storm.constant': 'Konstant (manuell mm/h)',
  'storm.cloudburst': 'Wolkenbruch (~50 mm / 2 h)',
  'storm.design25yr': 'Bemessungsregen P≈25 J.',
  'storm.may2026': 'Beobachtet 18. Mai 2026 (41 mm/2 h)',
  'storm.jun2026': 'Beobachtet 12. Juni 2026 (90 mm/Tag)',

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
  'map.demoMode': 'Demo-Modus',

  // Demo mode (precomputed, scrubbable storm timeline)
  'demo.title': 'Demo',
  'demo.precompute': 'Unwetter vorberechnen ⏳',
  'demo.statusLabel': 'Status',
  'demo.timeline': 'Zeitleiste',
  'demo.play': 'Zeitleiste abspielen ▶',
  'demo.live': 'Live-Sim ⟳',
  'demo.stComputing': 'berechne… {pct}%',
  'demo.stReady': 'Szene bereit — Zeit scrubben',
  'demo.stLive': 'live',

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
  'viz.waterQuality': 'Wasserqualität',
  'viz.qLow': 'Niedrig (schnell)',
  'viz.qMedium': 'Mittel',
  'viz.qHigh': 'Hoch (schön)',
  'viz.reflections': 'Himmelsspiegelung',
  'viz.refraction': 'Lichtbrechung',
  'viz.clarity': 'Wasserklarheit',
  'viz.ripples': 'Wellenstärke',
  'viz.flowSpeed': 'Strömungsgeschwindigkeit',
  'viz.foam': 'Schaum',
  'viz.glint': 'Sonnenglitzern',
  'viz.shoreline': 'Uferweichheit (m)',
  'viz.skirt': 'Randwände',
  'viz.floodOverlay': 'Hochwasser-Overlay',
  'viz.floodGrid': 'Hochwasserraster',

  // Atmosphere / post-processing
  'atmo.title': 'Atmosphäre',
  'atmo.post': 'Nachbearbeitung',
  'atmo.exposure': 'Belichtung',
  'atmo.bloom': 'Leuchten (Bloom)',
  'atmo.ssao': 'Umgebungsverdeckung',
  'atmo.vignette': 'Vignette',
  'atmo.wetness': 'nasser Boden (Regen)',
  'atmo.cloudShadows': 'Wolkenschatten',
  'atmo.godRays': 'Lichtstrahlen (Unwetter)',
  'atmo.haze': 'Bodendunst',
  'atmo.splashes': 'Regenspritzer',
  'atmo.renderScale': 'Render-Skalierung',
  'atmo.autoQuality': 'Auto-Qualität',

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
  'toast.autoQuality': 'Grafikqualität gesenkt, damit es flüssig bleibt.',
  'toast.detecting': 'Standort wird ermittelt…',

  // Misc
  'legend.elevation': 'Höhe',
  'readout.elev': 'Höhe',
  'readout.water': 'Wasser',
};
