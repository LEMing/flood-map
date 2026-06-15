export const fr: Record<string, string> = {
  // Address bar
  'input.placeholder': 'Adresse, lieu ou "lat, lon"…',
  'btn.load': 'Charger',
  'btn.loading': 'Chargement…',
  'autocomplete.useCoords': 'Utiliser les coordonnées {coords}',

  // Panel + folders
  'panel.title': "Carte d'inondation",
  'sim.title': 'Simulation',
  'rain.title': 'Pluie',
  'urban.title': 'Modèle urbain',
  'soil.title': 'Sol et évaporation',
  'physics.title': 'Physique',
  'map.title': 'Carte (recharger)',
  'viz.title': 'Visualisation',
  'stats.title': 'Statistiques',

  // Simulation
  'sim.play': 'Lecture ▶',
  'sim.pause': 'Pause ⏸',
  'sim.step': 'Pas ⏭',
  'sim.reset': 'Réinitialiser ⟳',
  'sim.dump': "Lâcher de l'eau 💧 (crue éclair)",
  'sim.fill': 'Remplir au niveau 🌊 (unique)',
  'sim.dumpDepth': 'profondeur de lâcher (m)',
  'sim.floodLevel': "niveau d'inondation (+m)",
  'sim.liveFlood': "niveau d'inondation en direct",
  'sim.timescale': 'temps × (sim s/s)',
  'sim.substeps': 'sous-pas',

  // Rain
  'rain.raining': 'il pleut',
  'rain.stormEvent': 'orage',
  'rain.clouds': 'nuages ⛈ + éclairs',
  'rain.constant': 'constant mm/hr',
  'rain.footprint': 'emprise',
  'rain.footprintUniform': 'Uniforme',
  'rain.footprintSpot': "Cellule d'orage",

  // Urban model
  'urban.surface': 'modèle de surface',
  'urban.buildings': 'bâtiments comme murs',
  'urban.sewer': 'égout pluvial (mm/hr)',
  'urban.groundwater': 'nappe phréatique élevée',

  // Soil
  'soil.infiltration': 'infiltration du sol (mm/hr)',
  'soil.evaporation': 'évaporation (/hr)',

  // Physics
  'physics.gravity': 'gravité (m/s²)',
  'physics.flow': 'coefficient de débit',
  'physics.friction': 'frottement',
  'physics.edges': 'bords',
  'physics.edgesOpen': 'Ouverts (drainent)',
  'physics.edgesClosed': 'Fermés (murs)',

  // Map
  'map.elevation': 'altitude',
  'map.size': 'taille (km)',
  'map.grid': 'grille',
  'map.apply': 'Appliquer taille / grille ⟲',

  // Visualization
  'viz.terrain': 'terrain',
  'viz.terrainSatellite': 'Satellite',
  'viz.terrainHypso': "Teinte d'altitude",
  'viz.terrainHeatmap': 'Carte thermique des hauteurs',
  'viz.terrainSurface': "Surface (risque d'inondation)",
  'viz.darkening': 'assombrissement par profondeur',
  'viz.vertical': 'vertical ×',
  'viz.opacity': "opacité de l'eau",
  'viz.depthMax': 'couleur max de profondeur (m)',
  'viz.maxFlood': "étendue max d'inondation",
  'viz.arrows': 'flèches de flux',
  'viz.wireframe': 'terrain filaire',
  'viz.language': 'langue',

  // Stats
  'stats.location': 'emplacement',
  'stats.simTime': 'temps de sim',
  'stats.rainIn': 'pluie en',
  'stats.stored': 'eau stockée',
  'stats.flooded': 'zone inondée',
  'stats.maxDepth': 'profondeur max',
  'stats.fps': 'fps',

  // Toasts
  'toast.loadingPlace': 'Chargement de « {q} »…',
  'toast.loadingSurface': 'Chargement du modèle de surface (couverture du sol + OSM)…',
  'toast.loaded': '{place} chargé',
  'toast.notFound': 'Aucun résultat trouvé pour « {q} ».',
  'toast.geocodeFail': 'Le géocodage a échoué. Réessayez dans un instant.',
  'toast.enterAddress': 'Veuillez saisir une adresse.',
  'toast.detecting': 'Détection de votre position…',

  // Misc
  'legend.elevation': 'Altitude',
  'readout.elev': 'alt',
  'readout.water': 'eau',
};
