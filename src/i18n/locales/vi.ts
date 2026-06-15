export const vi: Record<string, string> = {
  // Address bar
  'input.placeholder': 'Địa chỉ, địa điểm hoặc "vĩ độ, kinh độ"…',
  'btn.load': 'Tải',
  'btn.loading': 'Đang tải…',
  'autocomplete.useCoords': 'Dùng tọa độ {coords}',

  // Panel + folders
  'panel.title': 'Bản đồ ngập lụt',
  'sim.title': 'Mô phỏng',
  'rain.title': 'Mưa',
  'urban.title': 'Mô hình đô thị',
  'soil.title': 'Đất & bốc hơi',
  'physics.title': 'Vật lý',
  'map.title': 'Bản đồ (tải lại)',
  'viz.title': 'Trực quan',
  'stats.title': 'Thống kê',

  // Simulation
  'sim.play': 'Chạy ▶',
  'sim.pause': 'Tạm dừng ⏸',
  'sim.step': 'Bước ⏭',
  'sim.reset': 'Đặt lại ⟳',
  'sim.dump': 'Xả nước 💧 (lũ quét)',
  'sim.fill': 'Đổ tới mức 🌊 (một lần)',
  'sim.dumpDepth': 'độ sâu xả (m)',
  'sim.floodLevel': 'mức ngập (+m)',
  'sim.liveFlood': 'mức ngập trực tiếp',
  'sim.timescale': 'thời gian × (giây mô phỏng/giây)',
  'sim.substeps': 'bước con',

  // Rain
  'rain.raining': 'đang mưa',
  'rain.stormEvent': 'sự kiện bão',
  'rain.clouds': 'mây ⛈ + sét',
  'rain.constant': 'cố định mm/hr',
  'rain.footprint': 'phạm vi mưa',
  'rain.footprintUniform': 'Đồng đều',
  'rain.footprintSpot': 'Ô bão',
  'rain.cellX': 'ô x',
  'rain.cellY': 'ô y',
  'rain.cellRadius': 'bán kính ô',
  'storm.constant': 'Cố định (thủ công mm/giờ)',
  'storm.cloudburst': 'Mưa lớn (~50 mm / 2 giờ)',
  'storm.design25yr': 'Bão thiết kế P≈25 năm',
  'storm.may2026': 'Quan trắc 18 Th5 2026 (41 mm/2 giờ)',
  'storm.jun2026': 'Quan trắc 12 Th6 2026 (90 mm/ngày)',

  // Urban model
  'urban.surface': 'mô hình bề mặt',
  'urban.buildings': 'tòa nhà làm tường',
  'urban.sewer': 'cống thoát nước mưa (mm/hr)',
  'urban.groundwater': 'mực nước ngầm cao',

  // Soil
  'soil.infiltration': 'thấm đất (mm/hr)',
  'soil.evaporation': 'bốc hơi (/hr)',

  // Physics
  'physics.gravity': 'trọng lực (m/s²)',
  'physics.flow': 'hệ số dòng chảy',
  'physics.friction': 'ma sát',
  'physics.edges': 'cạnh',
  'physics.edgesOpen': 'Mở (thoát nước)',
  'physics.edgesClosed': 'Đóng (tường)',

  // Map
  'map.elevation': 'độ cao',
  'map.size': 'kích thước (km)',
  'map.grid': 'lưới',
  'map.apply': 'Áp dụng kích thước / lưới ⟲',

  // Visualization
  'viz.terrain': 'địa hình',
  'viz.terrainSatellite': 'Vệ tinh',
  'viz.terrainHypso': 'Tô màu độ cao',
  'viz.terrainHeatmap': 'Bản đồ nhiệt độ cao',
  'viz.terrainSurface': 'Bề mặt (nguy cơ ngập)',
  'viz.darkening': 'làm tối theo độ sâu',
  'viz.vertical': 'phương đứng ×',
  'viz.opacity': 'độ mờ của nước',
  'viz.depthMax': 'màu độ sâu tối đa (m)',
  'viz.maxFlood': 'phạm vi ngập tối đa',
  'viz.arrows': 'mũi tên dòng chảy',
  'viz.wireframe': 'địa hình khung dây',
  'viz.language': 'ngôn ngữ',

  // Stats
  'stats.location': 'vị trí',
  'stats.simTime': 'thời gian mô phỏng',
  'stats.rainIn': 'lượng mưa',
  'stats.stored': 'nước tích trữ',
  'stats.flooded': 'diện tích ngập',
  'stats.maxDepth': 'độ sâu tối đa',
  'stats.fps': 'fps',

  // Toasts
  'toast.loadingPlace': 'Đang tải "{q}"…',
  'toast.loadingSurface': 'Đang tải mô hình bề mặt (lớp phủ đất + OSM)…',
  'toast.loaded': 'Đã tải {place}',
  'toast.notFound': 'Không tìm thấy kết quả cho "{q}".',
  'toast.geocodeFail': 'Mã hóa địa lý thất bại. Vui lòng thử lại sau giây lát.',
  'toast.enterAddress': 'Vui lòng nhập địa chỉ.',
  'toast.detecting': 'Đang xác định vị trí của bạn…',

  // Misc
  'legend.elevation': 'Độ cao',
  'readout.elev': 'độ cao',
  'readout.water': 'nước',
};
