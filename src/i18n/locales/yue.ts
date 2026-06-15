// English is the source catalog. Other locales mirror these keys; any missing
// key falls back to English. Keep {placeholders}, emoji and units unchanged
// when translating.
export const yue: Record<string, string> = {
  // Address bar
  'input.placeholder': '地址、地點，或者「緯度, 經度」…',
  'btn.load': '載入',
  'btn.loading': '載入緊…',
  'autocomplete.useCoords': '用座標 {coords}',

  // Panel + folders
  'panel.title': '水浸地圖',
  'sim.title': '模擬',
  'rain.title': '落雨',
  'urban.title': '城市模型',
  'soil.title': '泥土同蒸發',
  'physics.title': '物理',
  'map.title': '地圖（重新載入）',
  'viz.title': '視覺效果',
  'stats.title': '數據',

  // Simulation
  'sim.play': '播放 ▶',
  'sim.pause': '暫停 ⏸',
  'sim.step': '行一步 ⏭',
  'sim.reset': '重設 ⟳',
  'sim.dump': '放水 💧（暴洪）',
  'sim.fill': '注水到指定水位 🌊（一次過）',
  'sim.dumpDepth': '放水深度 (m)',
  'sim.floodLevel': '水浸水位 (+m)',
  'sim.liveFlood': '即時水浸水位',
  'sim.timescale': '時間 × (sim s/s)',
  'sim.substeps': '子步數',
  'pour.button': '倒水',
  'pour.hint': '㩒一下地圖就可以喺嗰度倒水',
  'pour.depth': '倒水深度 (m)',
  'pour.radius': '倒水半徑 (m)',

  // Rain
  'rain.raining': '落緊雨',
  'rain.stormEvent': '暴雨事件',
  'rain.clouds': '烏雲 ⛈ + 閃電',
  'rain.constant': '固定 mm/hr',
  'rain.footprint': '覆蓋範圍',
  'rain.footprintUniform': '均勻',
  'rain.footprintSpot': '雷暴單體',
  'rain.cellX': '單體 x',
  'rain.cellY': '單體 y',
  'rain.cellRadius': '單體半徑',

  // Storm hyetograph presets
  'storm.constant': '固定（人手 mm/hr）',
  'storm.cloudburst': '傾盆大雨（~50 mm / 2 h）',
  'storm.design25yr': '設計暴雨 P≈25 yr',
  'storm.may2026': '實測 18 May 2026（41 mm/2 h）',
  'storm.jun2026': '實測 12 Jun 2026（90 mm/day）',

  // Urban model
  'urban.surface': '地表模型',
  'urban.buildings': '建築物當牆',
  'urban.sewer': '雨水渠 (mm/hr)',
  'urban.groundwater': '高地下水位',

  // Soil
  'soil.infiltration': '泥土滲透 (mm/hr)',
  'soil.evaporation': '蒸發 (/hr)',

  // Physics
  'physics.gravity': '重力 (m/s²)',
  'physics.flow': '流動系數',
  'physics.friction': '摩擦',
  'physics.edges': '邊界',
  'physics.edgesOpen': '開放（排水）',
  'physics.edgesClosed': '封閉（牆）',

  // Map
  'map.elevation': '海拔',
  'map.size': '尺寸 (km)',
  'map.grid': '網格',
  'map.apply': '套用尺寸／網格 ⟲',
  'map.demoMode': '示範模式',

  // Demo mode (precomputed, scrubbable storm timeline)
  'demo.title': '示範',
  'demo.precompute': '預先計算暴雨 ⏳',
  'demo.statusLabel': '狀態',
  'demo.timeline': '時間軸',
  'demo.play': '播放時間軸 ▶',
  'demo.live': '即時模擬 ⟳',
  'demo.stComputing': '計算緊… {pct}%',
  'demo.stReady': '場景準備好喇 — 拖時間軸',
  'demo.stLive': '即時',

  // Visualization
  'viz.terrain': '地形',
  'viz.terrainSatellite': '衛星',
  'viz.terrainHypso': '海拔着色',
  'viz.terrainHeatmap': '高度熱力圖',
  'viz.terrainSurface': '地表（水浸風險）',
  'viz.darkening': '按深度變暗',
  'viz.vertical': '垂直 ×',
  'viz.opacity': '水透明度',
  'viz.depthMax': '深度顏色上限 (m)',
  'viz.maxFlood': '最大水浸範圍',
  'viz.arrows': '水流箭咀',
  'viz.wireframe': '線框地形',
  'viz.language': '語言',
  'viz.waterQuality': '水質素',
  'viz.qLow': '低（快）',
  'viz.qMedium': '中',
  'viz.qHigh': '高（靚）',
  'viz.reflections': '天空反射',
  'viz.refraction': '折射',
  'viz.clarity': '水清澈度',
  'viz.ripples': '漣漪強度',
  'viz.flowSpeed': '水流速度',
  'viz.foam': '泡沫',
  'viz.glint': '陽光反光',
  'viz.shoreline': '岸邊柔和度 (m)',
  'viz.skirt': '邊緣裙牆',
  'viz.floodOverlay': '水浸地圖疊層',
  'viz.floodGrid': '水浸網格',

  // Atmosphere / post-processing
  'atmo.title': '大氣',
  'atmo.post': '後期處理',
  'atmo.exposure': '曝光',
  'atmo.bloom': '泛光',
  'atmo.ssao': '環境光遮蔽',
  'atmo.vignette': '暗角',
  'atmo.wetness': '濕地面（雨）',
  'atmo.cloudShadows': '雲影',
  'atmo.godRays': '光束（暴雨）',
  'atmo.haze': '地面薄霧',
  'atmo.splashes': '雨水濺起',
  'atmo.renderScale': '渲染比例',
  'atmo.autoQuality': '自動畫質',

  // Stats
  'stats.location': '位置',
  'stats.simTime': '模擬時間',
  'stats.rainIn': '已落雨量',
  'stats.stored': '蓄水量',
  'stats.flooded': '水浸面積',
  'stats.maxDepth': '最大深度',
  'stats.fps': 'fps',

  // Toasts
  'toast.loadingPlace': '載入緊「{q}」…',
  'toast.loadingSurface': '載入緊地表模型（土地覆蓋 + OSM）…',
  'toast.loaded': '已載入 {place}',
  'toast.notFound': '搵唔到同「{q}」相符嘅結果。',
  'toast.geocodeFail': '地理編碼失敗。請等陣再試。',
  'toast.enterAddress': '請輸入地址。',
  'toast.autoQuality': '已降低畫質，等畫面順暢啲。',
  'toast.detecting': '偵測緊你嘅位置…',

  // Misc
  'legend.elevation': '海拔',
  'readout.elev': '海拔',
  'readout.water': '水',
};
