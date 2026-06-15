// English is the source catalog. Other locales mirror these keys; any missing
// key falls back to English. Keep {placeholders}, emoji and units unchanged
// when translating.
export const wuu: Record<string, string> = {
  // Address bar
  'input.placeholder': '地址、地方、或者“纬度, 经度”…',
  'btn.load': '加载',
  'btn.loading': '加载中…',
  'autocomplete.useCoords': '用坐标 {coords}',

  // Panel + folders
  'panel.title': '淹水地图',
  'sim.title': '模拟',
  'rain.title': '落雨',
  'urban.title': '城市模型',
  'soil.title': '泥土搭蒸发',
  'physics.title': '物理',
  'map.title': '地图（重新加载）',
  'viz.title': '可视化',
  'stats.title': '统计',

  // Simulation
  'sim.play': '播放 ▶',
  'sim.pause': '暂停 ⏸',
  'sim.step': '单步 ⏭',
  'sim.reset': '重置 ⟳',
  'sim.dump': '倾泻水量 💧（暴洪）',
  'sim.fill': '灌到水位 🌊（一趟头）',
  'sim.dumpDepth': '倾泻深度 (m)',
  'sim.floodLevel': '淹水水位 (+m)',
  'sim.liveFlood': '实时淹水水位',
  'sim.timescale': '时间 × (模拟 s/s)',
  'sim.substeps': '子步',
  'pour.button': '浇水',
  'pour.hint': '点地图浇一桶水',
  'pour.depth': '浇水深度 (m)',
  'pour.radius': '浇水半径 (m)',

  // Rain
  'rain.raining': '落雨中',
  'rain.stormEvent': '暴雨事件',
  'rain.clouds': '乌云 ⛈ + 闪电',
  'rain.constant': '恒定 mm/hr',
  'rain.footprint': '覆盖范围',
  'rain.footprintUniform': '均匀',
  'rain.footprintSpot': '风暴单体',
  'rain.cellX': '单体 x',
  'rain.cellY': '单体 y',
  'rain.cellRadius': '单体半径',

  // Storm hyetograph presets
  'storm.constant': '恒定（手动 mm/hr）',
  'storm.cloudburst': '倾盆大雨（~50 mm / 2 h）',
  'storm.design25yr': '设计暴雨 P≈25 yr',
  'storm.may2026': '实测 2026-5-18（41 mm/2 h）',
  'storm.jun2026': '实测 2026-6-12（90 mm/day）',

  // Urban model
  'urban.surface': '地表模型',
  'urban.buildings': '房子当墙壁',
  'urban.sewer': '雨水管 (mm/hr)',
  'urban.groundwater': '高地下水',

  // Soil
  'soil.infiltration': '泥土下渗 (mm/hr)',
  'soil.evaporation': '蒸发 (/hr)',

  // Physics
  'physics.gravity': '重力 (m/s²)',
  'physics.flow': '流量系数',
  'physics.friction': '摩擦',
  'physics.edges': '边缘',
  'physics.edgesOpen': '开放（排水）',
  'physics.edgesClosed': '关闭（墙壁）',

  // Map
  'map.elevation': '海拔',
  'map.size': '尺寸 (km)',
  'map.grid': '网格',
  'map.apply': '应用尺寸 / 网格 ⟲',
  'map.demoMode': '演示模式',

  // Demo mode (precomputed, scrubbable storm timeline)
  'demo.title': '演示',
  'demo.precompute': '预算暴雨 ⏳',
  'demo.statusLabel': '状态',
  'demo.timeline': '时间轴',
  'demo.play': '播放时间轴 ▶',
  'demo.live': '实时模拟 ⟳',
  'demo.stComputing': '计算中… {pct}%',
  'demo.stReady': '场景好了 — 拖时间',
  'demo.stLive': '实时',

  // Visualization
  'viz.terrain': '地形',
  'viz.terrainSatellite': '卫星',
  'viz.terrainHypso': '海拔着色',
  'viz.terrainHeatmap': '高度热力图',
  'viz.terrainSurface': '地表（淹水风险）',
  'viz.darkening': '深度变暗',
  'viz.vertical': '垂直 ×',
  'viz.opacity': '水透明度',
  'viz.depthMax': '深度配色上限 (m)',
  'viz.maxFlood': '最大淹水范围',
  'viz.arrows': '流向箭头',
  'viz.wireframe': '线框地形',
  'viz.language': '语言',
  'viz.waterQuality': '水质量',
  'viz.qLow': '低（快）',
  'viz.qMedium': '中',
  'viz.qHigh': '高（好看）',
  'viz.reflections': '天空倒影',
  'viz.refraction': '折射',
  'viz.clarity': '水清澈度',
  'viz.ripples': '涟漪强度',
  'viz.flowSpeed': '流速',
  'viz.foam': '泡沫',
  'viz.glint': '日光闪烁',
  'viz.shoreline': '岸线柔和度 (m)',
  'viz.skirt': '边缘裙墙',
  'viz.floodOverlay': '淹水地图叠层',
  'viz.floodGrid': '淹水网格',

  // Atmosphere / post-processing
  'atmo.title': '大气',
  'atmo.post': '后期处理',
  'atmo.exposure': '曝光',
  'atmo.bloom': '辉光',
  'atmo.ssao': '环境光遮蔽',
  'atmo.vignette': '暗角',
  'atmo.wetness': '湿地面（落雨）',
  'atmo.cloudShadows': '云影',
  'atmo.godRays': '光束（暴雨）',
  'atmo.haze': '地面雾气',
  'atmo.splashes': '雨点溅水',
  'atmo.renderScale': '渲染缩放',
  'atmo.autoQuality': '自动质量',

  // Stats
  'stats.location': '位置',
  'stats.simTime': '模拟时间',
  'stats.rainIn': '落雨进来',
  'stats.stored': '蓄水量',
  'stats.flooded': '淹水面积',
  'stats.maxDepth': '最大深度',
  'stats.fps': 'fps',

  // Toasts
  'toast.loadingPlace': '加载“{q}”中…',
  'toast.loadingSurface': '加载地表模型（土地覆盖 + OSM）中…',
  'toast.loaded': '加载好了 {place}',
  'toast.notFound': '寻“{q}”寻勿着。',
  'toast.geocodeFail': '地理编码失败。歇歇再试。',
  'toast.enterAddress': '请输入地址。',
  'toast.autoQuality': '降低图像质量保流畅。',
  'toast.detecting': '正在测侬个位置…',

  // Misc
  'legend.elevation': '海拔',
  'readout.elev': '海拔',
  'readout.water': '水',
};
