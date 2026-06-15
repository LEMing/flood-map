export const tl: Record<string, string> = {
  // Address bar
  'input.placeholder': 'Address, lugar, o "lat, lon"…',
  'btn.load': 'I-load',
  'btn.loading': 'Naglo-load…',
  'autocomplete.useCoords': 'Gamitin ang coordinates {coords}',

  // Panel + folders
  'panel.title': 'Mapa ng Baha',
  'sim.title': 'Simulation',
  'rain.title': 'Ulan',
  'urban.title': 'Modelong urban',
  'soil.title': 'Lupa at evaporation',
  'physics.title': 'Physics',
  'map.title': 'Mapa (i-reload)',
  'viz.title': 'Visualization',
  'stats.title': 'Stats',

  // Simulation
  'sim.play': 'Patugtog ▶',
  'sim.pause': 'I-pause ⏸',
  'sim.step': 'Hakbang ⏭',
  'sim.reset': 'I-reset ⟳',
  'sim.dump': 'Magbuhos ng tubig 💧 (biglaang baha)',
  'sim.fill': 'Punuin hanggang antas 🌊 (isahang beses)',
  'sim.dumpDepth': 'lalim ng buhos (m)',
  'sim.floodLevel': 'antas ng baha (+m)',
  'sim.liveFlood': 'live na antas ng baha',
  'sim.timescale': 'oras × (sim s/s)',
  'sim.substeps': 'substeps',
  'pour.button': 'Magsalin ng tubig',
  'pour.hint': 'I-click ang mapa para magsalin ng tubig',
  'pour.depth': 'lalim ng salin (m)',
  'pour.radius': 'radius ng salin (m)',

  // Rain
  'rain.raining': 'umuulan',
  'rain.stormEvent': 'uri ng bagyo',
  'rain.clouds': 'mga ulap ⛈ + kidlat',
  'rain.constant': 'tuloy-tuloy na mm/hr',
  'rain.footprint': 'sakop',
  'rain.footprintUniform': 'Pantay-pantay',
  'rain.footprintSpot': 'Storm cell',
  'rain.cellX': 'cell x',
  'rain.cellY': 'cell y',
  'rain.cellRadius': 'radius ng cell',

  // Storm hyetograph presets
  'storm.constant': 'Tuloy-tuloy (manu-manong mm/hr)',
  'storm.cloudburst': 'Cloudburst (~50 mm / 2 h)',
  'storm.design25yr': 'Design storm P≈25 yr',
  'storm.may2026': 'Naobserbahan 18 May 2026 (41 mm/2 h)',
  'storm.jun2026': 'Naobserbahan 12 Jun 2026 (90 mm/day)',

  // Urban model
  'urban.surface': 'modelo ng surface',
  'urban.buildings': 'mga gusali bilang pader',
  'urban.sewer': 'storm sewer (mm/hr)',
  'urban.groundwater': 'mataas na groundwater',

  // Soil
  'soil.infiltration': 'infiltration ng lupa (mm/hr)',
  'soil.evaporation': 'evaporation (/hr)',

  // Physics
  'physics.gravity': 'gravity (m/s²)',
  'physics.flow': 'flow coefficient',
  'physics.friction': 'friction',
  'physics.edges': 'mga gilid',
  'physics.edgesOpen': 'Bukas (umaagos)',
  'physics.edgesClosed': 'Sarado (mga pader)',

  // Map
  'map.elevation': 'elevation',
  'map.size': 'laki (km)',
  'map.grid': 'grid',
  'map.apply': 'I-apply ang laki / grid ⟲',
  'map.demoMode': 'demo mode',

  // Demo mode (precomputed, scrubbable storm timeline)
  'demo.title': 'Demo',
  'demo.precompute': 'I-precompute ang bagyo ⏳',
  'demo.statusLabel': 'status',
  'demo.timeline': 'timeline',
  'demo.play': 'patugtugin ang timeline ▶',
  'demo.live': 'Live na sim ⟳',
  'demo.stComputing': 'kinakalkula… {pct}%',
  'demo.stReady': 'handa na ang eksena — i-scrub ang oras',
  'demo.stLive': 'live',

  // Visualization
  'viz.terrain': 'terrain',
  'viz.terrainSatellite': 'Satellite',
  'viz.terrainHypso': 'Tint ayon sa taas',
  'viz.terrainHeatmap': 'Heatmap ng taas',
  'viz.terrainSurface': 'Surface (panganib ng baha)',
  'viz.darkening': 'pagdilim ayon sa lalim',
  'viz.vertical': 'vertical ×',
  'viz.opacity': 'opacity ng tubig',
  'viz.depthMax': 'max na kulay ng lalim (m)',
  'viz.maxFlood': 'max na sakop ng baha',
  'viz.arrows': 'mga arrow ng agos',
  'viz.wireframe': 'wireframe na terrain',
  'viz.language': 'wika',
  'viz.waterQuality': 'kalidad ng tubig',
  'viz.qLow': 'Mababa (mabilis)',
  'viz.qMedium': 'Katamtaman',
  'viz.qHigh': 'Mataas (maganda)',
  'viz.reflections': 'repleksyon ng langit',
  'viz.refraction': 'refraction',
  'viz.clarity': 'linaw ng tubig',
  'viz.ripples': 'lakas ng gilas',
  'viz.flowSpeed': 'bilis ng agos',
  'viz.foam': 'bula',
  'viz.glint': 'kislap ng araw',
  'viz.shoreline': 'lambot ng baybayin (m)',
  'viz.skirt': 'mga pader sa gilid',
  'viz.floodOverlay': 'overlay ng mapa ng baha',
  'viz.floodGrid': 'grid ng baha',

  // Atmosphere / post-processing
  'atmo.title': 'Atmospera',
  'atmo.post': 'post-processing',
  'atmo.exposure': 'exposure',
  'atmo.bloom': 'bloom',
  'atmo.ssao': 'ambient occlusion',
  'atmo.vignette': 'vignette',
  'atmo.wetness': 'basang lupa (ulan)',
  'atmo.cloudShadows': 'mga anino ng ulap',
  'atmo.godRays': 'mga sinag ng liwanag (bagyo)',
  'atmo.haze': 'ulap sa lupa',
  'atmo.splashes': 'mga tilamsik ng ulan',
  'atmo.renderScale': 'render scale',
  'atmo.autoQuality': 'auto na kalidad',

  // Stats
  'stats.location': 'lokasyon',
  'stats.simTime': 'oras ng sim',
  'stats.rainIn': 'ulan sa',
  'stats.stored': 'naimbak na tubig',
  'stats.flooded': 'lugar na binaha',
  'stats.maxDepth': 'max na lalim',
  'stats.fps': 'fps',

  // Toasts
  'toast.loadingPlace': 'Naglo-load ng “{q}”…',
  'toast.loadingSurface': 'Naglo-load ng surface model (land cover + OSM)…',
  'toast.loaded': 'Na-load ang {place}',
  'toast.notFound': 'Walang tugma para sa “{q}”.',
  'toast.geocodeFail': 'Nabigo ang geocoding. Subukan ulit mamaya.',
  'toast.enterAddress': 'Pakilagay ang address.',
  'toast.autoQuality': 'Ibinaba ang kalidad ng graphics para manatiling smooth.',
  'toast.detecting': 'Tinutukoy ang iyong lokasyon…',

  // Misc
  'legend.elevation': 'Elevation',
  'readout.elev': 'elev',
  'readout.water': 'tubig',
};
