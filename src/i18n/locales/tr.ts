export const tr: Record<string, string> = {
  // Address bar
  'input.placeholder': 'Adres, yer veya "enlem, boylam"…',
  'btn.load': 'Yükle',
  'btn.loading': 'Yükleniyor…',
  'autocomplete.useCoords': '{coords} koordinatlarını kullan',

  // Panel + folders
  'panel.title': 'Taşkın Haritası',
  'sim.title': 'Simülasyon',
  'rain.title': 'Yağmur',
  'urban.title': 'Kentsel model',
  'soil.title': 'Toprak ve buharlaşma',
  'physics.title': 'Fizik',
  'map.title': 'Harita (yeniden yükle)',
  'viz.title': 'Görselleştirme',
  'stats.title': 'İstatistikler',

  // Simulation
  'sim.play': 'Oynat ▶',
  'sim.pause': 'Duraklat ⏸',
  'sim.step': 'Adım ⏭',
  'sim.reset': 'Sıfırla ⟳',
  'sim.dump': 'Su boşalt 💧 (ani taşkın)',
  'sim.fill': 'Seviyeye doldur 🌊 (tek seferlik)',
  'sim.dumpDepth': 'boşaltma derinliği (m)',
  'sim.floodLevel': 'taşkın seviyesi (+m)',
  'sim.liveFlood': 'canlı taşkın seviyesi',
  'sim.timescale': 'zaman × (sim s/s)',
  'sim.substeps': 'alt adımlar',

  // Rain
  'rain.raining': 'yağmur yağıyor',
  'rain.stormEvent': 'fırtına olayı',
  'rain.clouds': 'bulutlar ⛈ + şimşek',
  'rain.constant': 'sabit mm/hr',
  'rain.footprint': 'kapsama alanı',
  'rain.footprintUniform': 'Düzgün',
  'rain.footprintSpot': 'Fırtına hücresi',

  // Urban model
  'urban.surface': 'yüzey modeli',
  'urban.buildings': 'duvar olarak binalar',
  'urban.sewer': 'yağmur kanalizasyonu (mm/hr)',
  'urban.groundwater': 'yüksek yer altı suyu',

  // Soil
  'soil.infiltration': 'toprak sızması (mm/hr)',
  'soil.evaporation': 'buharlaşma (/hr)',

  // Physics
  'physics.gravity': 'yerçekimi (m/s²)',
  'physics.flow': 'akış katsayısı',
  'physics.friction': 'sürtünme',
  'physics.edges': 'kenarlar',
  'physics.edgesOpen': 'Açık (tahliye)',
  'physics.edgesClosed': 'Kapalı (duvarlar)',

  // Map
  'map.elevation': 'yükseklik',
  'map.size': 'boyut (km)',
  'map.grid': 'ızgara',
  'map.apply': 'Boyut / ızgara uygula ⟲',

  // Visualization
  'viz.terrain': 'arazi',
  'viz.terrainSatellite': 'Uydu',
  'viz.terrainHypso': 'Yükseklik tonu',
  'viz.terrainHeatmap': 'Yükseklik ısı haritası',
  'viz.terrainSurface': 'Yüzey (taşkın riski)',
  'viz.darkening': 'derinlik koyulaştırma',
  'viz.vertical': 'dikey ×',
  'viz.opacity': 'su opaklığı',
  'viz.depthMax': 'derinlik renk maks (m)',
  'viz.maxFlood': 'maks taşkın yayılımı',
  'viz.arrows': 'akış okları',
  'viz.wireframe': 'tel kafes arazi',
  'viz.language': 'dil',

  // Stats
  'stats.location': 'konum',
  'stats.simTime': 'sim süresi',
  'stats.rainIn': 'yağan yağmur',
  'stats.stored': 'depolanan su',
  'stats.flooded': 'taşkın alanı',
  'stats.maxDepth': 'maks derinlik',
  'stats.fps': 'fps',

  // Toasts
  'toast.loadingPlace': '“{q}” yükleniyor…',
  'toast.loadingSurface': 'Yüzey modeli yükleniyor (arazi örtüsü + OSM)…',
  'toast.loaded': '{place} yüklendi',
  'toast.notFound': '“{q}” için eşleşme bulunamadı.',
  'toast.geocodeFail': 'Coğrafi kodlama başarısız oldu. Birazdan tekrar deneyin.',
  'toast.enterAddress': 'Lütfen bir adres girin.',
  'toast.detecting': 'Konumunuz belirleniyor…',

  // Misc
  'legend.elevation': 'Yükseklik',
  'readout.elev': 'yük',
  'readout.water': 'su',
};
