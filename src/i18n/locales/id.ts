export const id: Record<string, string> = {
  // Address bar
  'input.placeholder': 'Alamat, tempat, atau "lat, lon"…',
  'btn.load': 'Muat',
  'btn.loading': 'Memuat…',
  'autocomplete.useCoords': 'Gunakan koordinat {coords}',

  // Panel + folders
  'panel.title': 'Peta Banjir',
  'sim.title': 'Simulasi',
  'rain.title': 'Hujan',
  'urban.title': 'Model perkotaan',
  'soil.title': 'Tanah & penguapan',
  'physics.title': 'Fisika',
  'map.title': 'Peta (muat ulang)',
  'viz.title': 'Visualisasi',
  'stats.title': 'Statistik',

  // Simulation
  'sim.play': 'Putar ▶',
  'sim.pause': 'Jeda ⏸',
  'sim.step': 'Langkah ⏭',
  'sim.reset': 'Atur ulang ⟳',
  'sim.dump': 'Lepaskan air 💧 (banjir bandang)',
  'sim.fill': 'Isi ke level 🌊 (sekali)',
  'sim.dumpDepth': 'kedalaman pelepasan (m)',
  'sim.floodLevel': 'tinggi banjir (+m)',
  'sim.liveFlood': 'tinggi banjir langsung',
  'sim.timescale': 'waktu × (dtk sim/dtk)',
  'sim.substeps': 'sublangkah',

  // Rain
  'rain.raining': 'hujan',
  'rain.stormEvent': 'peristiwa badai',
  'rain.clouds': 'awan ⛈ + petir',
  'rain.constant': 'konstan mm/hr',
  'rain.footprint': 'jangkauan',
  'rain.footprintUniform': 'Seragam',
  'rain.footprintSpot': 'Sel badai',

  // Urban model
  'urban.surface': 'model permukaan',
  'urban.buildings': 'bangunan sebagai dinding',
  'urban.sewer': 'saluran air hujan (mm/hr)',
  'urban.groundwater': 'air tanah tinggi',

  // Soil
  'soil.infiltration': 'infiltrasi tanah (mm/hr)',
  'soil.evaporation': 'penguapan (/hr)',

  // Physics
  'physics.gravity': 'gravitasi (m/s²)',
  'physics.flow': 'koefisien aliran',
  'physics.friction': 'gesekan',
  'physics.edges': 'tepi',
  'physics.edgesOpen': 'Terbuka (mengalir)',
  'physics.edgesClosed': 'Tertutup (dinding)',

  // Map
  'map.elevation': 'ketinggian',
  'map.size': 'ukuran (km)',
  'map.grid': 'kisi',
  'map.apply': 'Terapkan ukuran / kisi ⟲',

  // Visualization
  'viz.terrain': 'medan',
  'viz.terrainSatellite': 'Satelit',
  'viz.terrainHypso': 'Warna ketinggian',
  'viz.terrainHeatmap': 'Peta panas ketinggian',
  'viz.terrainSurface': 'Permukaan (risiko banjir)',
  'viz.darkening': 'penggelapan kedalaman',
  'viz.vertical': 'vertikal ×',
  'viz.opacity': 'opasitas air',
  'viz.depthMax': 'maks warna kedalaman (m)',
  'viz.maxFlood': 'jangkauan banjir maks',
  'viz.arrows': 'panah aliran',
  'viz.wireframe': 'medan rangka',
  'viz.language': 'bahasa',

  // Stats
  'stats.location': 'lokasi',
  'stats.simTime': 'waktu sim',
  'stats.rainIn': 'curah hujan',
  'stats.stored': 'air tersimpan',
  'stats.flooded': 'area tergenang',
  'stats.maxDepth': 'kedalaman maks',
  'stats.fps': 'fps',

  // Toasts
  'toast.loadingPlace': 'Memuat "{q}"…',
  'toast.loadingSurface': 'Memuat model permukaan (tutupan lahan + OSM)…',
  'toast.loaded': '{place} dimuat',
  'toast.notFound': 'Tidak ada hasil untuk "{q}".',
  'toast.geocodeFail': 'Geocoding gagal. Coba lagi sebentar.',
  'toast.enterAddress': 'Silakan masukkan alamat.',
  'toast.detecting': 'Mendeteksi lokasi Anda…',

  // Misc
  'legend.elevation': 'Ketinggian',
  'readout.elev': 'ketinggian',
  'readout.water': 'air',
};
